/**
 * Mathavan's numerical collision models, which integrate the impact in small
 * steps of normal impulse instead of solving it in closed form, so that spin
 * and the friction of the cloth during the impact are both accounted for:
 *
 * - ball–ball: Mathavan, Jackson & Parkin, "Numerical simulations of the
 *   frictional collisions of solid balls on a rough surface", Sports
 *   Engineering 17 (2014) 227–237. Each ball's contact with the cloth applies
 *   friction while the balls are pressed together, as well as the contact
 *   between the balls.
 * - ball–cushion: Mathavan, Jackson & Parkin, "A theoretical analysis of
 *   billiard ball-cushion dynamics under cushion impacts", Proc. IMechE
 *   Part C 224 (2010) 1863–1873. The ball touches the cushion above its
 *   equator (at the nose height) and the cloth below; both slip and rub.
 *
 * Both assume the balls are on the cloth. Restitution is applied to the work
 * done by the normal force (Stronge's energetic coefficient), not to the
 * normal velocity.
 *
 * Three deliberate differences from pooltool, all about steps whose result
 * pooltool leaves to rounding noise. First, friction at a contact needs a
 * direction of slip, and when the slip is zero (a rolling ball's contact with
 * the cloth, or a ball at rest) pooltool takes that direction from rounding
 * noise. The step then rubs in an arbitrary direction, and a change in the
 * last bit of the input changes the result by up to ~1e-3 m/s. Here a slip
 * below SLIP_EPS gets no friction for that step, as pooltool's ball–ball
 * model already does for an exactly zero slip. The reference fixtures are
 * made with the same rules (tools/reference/mathavan_patched.py). Second,
 * the ball–ball model ends restitution with a partial step, and third, both
 * models cap each step's friction so a contact whose slip reaches zero sticks
 * (see below).
 *
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt):
 * frictional_mathavan and mathavan_2010. Modified: rewritten in TypeScript.
 * The arithmetic follows pooltool's step for step (including its step-size
 * choices and how it refines the end of each phase), so the two agree to
 * rounding.
 */
import type { Vec3 } from "../math/vec3.ts"

/** Slip speeds below this (m/s) have no direction: no friction at that contact for that step. */
export const SLIP_EPS = 1e-9

export interface MathavanBallBallOptions {
  /** Ball–ball friction. */
  u_b: number
  /** Ball–ball restitution. */
  e_b: number
  /** Ball–cloth sliding friction of each ball. */
  u_s1: number
  u_s2: number
  /** Number of impulse steps the collision is split into (about; Eq. 14). */
  iterations: number
}

/**
 * Ball–ball collision on the cloth (Mathavan 2014). Positions are at contact.
 * Returns the new velocities and angular velocities; vertical velocities are
 * left as they were.
 */
export function mathavanBallBall(
  r_i: Vec3, v_i: Vec3, w_i: Vec3, r_j: Vec3, v_j: Vec3, w_j: Vec3, R: number, M: number, o: MathavanBallBallOptions,
): { v1: Vec3; w1: Vec3; v2: Vec3; w2: Vec3 } {
  const { u_b, e_b, u_s1, u_s2 } = o
  // Local frame: y along the line of centers (i to j), z up, x = y × z.
  const r_ij: Vec3 = [r_j[0] - r_i[0], r_j[1] - r_i[1], r_j[2] - r_i[2]]
  const r_ij_mag = Math.sqrt(r_ij[0] * r_ij[0] + r_ij[1] * r_ij[1] + r_ij[2] * r_ij[2])
  const y: Vec3 = [r_ij[0] / r_ij_mag, r_ij[1] / r_ij_mag, r_ij[2] / r_ij_mag]
  const x: Vec3 = [y[1], -y[0], 0]
  const z: Vec3 = [0, 0, 1]
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  let v_ix = dot(v_i, x)
  let v_iy = dot(v_i, y)
  let v_jx = dot(v_j, x)
  let v_jy = dot(v_j, y)
  let w_ix = dot(x, w_i)
  let w_iy = dot(y, w_i)
  let w_iz = dot(z, w_i)
  let w_jx = dot(x, w_j)
  let w_jy = dot(y, w_j)
  let w_jz = dot(z, w_j)

  // Slip of each ball on the cloth, and between the balls at their contact.
  let u_iR_x = v_ix + R * w_iy
  let u_iR_y = v_iy - R * w_ix
  let u_jR_x = v_jx + R * w_jy
  let u_jR_y = v_jy - R * w_jx
  let u_iR_mag = Math.sqrt(u_iR_x ** 2 + u_iR_y ** 2)
  let u_jR_mag = Math.sqrt(u_jR_x ** 2 + u_jR_y ** 2)
  let u_ijC_x = v_ix - v_jx - R * (w_iz + w_jz)
  let u_ijC_z = R * (w_ix + w_jx)
  let u_ijC_mag = Math.sqrt(u_ijC_x ** 2 + u_ijC_z ** 2)

  let v_ijy = v_jy - v_iy
  const deltaP = (0.5 * (1 + e_b) * M * Math.abs(v_ijy)) / o.iterations
  const C = 5 / (2 * M * R)
  // Work done by the normal impulse; compression ends when the balls stop
  // closing, restitution when the work reaches (1 + e²) times that.
  let W_f = Infinity
  let W_c: number | null = null
  let W = 0
  let steps = 0
  while (v_ijy < 0 || W < W_f) {
    if (++steps > 100 * o.iterations + 1000) throw new Error("Mathavan ball-ball collision did not converge")
    // The last restitution step is shortened to deliver about the remaining
    // work (as Mathavan's cushion model does). pooltool takes whole steps,
    // and its step size makes a frictionless collision land exactly on W_f,
    // so whether it takes one more step (0.2% more rebound) is down to rounding.
    let dP = deltaP
    const last = W_c !== null && W + deltaP * Math.abs(v_ijy) > W_f
    if (last) dP = (W_f - W) / Math.abs(v_ijy)
    let deltaP_1: number, deltaP_2: number
    let deltaP_ix: number, deltaP_iy: number, deltaP_jx: number, deltaP_jy: number
    // Friction between the balls, capped at what brings their slip to zero
    // (each unit of it changes the slip by at most 7/M): the surfaces stick
    // instead of chattering across zero, where the slip's direction, and so
    // each step's friction, would come from rounding noise.
    const friction = Math.min(u_b * dP, (u_ijC_mag * M) / 7)
    if (u_ijC_mag < SLIP_EPS) {
      deltaP_1 = deltaP_2 = 0
      deltaP_ix = deltaP_iy = deltaP_jx = deltaP_jy = 0
    } else {
      deltaP_1 = (-friction * u_ijC_x) / u_ijC_mag
      if (Math.abs(u_ijC_z) < SLIP_EPS) {
        deltaP_2 = 0
        deltaP_ix = deltaP_iy = deltaP_jx = deltaP_jy = 0
      } else {
        deltaP_2 = (-friction * u_ijC_z) / u_ijC_mag
        if (deltaP_2 > 0) {
          // Ball–ball friction pushes j into the cloth: j's cloth friction acts.
          deltaP_ix = deltaP_iy = 0
          if (u_jR_mag < SLIP_EPS) {
            deltaP_jx = deltaP_jy = 0
          } else {
            deltaP_jx = -u_s2 * (u_jR_x / u_jR_mag) * deltaP_2
            deltaP_jy = -u_s2 * (u_jR_y / u_jR_mag) * deltaP_2
          }
        } else {
          deltaP_jx = deltaP_jy = 0
          if (u_iR_mag < SLIP_EPS) {
            deltaP_ix = deltaP_iy = 0
          } else {
            deltaP_ix = u_s1 * (u_iR_x / u_iR_mag) * deltaP_2
            deltaP_iy = u_s1 * (u_iR_y / u_iR_mag) * deltaP_2
          }
        }
      }
    }
    v_ix += (deltaP_1 + deltaP_ix) / M
    v_jx += (-deltaP_1 + deltaP_jx) / M
    v_iy += (-dP + deltaP_iy) / M
    v_jy += (dP + deltaP_jy) / M
    w_ix += C * (deltaP_2 + deltaP_iy)
    w_iy += C * -deltaP_ix
    w_iz += C * -deltaP_1
    w_jx += C * (deltaP_2 + deltaP_jy)
    w_jy += C * -deltaP_jx
    w_jz += C * -deltaP_1

    u_iR_x = v_ix + R * w_iy
    u_iR_y = v_iy - R * w_ix
    u_jR_x = v_jx + R * w_jy
    u_jR_y = v_jy - R * w_jx
    u_iR_mag = Math.sqrt(u_iR_x ** 2 + u_iR_y ** 2)
    u_jR_mag = Math.sqrt(u_jR_x ** 2 + u_jR_y ** 2)
    u_ijC_x = v_ix - v_jx - R * (w_iz + w_jz)
    u_ijC_z = R * (w_ix + w_jx)
    u_ijC_mag = Math.sqrt(u_ijC_x ** 2 + u_ijC_z ** 2)

    const v_ijy0 = v_ijy
    v_ijy = v_jy - v_iy
    W += 0.5 * dP * Math.abs(v_ijy0 + v_ijy)
    if (W_c === null && v_ijy > 0) {
      W_c = W
      W_f = (1 + e_b ** 2) * W_c
    }
    if (last) break
  }
  // Back to the table frame (the transpose of [x; y; z]).
  const toWorld = (a: number, b: number, c: number): Vec3 => [
    x[0] * a + y[0] * b + z[0] * c,
    x[1] * a + y[1] * b + z[1] * c,
    x[2] * a + y[2] * b + z[2] * c,
  ]
  const v1 = toWorld(v_ix, v_iy, 0)
  const v2 = toWorld(v_jx, v_jy, 0)
  return {
    v1: [v1[0], v1[1], v_i[2]],
    w1: toWorld(w_ix, w_iy, w_iz),
    v2: [v2[0], v2[1], v_j[2]],
    w2: toWorld(w_jx, w_jy, w_jz),
  }
}

// ---- Ball–cushion (Mathavan 2010) ----
//
// Cushion frame: the ball approaches along +y (into the cushion), x along the
// rail, z up. The cushion touches the ball at I, above the equator at angle
// θ with sin θ = (h − R)/R; the cloth touches it at C, straight below.

export interface MathavanCushionOptions {
  /** Ball–cushion restitution. */
  e_c: number
  /** Ball–cushion sliding friction. */
  f_c: number
  /** Ball–cloth sliding friction. */
  u_s: number
  /** Height of the cushion nose above the slate. */
  h: number
  /** Number of impulse steps the compression is split into (at most). */
  maxSteps: number
  /** Smallest impulse step, N·s. */
  deltaP: number
}

interface CushionState { vx: number; vy: number; wx: number; wy: number; wz: number }

/**
 * Directions of slip at the cushion (I) and at the cloth (C), radians in
 * [0, 2π), or NaN where the slip is below SLIP_EPS (no friction there); then
 * the slip speeds.
 */
function slipAngles(R: number, sin: number, cos: number, s: CushionState): [number, number, number, number] {
  const v_xI = s.vx + s.wy * R * sin - s.wz * R * cos
  const v_yI = -s.vy * sin + s.wx * R
  const v_xC = s.vx - s.wy * R
  const v_yC = s.vy + s.wx * R
  let phi = Math.atan2(v_yI, v_xI)
  if (phi < 0) phi += 2 * Math.PI
  let phiC = Math.atan2(v_yC, v_xC)
  if (phiC < 0) phiC += 2 * Math.PI
  const slipI = Math.sqrt(v_xI ** 2 + v_yI ** 2)
  const slipC = Math.sqrt(v_xC ** 2 + v_yC ** 2)
  if (slipI < SLIP_EPS) phi = NaN
  if (slipC < SLIP_EPS) phiC = NaN
  return [phi, phiC, slipI, slipC]
}

/**
 * One step of normal impulse dp at the cushion (Eqs. 13–17). A NaN slip
 * angle means no friction there. Friction at each contact is capped at what
 * brings its slip to zero (a contact's slip changes by 3.5/M per unit of
 * friction impulse), so a contact that reaches zero slip sticks instead of
 * chattering across zero with each step's direction set by rounding noise.
 */
function cushionStep(
  M: number, R: number, mu_s: number, mu_w: number, sin: number, cos: number, s: CushionState,
  [phi, phiC, slipI, slipC]: [number, number, number, number], dp: number,
): CushionState {
  if (Number.isNaN(phi)) {
    mu_w = 0
    phi = 0
  }
  if (Number.isNaN(phiC)) {
    mu_s = 0
    phiC = 0
  }
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const sinPhiC = Math.sin(phiC)
  const cosPhiC = Math.cos(phiC)
  mu_w = Math.min(mu_w, (slipI * M) / (3.5 * dp))
  // Normal force at the cloth, per unit cushion impulse.
  const nC = sin + mu_w * sinPhi * cos
  mu_s = Math.min(mu_s, (slipC * M) / (3.5 * dp * nC))
  const k = 5 / (2 * M * R)
  return {
    vx: s.vx - (1 / M) * (mu_w * cosPhi + mu_s * cosPhiC * nC) * dp,
    vy: s.vy - (1 / M) * (cos - mu_w * sin * sinPhi + mu_s * sinPhiC * nC) * dp,
    wx: s.wx + -k * (mu_w * sinPhi + mu_s * sinPhiC * nC) * dp,
    wy: s.wy + -k * (mu_w * cosPhi * sin - mu_s * cosPhiC * nC) * dp,
    wz: s.wz + k * (mu_w * cosPhi * cos) * dp,
  }
}

/**
 * Ball–cushion collision (Mathavan 2010), in the cushion frame: vy > 0 is
 * moving into the cushion. Returns the state after the impact.
 */
export function mathavanCushionLocal(M: number, R: number, o: MathavanCushionOptions, s0: CushionState): CushionState {
  const sin = (o.h - R) / R
  const cos = Math.sqrt(1 - sin ** 2)
  const mu_s = o.u_s
  const mu_w = o.f_c
  const work = (vy: number, dp: number) => dp * Math.abs(vy) * cos

  // Compression: until the ball stops moving into the cushion. The step that
  // would cross vy = 0 is halved up to 8 times, keeping the halves that don't.
  let s = s0
  let W = 0
  let dp = Math.max((M * s.vy) / o.maxSteps, o.deltaP)
  let steps = 0
  compression: while (s.vy > 0) {
    const next = cushionStep(M, R, mu_s, mu_w, sin, cos, s, slipAngles(R, sin, cos, s), dp)
    if (next.vy <= 0) {
      let refine = dp
      for (let i = 0; i < 8; i++) {
        refine /= 2
        const test = cushionStep(M, R, mu_s, mu_w, sin, cos, s, slipAngles(R, sin, cos, s), refine)
        if (test.vy <= 0) continue
        s = test
        W += work(s.vy, refine)
      }
      break compression
    }
    s = next
    W += work(s.vy, dp)
    if (++steps > 10 * o.maxSteps) throw new Error("Mathavan cushion collision: no solution in compression")
  }

  // Restitution: until the cushion's work reaches e² times the compression's.
  const target = o.e_c ** 2 * W
  let Wr = 0
  dp = Math.max(target / o.maxSteps, o.deltaP)
  steps = 0
  while (Wr < target) {
    const slip = slipAngles(R, sin, cos, s)
    const dW = work(s.vy, dp)
    if (Wr + dW > target) {
      // Finish with the step that delivers exactly the remaining work.
      const last = (target - Wr) / (Math.abs(s.vy) * cos)
      return cushionStep(M, R, mu_s, mu_w, sin, cos, s, slip, last)
    }
    s = cushionStep(M, R, mu_s, mu_w, sin, cos, s, slip, dp)
    Wr += work(s.vy, dp)
    if (++steps > 10 * o.maxSteps) throw new Error("Mathavan cushion collision: no solution in restitution")
  }
  return s
}

/** Rotate (x, y) by angle a (counterclockwise), as pooltool's coordinate_rotation. */
function rotate(v: Vec3, cosA: number, sinA: number): Vec3 {
  return [cosA * v[0] - sinA * v[1], sinA * v[0] + cosA * v[1], v[2]]
}

/**
 * Ball–cushion collision with in-plane unit normal n pointing from the ball
 * into the cushion. Rotates the ball's state so n maps to +y, solves, and
 * rotates back (position included, as pooltool does).
 */
export function mathavanCushion(r: Vec3, v: Vec3, w: Vec3, n: Vec3, M: number, R: number, o: MathavanCushionOptions): { r: Vec3; v: Vec3; w: Vec3 } {
  let psi = Math.atan2(n[1], n[0]) - Math.atan2(0, 1)
  if (psi < 0) psi = 2 * Math.PI + psi
  const a = Math.PI / 2 - psi
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const rR = rotate(r, ca, sa)
  const vR = rotate(v, ca, sa)
  const wR = rotate(w, ca, sa)
  const out = mathavanCushionLocal(M, R, o, { vx: vR[0], vy: vR[1], wx: wR[0], wy: wR[1], wz: wR[2] })
  const cb = Math.cos(-a)
  const sb = Math.sin(-a)
  return {
    r: rotate(rR, cb, sb),
    v: rotate([out.vx, out.vy, vR[2]], cb, sb),
    w: rotate([out.wx, out.wy, out.wz], cb, sb),
  }
}
