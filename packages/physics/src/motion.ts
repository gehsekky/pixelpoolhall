/**
 * Motion states, closed-form evolution within a state, and transition times.
 *
 * Within a state the acceleration is constant, so position is a polynomial of
 * degree ≤ 2 in time. The equations are standard billiard ball kinematics
 * (Alciatore; Kiefl, "pooltool theory"); the state machine and the spin-decay
 * clamp follow pooltool 0.6.0 so results can be compared with it.
 */
import { addScaled, copy, cross, norm, slipVelocity, unit, type Vec3, Z_HAT } from "./math/vec3.ts"
import { spinFriction, type BallParams } from "./params.ts"

export const MotionState = {
  stationary: 0,
  spinning: 1,
  sliding: 2,
  rolling: 3,
  pocketed: 4,
  airborne: 5,
  offTable: 6,
} as const
export type MotionState = (typeof MotionState)[keyof typeof MotionState]

/** States in which the ball's center doesn't move. */
export const isNontranslating = (s: MotionState): boolean =>
  s === MotionState.stationary || s === MotionState.spinning || s === MotionState.pocketed || s === MotionState.offTable
export const isOutOfPlay = (s: MotionState): boolean => s === MotionState.pocketed || s === MotionState.offTable

export interface BallState {
  r: Vec3
  v: Vec3
  w: Vec3
  s: MotionState
}

export const cloneState = (b: BallState): BallState => ({ r: copy(b.r), v: copy(b.v), w: copy(b.w), s: b.s })

/** Speeds at or below this count as zero when labeling a state (pooltool's const.EPS). */
export const EPS = Number.EPSILON * 100

/** Rate of spin decay about the vertical, rad/s². */
const spinDecay = (p: BallParams) => (5 * spinFriction(p) * p.g) / (2 * p.R)

/** ωz after dt of decay, clamped at zero. */
function decaySpin(wz: number, p: BallParams, dt: number): number {
  if (dt === 0 || Math.abs(wz) < EPS) return wz
  const alpha = spinDecay(p)
  const t = Math.min(dt, Math.abs(wz) / alpha)
  return wz - Math.sign(wz) * alpha * t
}

/**
 * State after `dt` seconds in the ball's current motion state. The caller
 * guarantees dt doesn't pass the state's transition time.
 */
export function evolve(b: BallState, p: BallParams, dt: number): BallState {
  if (dt === 0) return cloneState(b)
  const { r, v, w, s } = b
  switch (s) {
    case MotionState.sliding: {
      const u = unit(slipVelocity(v, w, p.R))
      const a = p.u_s * p.g
      // Friction -μs m g û at the contact point -R ẑ gives dω/dt = -(5 μs g / 2R)(û × ẑ).
      const dw = cross(u, Z_HAT)
      const wNew = addScaled(w, dw, (-5 / 2 / p.R) * a * dt)
      wNew[2] = decaySpin(w[2], p, dt)
      return {
        r: [r[0] + v[0] * dt - 0.5 * a * dt * dt * u[0], r[1] + v[1] * dt - 0.5 * a * dt * dt * u[1], r[2]],
        v: [v[0] - a * dt * u[0], v[1] - a * dt * u[1], v[2] - a * dt * u[2]],
        w: wNew,
        s,
      }
    }
    case MotionState.rolling: {
      const vHat = unit(v)
      const a = p.u_r * p.g
      const vNew = addScaled(v, vHat, -a * dt)
      return {
        r: addScaled(addScaled(r, v, dt), vHat, -0.5 * a * dt * dt),
        v: vNew,
        // Rolling without slipping: ω⊥ = (ẑ × v) / R.
        w: [-vNew[1] / p.R, vNew[0] / p.R, decaySpin(w[2], p, dt)],
        s,
      }
    }
    case MotionState.spinning:
      return { r: copy(r), v: copy(v), w: [w[0], w[1], decaySpin(w[2], p, dt)], s }
    case MotionState.airborne:
      return {
        r: [r[0] + v[0] * dt, r[1] + v[1] * dt, r[2] + v[2] * dt - 0.5 * p.g * dt * dt],
        v: [v[0], v[1], v[2] - p.g * dt],
        w: copy(w),
        s,
      }
    default:
      return cloneState(b)
  }
}

export const slideTime = (b: BallState, p: BallParams): number =>
  p.u_s === 0 ? Infinity : (2 * norm(slipVelocity(b.v, b.w, p.R))) / (7 * p.u_s * p.g)
export const rollTime = (b: BallState, p: BallParams): number => (p.u_r === 0 ? Infinity : norm(b.v) / (p.u_r * p.g))
export const spinTime = (b: BallState, p: BallParams): number => {
  const usp = spinFriction(p)
  return usp === 0 ? Infinity : (Math.abs(b.w[2]) * 2 * p.R) / (5 * usp * p.g)
}

export type TransitionType = "sliding_rolling" | "rolling_spinning" | "rolling_stationary" | "spinning_stationary"

/** The ball's next transition, as a delay from its current state (Infinity if none). */
export function nextTransition(b: BallState, p: BallParams): { type: TransitionType; dt: number } | null {
  switch (b.s) {
    case MotionState.sliding:
      return { type: "sliding_rolling", dt: slideTime(b, p) }
    case MotionState.rolling: {
      const roll = rollTime(b, p)
      return { type: spinTime(b, p) > roll ? "rolling_spinning" : "rolling_stationary", dt: roll }
    }
    case MotionState.spinning:
      return { type: "spinning_stationary", dt: spinTime(b, p) }
    default:
      return null
  }
}

/** Apply a transition's state change; zeroes the components the new state forbids. */
export function applyTransition(b: BallState, type: TransitionType): BallState {
  const out = cloneState(b)
  switch (type) {
    case "sliding_rolling":
      out.s = MotionState.rolling
      break
    case "rolling_spinning":
      out.s = MotionState.spinning
      out.v = [0, 0, 0]
      out.w = [0, 0, b.w[2]]
      break
    case "rolling_stationary":
    case "spinning_stationary":
      out.s = MotionState.stationary
      out.v = [0, 0, 0]
      out.w = [0, 0, 0]
      break
  }
  return out
}

/**
 * The motion state implied by kinematics alone, for labeling a ball after a
 * collision. Speeds at or below EPS count as zero.
 */
export function classify(r: Readonly<Vec3>, v: Readonly<Vec3>, w: Readonly<Vec3>, p: BallParams): MotionState {
  if (r[2] < 0) return MotionState.pocketed
  if (v[2] !== 0 || r[2] !== p.R) return MotionState.airborne
  if (norm(slipVelocity(v, w, p.R)) > EPS) return MotionState.sliding
  if (Math.hypot(v[0], v[1]) > EPS) return MotionState.rolling
  if (Math.abs(w[2]) > EPS) return MotionState.spinning
  return MotionState.stationary
}

/**
 * Half the acceleration of the ball's center in its current state, so that
 * r(τ) = r + v τ + accelHalf τ² until the next transition.
 */
export function halfAcceleration(b: BallState, p: BallParams): Vec3 {
  switch (b.s) {
    case MotionState.sliding: {
      const slip = slipVelocity(b.v, b.w, p.R)
      slip[2] = 0
      const u = unit(slip)
      const k = -0.5 * p.u_s * p.g
      return [k * u[0], k * u[1], k * u[2]]
    }
    case MotionState.rolling: {
      const vHat = unit(b.v)
      const k = -0.5 * p.u_r * p.g
      return [k * vHat[0], k * vHat[1], k * vHat[2]]
    }
    case MotionState.airborne:
      return [0, 0, -0.5 * p.g]
    default:
      return [0, 0, 0]
  }
}
