/**
 * Ball–ball collision: frictional, inelastic impulse for equal-mass balls,
 * with Alciatore's speed-dependent throw friction.
 *
 * Physics: Alciatore, TP A-5, A-6, A-14; extended to both balls moving with
 * arbitrary spin as in pooltool's FrictionalInelastic model.
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt).
 * Modified: rewritten in TypeScript in a frame-free form (projections onto
 * the line of centers instead of a rotated frame); same model, same results
 * up to rounding.
 */
import { createRoots, solveQuadratic } from "../math/roots/index.ts"
import { smallestMagnitudeReal } from "../math/roots/select.ts"
import {
  add,
  addScaled,
  cross,
  dot,
  norm,
  scale,
  sub,
  tangentSurfaceVelocity,
  unit,
  type Vec3,
} from "../math/vec3.ts"
import { classify, EPS, isNontranslating, MotionState, type BallState } from "../motion.ts"
import type { BallParams, ModelConfig } from "../params.ts"

/** Gap pooltool leaves between bodies after resolving a contact (const.MIN_DIST). */
export const MIN_DIST = 1e-6

const roots = createRoots()

/**
 * Place the balls exactly R1 + R2 + MIN_DIST apart before resolving
 * (pooltool's make_kiss). Each ball moves along its own velocity by the
 * smallest-magnitude time offset that reaches the target separation; if that
 * fails or would shift the contact point by more than 5 · MIN_DIST, both move
 * along the line of centers instead.
 */
export function makeKiss(b1: BallState, b2: BallState, R1: number, R2: number): [Vec3, Vec3] {
  const target = R1 + R2 + MIN_DIST
  let placed: [Vec3, Vec3] | null = null
  if (!(isNontranslating(b1.s) && isNontranslating(b2.s))) {
    const B = sub(b2.v, b1.v)
    const C = sub(b2.r, b1.r)
    solveQuadratic(dot(B, B), 2 * dot(B, C), dot(C, C) - target * target, roots)
    const t = smallestMagnitudeReal(roots)
    if (Number.isFinite(t)) {
      const r1 = addScaled(b1.r, b1.v, t)
      const r2 = addScaled(b2.r, b2.v, t)
      const shift = norm(scale(sub(add(r1, r2), add(b1.r, b2.r)), 0.5))
      if (shift <= 5 * MIN_DIST) placed = [r1, r2]
    }
  }
  const useVelocity = placed !== null
  if (!placed) {
    const d = unit(sub(b2.r, b1.r))
    const correction = target - norm(sub(b2.r, b1.r))
    placed = [addScaled(b1.r, d, -correction / 2), addScaled(b2.r, d, correction / 2)]
  }
  return constrainToTable([b1, b2], [R1, R2], placed, target, useVelocity)
}

// ---- Keeping balls on (or above) the table after contact placement ----
//
// In 3D, placing two balls at contact can carry an airborne ball through the
// slate (e.g. rewinding a just-launched ball along its upward velocity), or
// tilt a resting ball off it. pooltool lifts such a ball by sliding it along
// the sphere of radius `target` around the other ball, which preserves the
// separation exactly. In 2D every ball stays at z = R and nothing moves.

const violates = (b: BallState, R: number, z: number) => (b.s === MotionState.airborne ? z < R : z !== R)

function constrainToTable(
  bs: [BallState, BallState], Rs: [number, number], pos: [Vec3, Vec3], target: number, useVelocity: boolean,
): [Vec3, Vec3] {
  const out: [Vec3, Vec3] = [pos[0], pos[1]]
  // The deeper ball first; the second lift pivots on the first's corrected position.
  const order = out[1][2] < out[0][2] ? [1, 0] : [0, 1]
  for (const i of order) {
    const b = bs[i]!
    const R = Rs[i]!
    if (!violates(b, R, out[i]![2])) continue
    const mover = out[i]!
    const pivot = out[1 - i]!
    if (!useVelocity && b.s !== MotionState.airborne) {
      // A resting ball the fallback pushed off the table: straight back down; the airborne one absorbs it.
      const lifted: Vec3 = [mover[0], mover[1], R]
      out[i] = lifted
      out[1 - i] = addScaled(lifted, unit(sub(pivot, lifted)), target)
      continue
    }
    out[i] = liftToHeight(mover, pivot, target, R, useVelocity ? b.v : [0, 0, 0])
  }
  return out
}

/** Horizontal unit vector from pivot toward mover (x if mover is straight above or below). */
function centersAxis(mover: Vec3, pivot: Vec3): Vec3 {
  const h: Vec3 = [mover[0] - pivot[0], mover[1] - pivot[1], 0]
  return norm(h) === 0 ? [1, 0, 0] : unit(h)
}

/** Circle cut from the sphere (radius d around pivot) by the vertical plane through mover along e1. */
function circleOnSphere(mover: Vec3, pivot: Vec3, d: number, e1: Vec3): { center: Vec3; radius: number } {
  const normal = cross(e1, [0, 0, 1])
  const offset = dot(sub(mover, pivot), normal)
  return { center: addScaled(pivot, normal, offset), radius: Math.sqrt(d * d - offset * offset) }
}

/** Slide mover along the sphere of radius d around pivot, within its plane of flight when possible, to height R. */
function liftToHeight(mover: Vec3, pivot: Vec3, d: number, R: number, velocity: Vec3): Vec3 {
  let e1 = centersAxis(mover, pivot)
  const hv: Vec3 = [velocity[0], velocity[1], 0]
  if (norm(hv) > 0) {
    const ev = unit(hv)
    const c = circleOnSphere(mover, pivot, d, ev)
    if (Math.abs(R - c.center[2]) <= c.radius) e1 = ev
  }
  const { center, radius } = circleOnSphere(mover, pivot, d, e1)
  const a = (R - center[2]) / radius
  const side = dot(sub(mover, center), e1) >= 0 ? 1 : -1
  const b = side * Math.sqrt(1 - a * a)
  return add(center, scale(add(scale(e1, b), [0, 0, a]), radius))
}

/** Alciatore's throw friction u_b = a + b exp(-c v_rel), from the relative surface speed at the contact. */
export function throwFriction(b1: BallState, b2: BallState, p1: BallParams, p2: BallParams, f: ModelConfig["ballBall"]["friction"]): number {
  const n = unit(sub(b2.r, b1.r))
  const c1 = tangentSurfaceVelocity(b1.v, b1.w, n, p1.R)
  const c2 = tangentSurfaceVelocity(b2.v, b2.w, scale(n, -1), p2.R)
  return f.a + f.b * Math.exp(-f.c * norm(sub(c1, c2)))
}

/**
 * Post-collision velocities for two equal-mass balls touching along n
 * (unit, from ball 1 to ball 2).
 */
function impulse(
  v1: Vec3, w1: Vec3, v2: Vec3, w2: Vec3, n: Vec3, R: number, u_b: number, e_b: number,
): { v1: Vec3; w1: Vec3; v2: Vec3; w2: Vec3 } {
  // Normal components: inelastic exchange; angular velocity about n is unchanged.
  const v1n = dot(v1, n)
  const v2n = dot(v2, n)
  const v1nF = 0.5 * ((1 - e_b) * v1n + (1 + e_b) * v2n)
  const v2nF = 0.5 * ((1 + e_b) * v1n + (1 - e_b) * v2n)
  const w1n = dot(w1, n)
  const w2n = dot(w2, n)
  const dvn = Math.abs(v2nF - v1nF)

  // Tangential parts (normal components removed).
  const v1t = addScaled(v1, n, -v1n)
  const v2t = addScaled(v2, n, -v2n)
  const w1t = addScaled(w1, n, -w1n)
  const w2t = addScaled(w2, n, -w2n)

  const contact = (v1x: Vec3, w1x: Vec3, v2x: Vec3, w2x: Vec3) =>
    sub(add(v1x, cross(w1x, scale(n, R))), add(v2x, cross(w2x, scale(n, -R))))
  const slip0 = contact(v1t, w1t, v2t, w2t)

  let out: { v1: Vec3; w1: Vec3; v2: Vec3; w2: Vec3 } | null = null
  if (norm(slip0) > EPS) {
    // Kinetic friction for the whole impact: impulse u_b · Δv_n opposing the slip.
    const dv = scale(unit(slip0), -u_b * dvn)
    const dw = scale(cross(n, dv), 2.5 / R)
    const cand = { v1: add(v1t, dv), w1: add(w1t, dw), v2: sub(v2t, dv), w2: add(w2t, dw) }
    // If that friction would reverse the slip, the surfaces stick before separating.
    if (dot(slip0, contact(cand.v1, cand.w1, cand.v2, cand.w2)) > 0) out = cand
  }
  if (!out) {
    // Rolling (no-slip) separation.
    const dv = scale(add(sub(v1t, v2t), scale(cross(add(w1t, w2t), n), R)), -1 / 7)
    const dw = scale(add(scale(cross(n, sub(v1t, v2t)), 1 / R), add(w1t, w2t)), -5 / 14)
    out = { v1: add(v1t, dv), w1: add(w1t, dw), v2: sub(v2t, dv), w2: add(w2t, dw) }
  }
  return {
    v1: addScaled(out.v1, n, v1nF),
    w1: addScaled(out.w1, n, w1n),
    v2: addScaled(out.v2, n, v2nF),
    w2: addScaled(out.w2, n, w2n),
  }
}

/**
 * pooltool's guard for balls moving in near-unison along their line of
 * centers (e.g. a frozen combination): the chased ball takes 10% of the
 * chaser's radial momentum so the pair separates instead of colliding again
 * microseconds later. Phenomenological, not physical; kept for comparability.
 */
function separateContinuallyTouching(b1: BallState, b2: BallState): void {
  const s1 = norm(b1.v)
  const s2 = norm(b2.v)
  if (!(s1 > 0 && s2 > 0)) return
  const n = unit(sub(b2.r, b1.r))
  const v1n = dot(b1.v, n)
  const v2n = dot(b2.v, n)
  const aligned = dot(b1.v, b2.v) / (s1 * s2) > 0.9
  if (!(Math.abs(v2n - v1n) < 0.01 && aligned)) return
  const stolen = 0.1 * (v1n > v2n ? v1n : v2n)
  const [d1, d2] = v1n > v2n ? [-stolen, stolen] : [stolen, -stolen]
  b1.v = addScaled(b1.v, n, d1)
  b2.v = addScaled(b2.v, n, d2)
}

/** Resolve a ball–ball collision (in 2D, vertical velocities are dropped). Returns new states. */
export function resolveBallBall(
  b1: BallState, b2: BallState, p1: BallParams, p2: BallParams, config: ModelConfig["ballBall"], threeD = false,
): [BallState, BallState] {
  const [r1, r2] = makeKiss(b1, b2, p1.R, p2.R)
  const k1 = { ...b1, r: r1 }
  const k2 = { ...b2, r: r2 }
  const u_b = throwFriction(k1, k2, p1, p2, config.friction)
  const n = unit(sub(r2, r1))
  const res = impulse(k1.v, k1.w, k2.v, k2.w, n, p1.R, u_b, (p1.e_b + p2.e_b) / 2)
  if (!threeD) {
    res.v1[2] = 0
    res.v2[2] = 0
  }
  const o1: BallState = { r: r1, v: res.v1, w: res.w1, s: classify(r1, res.v1, res.w1, p1) }
  const o2: BallState = { r: r2, v: res.v2, w: res.w2, s: classify(r2, res.v2, res.w2, p2) }
  // As in pooltool, this runs after the states are labeled and doesn't relabel them.
  separateContinuallyTouching(o1, o2)
  return [o1, o2]
}
