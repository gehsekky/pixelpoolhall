/**
 * Next-event times for each kind of contact, as delays from the balls'
 * current states. Between events each ball's center follows a parabola
 * r(τ) = r + v τ + h τ² (h = half the acceleration), so contact conditions
 * are polynomials in τ: quartics for ball–ball, jaws and pockets, and
 * quadratics for straight rails (a line offset in the table plane).
 *
 * Acceptance rules (approach tests, segment bounds, near-real roots) follow
 * pooltool 0.6.0's 2D detectors so the engines see the same events.
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt).
 * Modified: rewritten in TypeScript using our own root solvers.
 */
import { createRoots, solveQuadratic, solveQuartic, type Roots } from "./math/roots/index.ts"
import { isRealRoot, smallestNonnegativeReal } from "./math/roots/select.ts"
import { evolve, EPS, halfAcceleration, isNontranslating, isOutOfPlay, MotionState, type BallState } from "./motion.ts"
import type { BallParams } from "./params.ts"
import { cushionHeight, CushionSide, lineCoefficients, type CircularCushion, type LinearCushion, type Pocket } from "./table.ts"

const roots: Roots = createRoots()

/** Solve A t⁴ + B t³ + C t² + D t + E, dropping to a quadratic when the motion is uniform (A = B = 0). */
function solveContactQuartic(A: number, B: number, C: number, D: number, E: number): Roots {
  if (A === 0) solveQuadratic(C, D, E, roots)
  else solveQuartic(A, B, C, D, E, roots)
  return roots
}

/** Ball–ball contact (centers 2R apart), the first time the balls are approaching. */
export function ballBallTime(b1: BallState, p1: BallParams, b2: BallState, p2: BallParams): number {
  if (isOutOfPlay(b1.s) || isOutOfPlay(b2.s)) return Infinity
  if (isNontranslating(b1.s) && isNontranslating(b2.s)) return Infinity
  const h1 = halfAcceleration(b1, p1)
  const h2 = halfAcceleration(b2, p2)
  const v1 = isNontranslating(b1.s) ? [0, 0] : b1.v
  const v2 = isNontranslating(b2.s) ? [0, 0] : b2.v
  // Relative motion of ball 2 from ball 1 in the table plane: C + B τ + A τ².
  const Ax = h2[0] - h1[0]
  const Ay = h2[1] - h1[1]
  const Bx = v2[0]! - v1[0]!
  const By = v2[1]! - v1[1]!
  const Cx = b2.r[0] - b1.r[0]
  const Cy = b2.r[1] - b1.r[1]
  const R = p1.R
  const rs = solveContactQuartic(
    Ax * Ax + Ay * Ay,
    2 * (Ax * Bx + Ay * By),
    Bx * Bx + By * By + 2 * (Ax * Cx + Ay * Cy),
    2 * (Bx * Cx + By * Cy),
    Cx * Cx + Cy * Cy - 4 * R * R,
  )
  let best = Infinity
  for (let i = 0; i < rs.count; i++) {
    const t = rs.re[i]!
    if (!(t >= 0 && t < best) || !isRealRoot(t, rs.im[i]!)) continue
    // Approaching: d/dt |separation|² < 0.
    const dx = Cx + Bx * t + Ax * t * t
    const dy = Cy + By * t + Ay * t * t
    if (dx * (Bx + 2 * Ax * t) + dy * (By + 2 * Ay * t) >= 0) continue
    best = t
  }
  return best
}

/** Whether two balls' centers are closer than R1 + R2 (they overlap now). */
export function ballsOverlap(b1: BallState, b2: BallState, R1: number, R2: number): boolean {
  return Math.hypot(b1.r[0] - b2.r[0], b1.r[1] - b2.r[1], b1.r[2] - b2.r[2]) < R1 + R2
}

/**
 * Straight rail. The ball touches the nose cylinder (radius n at height h)
 * when its center is `contact = sqrt((R + n)² − (h − R)²)` from the rail line
 * in the table plane, which is linear in the line equation: a quadratic in τ.
 */
export function linearCushionTime(b: BallState, p: BallParams, c: LinearCushion): number {
  if (isNontranslating(b.s) || b.s === MotionState.airborne) return Infinity
  const h = cushionHeight(c)
  const contactSq = (p.R + c.noseRadius) ** 2 - (h - p.R) ** 2
  if (contactSq <= 0) return Infinity
  const contact = Math.sqrt(contactSq)
  const { lx, ly, l0 } = lineCoefficients(c)
  const ln = Math.hypot(lx, ly)
  const acc = halfAcceleration(b, p)
  const A = lx * acc[0] + ly * acc[1]
  const B = lx * b.v[0] + ly * b.v[1]
  const C0 = l0 + lx * b.r[0] + ly * b.r[1]
  const offsets = c.side === CushionSide.side1 ? [contact] : c.side === CushionSide.side2 ? [-contact] : [contact, -contact]
  const dx = c.p2[0] - c.p1[0]
  const dy = c.p2[1] - c.p1[1]
  const len2 = dx * dx + dy * dy
  let best = Infinity
  for (const off of offsets) {
    solveQuadratic(A, B, C0 + off * ln, roots)
    for (let i = 0; i < roots.count; i++) {
      const t = roots.re[i]!
      if (Math.abs(roots.im[i]!) > EPS || t <= EPS || t >= best) continue
      const at = evolve(b, p, t)
      // Contact point must lie within the segment.
      const s = ((at.r[0] - c.p1[0]) * dx + (at.r[1] - c.p1[1]) * dy) / len2
      if (!(s >= 0 && s <= 1)) continue
      const signed = l0 + lx * at.r[0] + ly * at.r[1]
      const normalSpeed = (lx * at.v[0] + ly * at.v[1]) / ln
      if (-Math.sign(signed) * normalSpeed <= EPS) continue
      best = t
    }
  }
  return best
}

/** Ball center reaching distance `dist` from a vertical axis through (a, b): smallest real τ ≥ 0. */
function circleTime(b: BallState, p: BallParams, a: number, bb: number, dist: number): number {
  if (isNontranslating(b.s) || b.s === MotionState.airborne) return Infinity
  const acc = halfAcceleration(b, p)
  const ax = acc[0]
  const ay = acc[1]
  const vx = b.v[0]
  const vy = b.v[1]
  const cx = b.r[0] - a
  const cy = b.r[1] - bb
  return smallestNonnegativeReal(
    solveContactQuartic(
      0.5 * (ax * ax + ay * ay),
      ax * vx + ay * vy,
      ax * cx + ay * cy + 0.5 * (vx * vx + vy * vy),
      vx * cx + vy * cy,
      0.5 * (cx * cx + cy * cy - dist * dist),
    ),
  )
}

/** Jaw: center reaches radius + R from the jaw axis. */
export const circularCushionTime = (b: BallState, p: BallParams, c: CircularCushion): number =>
  circleTime(b, p, c.center[0], c.center[1], c.radius + p.R)

/** Pocket capture: center enters the pocket circle. */
export const pocketTime = (b: BallState, p: BallParams, pocket: Pocket): number =>
  circleTime(b, p, pocket.center[0], pocket.center[1], pocket.radius)
