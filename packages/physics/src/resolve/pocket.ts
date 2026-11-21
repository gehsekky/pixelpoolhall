/**
 * Pockets.
 *
 * Capture (pooltool's "canonical" model, and the end of a fall through a
 * pocket interior): the ball is moved to the pocket center at −depth and
 * stopped.
 *
 * Pocket interiors (3D, see PocketInterior and docs/physics-design.md,
 * "Pockets"):
 * - drop: a ball whose center reaches the edge of the slate cut tips over it
 *   (pivot.ts), or, fast enough (u² ≥ gR across the edge), flies off it.
 *   The test uses the speed as it arrives; a tipping ball then rolls on the
 *   edge, so any slip is taken up at once (as on landing). A ball moving
 *   mostly along the edge may not get over: it skims past (see canTip);
 * - the wall around the cut (facings' undercut faces, liner): captures (WPA
 *   §10 requires liners to send balls down);
 * - edge: the cloth-covered edge of the slate, as a landing on the slate but
 *   along the contact normal (Alciatore TP A-14: restitution e_t, friction
 *   μs up to rolling).
 */
import { add, addScaled, cross, dot, norm, scale, sub, unit, type Vec3 } from "../math/vec3.ts"
import { classify, EPS, MotionState, type BallState } from "../motion.ts"
import type { BallParams, ModelConfig } from "../params.ts"
import { canTip, separationCos } from "../pivot.ts"
import type { Pocket } from "../table.ts"

export function resolvePocket(pocket: Pocket): BallState {
  return { r: [pocket.center[0], pocket.center[1], -pocket.depth], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.pocketed }
}

/** A ball on the slate whose center has reached the edge of the cut. */
export function resolveDrop(b: BallState, pocket: Pocket, p: BallParams): BallState {
  const n = unit([pocket.center[0] - b.r[0], pocket.center[1] - b.r[1], 0])
  const u0 = Math.max(dot(b.v, n), 1e-9)
  const r: Vec3 = [b.r[0], b.r[1], p.R]
  if (separationCos(u0, p) >= 1) return { r, v: [b.v[0], b.v[1], 0], w: [...b.w], s: MotionState.airborne }
  // Tipping over the edge, the ball rolls on it: friction at the edge takes up
  // any slip at once, conserving angular momentum about the contact point
  // (the change a landing makes): v' = v + (2/7)(R ω × ẑ − v).
  const v: Vec3 = [b.v[0] + (2 / 7) * (p.R * b.w[1] - b.v[0]), b.v[1] + (2 / 7) * (-p.R * b.w[0] - b.v[1]), 0]
  const un = Math.max(dot(v, n), 1e-9)
  const phi0 = Math.atan2(b.r[1] - pocket.center[1], b.r[0] - pocket.center[0])
  const along = -Math.sin(phi0) * v[0] + Math.cos(phi0) * v[1]
  const pivot = { center: [pocket.center[0], pocket.center[1]] as [number, number], rho: pocket.radius, phi0, phiDot: along / pocket.radius, u0: un, wz: b.w[2], tau: 0 }
  // Too little speed across the edge for its speed along it: it rolls back out
  // over the edge, its center dipping a negligible amount (R(1 − cos β)).
  // It carries on as on the slate, nudged just inside the circle so the
  // crossing it is on doesn't count again.
  if (!canTip(pivot, p)) {
    const on: Vec3 = [b.r[0] + 1e-9 * n[0], b.r[1] + 1e-9 * n[1], p.R]
    return { ...b, r: on, v: [b.v[0], b.v[1], 0], w: [...b.w] }
  }
  return { r, v, w: [-v[1] / p.R, v[0] / p.R, b.w[2]], s: MotionState.pivoting, pivot }
}

/**
 * Frictional inelastic impulse at a contact with unit normal n (from the
 * contact point to the ball's center): normal speed reversed and scaled by e,
 * friction μ against the contact point's slip, at most what makes it roll.
 */
export function contactImpulse(v: Vec3, w: Vec3, n: Vec3, R: number, e: number, mu: number): { v: Vec3; w: Vec3 } {
  const vn = dot(v, n)
  if (!(vn < 0)) return { v: [...v], w: [...w] }
  const dvn = -(1 + e) * vn
  // Contact point velocity v + ω × (−R n̂), tangential part.
  const vc = add(v, cross(w, scale(n, -R)))
  const slip = addScaled(vc, n, -dot(vc, n))
  const s = norm(slip)
  // Tangential impulse per unit mass J changes the slip by (7/2) J.
  const kinetic = mu * dvn
  let J: Vec3 = [0, 0, 0]
  if (s > EPS) J = kinetic < (2 / 7) * s ? scale(slip, -kinetic / s) : scale(slip, -2 / 7)
  return {
    v: add(addScaled(v, n, dvn), J),
    w: add(w, scale(cross(n, J), -2.5 / R)),
  }
}

/** The point of the open edge nearest to `r` (on the arc, or one of its ends). */
function nearestOpenEdgePoint(r: Vec3, pocket: Pocket): Vec3 {
  const pk = pocket.interior!
  const [cx, cy] = pocket.center
  const rho = pocket.radius
  const x = r[0] - cx
  const y = r[1] - cy
  const hlen = Math.hypot(x, y)
  const [ox, oy] = pk.open
  if (hlen > 0 && (x * ox + y * oy) / hlen >= pk.openCos) return [cx + (rho * x) / hlen, cy + (rho * y) / hlen, 0]
  const s = Math.sqrt(Math.max(0, 1 - pk.openCos * pk.openCos))
  const ends: Vec3[] = [1, -1].map((sign) => [cx + rho * (pk.openCos * ox - sign * s * oy), cy + rho * (pk.openCos * oy + sign * s * ox), 0])
  return norm(sub(r, ends[0]!)) <= norm(sub(r, ends[1]!)) ? ends[0]! : ends[1]!
}

/** A ball in the air meeting the open edge of the cut. */
export function resolvePocketEdge(b: BallState, pocket: Pocket, p: BallParams, config: ModelConfig["ballTable"]): BallState {
  const n = unit(sub(b.r, nearestOpenEdgePoint(b.r, pocket)))
  const { v, w } = contactImpulse(b.v, b.w, n, p.R, p.e_t, p.u_s)
  const r: Vec3 = [...b.r]
  // A ball barely over the edge (within SKIM of the slate's height) whose
  // bounce off it would be negligible (as a landing's, minBounceHeight) is
  // riding over the edge, not bouncing on it: it carries on as on the slate
  // if it is heading back out, and starts to tip over if heading in. (Its
  // center rises by at most SKIM; the speed pays for it.)
  const dz = p.R - r[2]
  const bounce = Math.max(0, dot(v, n))
  const settles = (bounce * bounce) / (2 * p.g) < config.minBounceHeight
  // A ball inside the cut (below the slate's height) that settles onto the
  // edge rather than bouncing off it stays on it and rolls or slides down
  // into the pocket: caught. (The impulse model would otherwise follow it as
  // an endless run of ever-smaller bounces.)
  if (settles && dz >= SKIM) return resolvePocket(pocket)
  if (dz >= 0 && dz < SKIM && settles) {
    const ke = v[0] * v[0] + v[1] * v[1] - 2 * p.g * dz
    if (ke > 0) {
      const k = Math.sqrt(ke / (v[0] * v[0] + v[1] * v[1]))
      const flat: Vec3 = [v[0] * k, v[1] * k, 0]
      const on: Vec3 = [r[0], r[1], p.R]
      const outward = (on[0] - pocket.center[0]) * flat[0] + (on[1] - pocket.center[1]) * flat[1] >= 0
      const riding: BallState = { r: on, v: flat, w, s: classify(on, flat, w, p) }
      return outward ? riding : resolveDrop(riding, pocket, p)
    }
  }
  const s = classify(r, v, w, p)
  return { r, v, w, s: s === MotionState.pocketed ? MotionState.airborne : s }
}

/** How far (m) below the slate's height a ball touching the edge can be and still ride over it. */
const SKIM = 1e-4
