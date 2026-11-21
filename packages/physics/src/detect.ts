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
import { EPS, evolve, halfAcceleration, isNontranslating, isOutOfPlay, MotionState, type BallState } from "./motion.ts"
import type { BallParams } from "./params.ts"
import { cushionHeight, CushionSide, lineCoefficients, type CircularCushion, type LinearCushion, type Pocket, type PocketInterior } from "./table.ts"

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
/** Distance in the table plane from the rail line to a touching ball's center (NaN if the nose is out of reach). */
export function contactDistance(R: number, c: LinearCushion): number {
  const sq = (R + c.noseRadius) ** 2 - (cushionHeight(c) - R) ** 2
  return sq > 0 ? Math.sqrt(sq) : NaN
}

export function linearCushionTime(b: BallState, p: BallParams, c: LinearCushion): number {
  if (isNontranslating(b.s) || b.s === MotionState.airborne) return Infinity
  const contact = contactDistance(p.R, c)
  if (!(contact > 0)) return Infinity
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
      // Position and velocity at the root, on the current parabola.
      const x = b.r[0] + b.v[0] * t + acc[0] * t * t
      const y = b.r[1] + b.v[1] * t + acc[1] * t * t
      const vx = b.v[0] + 2 * acc[0] * t
      const vy = b.v[1] + 2 * acc[1] * t
      // Contact point must lie within the segment.
      const s = ((x - c.p1[0]) * dx + (y - c.p1[1]) * dy) / len2
      if (!(s >= 0 && s <= 1)) continue
      const signed = l0 + lx * x + ly * y
      const normalSpeed = (lx * vx + ly * vy) / ln
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

/** Pocket capture: center enters the pocket circle (airborne balls: see airbornePocketTime). */
export const pocketTime = (b: BallState, p: BallParams, pocket: Pocket): number =>
  b.s === MotionState.airborne ? airbornePocketTime(b, p, pocket) : circleTime(b, p, pocket.center[0], pocket.center[1], pocket.radius)

// ---------------------------------------------------------------- 3D
//
// pooltool 0.6's 3D detectors (`is_3d=True`): full 3D parabolas, so airborne
// balls collide with balls and rails in the air; plus landing (ball–table),
// leaving the table, and capture of airborne balls by pockets.

/** Ball–ball contact in 3D: |r1(τ) − r2(τ)| = R1 + R2 with balls approaching (τ ≥ 0). */
export function ballBallTime3D(b1: BallState, p1: BallParams, b2: BallState, p2: BallParams): number {
  if (isOutOfPlay(b1.s) || isOutOfPlay(b2.s)) return Infinity
  if (isNontranslating(b1.s) && isNontranslating(b2.s)) return Infinity
  const h1 = halfAcceleration(b1, p1)
  const h2 = halfAcceleration(b2, p2)
  // Relative position of ball 1 from ball 2, per axis: c + b τ + a τ².
  const a = [h1[0] - h2[0], h1[1] - h2[1], h1[2] - h2[2]]
  const b = [b1.v[0] - b2.v[0], b1.v[1] - b2.v[1], b1.v[2] - b2.v[2]]
  const c = [b1.r[0] - b2.r[0], b1.r[1] - b2.r[1], b1.r[2] - b2.r[2]]
  const d = p1.R + p2.R
  const dot = (x: number[], y: number[]) => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!
  const rs = solveContactQuartic(
    dot(a, a) / 2,
    dot(a, b),
    dot(a, c) + dot(b, b) / 2,
    dot(b, c),
    (dot(c, c) - d * d) / 2,
  )
  let best = Infinity
  for (let i = 0; i < rs.count; i++) {
    const t = rs.re[i]!
    if (!(t >= 0 && t < best) || !isRealRoot(t, rs.im[i]!)) continue
    let closing = 0
    for (let k = 0; k < 3; k++) closing += (c[k]! + b[k]! * t + a[k]! * t * t) * (b[k]! + 2 * a[k]! * t)
    if (closing >= 0) continue
    best = t
  }
  return best
}

/**
 * Straight rail in 3D: the ball center reaches distance R + nose radius from
 * the nose axis. In the plane perpendicular to the axis (horizontal X across
 * the rail, vertical Y) that's a parabola meeting a circle, a quartic. The
 * contact must fall strictly inside the segment, with the ball approaching.
 */
export function linearCushionTime3D(b: BallState, p: BallParams, c: LinearCushion): number {
  if (isNontranslating(b.s)) return Infinity
  const h = halfAcceleration(b, p)
  const ax = c.p2[0] - c.p1[0]
  const ay = c.p2[1] - c.p1[1]
  const len = Math.hypot(ax, ay)
  const ux = ax / len
  const uy = ay / len
  // Basis: e1 = (uy, -ux, 0) across the rail, e2 = z.
  const qx = b.r[0] - c.p1[0]
  const qy = b.r[1] - c.p1[1]
  const X = [qx * uy - qy * ux, b.v[0] * uy - b.v[1] * ux, h[0] * uy - h[1] * ux]
  const Y = [b.r[2] - c.p1[2], b.v[2], h[2]]
  const A = [qx * ux + qy * uy, b.v[0] * ux + b.v[1] * uy, h[0] * ux + h[1] * uy]
  const rad = c.noseRadius + p.R
  const rs = solveContactQuartic(
    (X[2]! * X[2]! + Y[2]! * Y[2]!) / 2,
    X[2]! * X[1]! + Y[2]! * Y[1]!,
    X[2]! * X[0]! + Y[2]! * Y[0]! + (X[1]! * X[1]! + Y[1]! * Y[1]!) / 2,
    X[1]! * X[0]! + Y[1]! * Y[0]!,
    (X[0]! * X[0]! + Y[0]! * Y[0]! - rad * rad) / 2,
  )
  let best = Infinity
  for (let i = 0; i < rs.count; i++) {
    const t = rs.re[i]!
    if (t <= 0 || t >= best || !isRealRoot(t, rs.im[i]!)) continue
    const along = A[0]! + A[1]! * t + A[2]! * t * t
    if (!(along > 0 && along < len)) continue
    const x = X[0]! + X[1]! * t + X[2]! * t * t
    const y = Y[0]! + Y[1]! * t + Y[2]! * t * t
    if (x * (X[1]! + 2 * X[2]! * t) + y * (Y[1]! + 2 * Y[2]! * t) > 0) continue
    best = t
  }
  return best
}

/** Time until an airborne ball comes down to the table (z = R): the later root of z(τ) = R. */
export function landingTime(b: BallState, p: BallParams): number {
  if (b.s !== MotionState.airborne) return Infinity
  if (p.g === 0) return Infinity
  solveQuadratic(-0.5 * p.g, b.v[2], b.r[2] - p.R, roots)
  // Real roots only: a ball below the slate's level (in a pocket) never comes down to it.
  let t = -Infinity
  for (let i = 0; i < roots.count; i++) if (roots.im[i] === 0) t = Math.max(t, roots.re[i]!)
  // (Both roots in the past: a ball under the slate's level, in a pocket.)
  return t < 0 ? Infinity : t
}

/**
 * Time until an airborne ball leaves the table: its center crosses the edge
 * of the playing surface, or, if its flight carries it into a pocket's
 * circle first, the far side of that circle (pooltool's ball_off_table_time;
 * for a pocket with an interior, being over its cut at the crossing is enough).
 */
export function offTableTime(b: BallState, p: BallParams, size: { w: number; l: number }, pockets: readonly Pocket[]): number {
  if (b.s !== MotionState.airborne) return Infinity
  const [x, y] = b.r
  const [vx, vy] = b.v
  let tEdge = Infinity
  if (vx < 0) tEdge = Math.min(tEdge, (0 - x) / vx)
  else if (vx > 0) tEdge = Math.min(tEdge, (size.w - x) / vx)
  if (vy < 0) tEdge = Math.min(tEdge, (0 - y) / vy)
  else if (vy > 0) tEdge = Math.min(tEdge, (size.l - y) / vy)
  if (tEdge === Infinity) return Infinity
  tEdge = Math.max(tEdge, 0)
  const tLand = landingTime(b, p)
  const A = vx * vx + vy * vy
  let tOff = tEdge
  for (const pk of pockets) {
    const px = x - pk.center[0]
    const py = y - pk.center[1]
    const B = 2 * (px * vx + py * vy)
    const C = px * px + py * py - pk.radius * pk.radius
    const disc = B * B - 4 * A * C
    if (disc <= 0) continue
    const root = Math.sqrt(disc)
    const tIn = (-B - root) / (2 * A)
    const tOut = (-B + root) / (2 * A)
    if (tOut <= tEdge) continue
    // Over a pocket's slate cut when crossing the edge, the ball is in the
    // pocket (it falls, or meets the back wall) until it flies out of the cut.
    if (pk.interior) {
      const ex = px + vx * tEdge
      const ey = py + vy * tEdge
      if (ex * ex + ey * ey > pk.radius * pk.radius * (1 + 1e-9)) continue
    } else if (tIn > tLand) continue
    tOff = Math.max(tOff, tOut)
  }
  return tOff
}

/**
 * Pocket capture of an airborne ball (pooltool's
 * ball_pocket_collision_time_if_airborne): captured if it lands inside the
 * pocket circle (just before landing), or if it crosses the circle without
 * dipping below the table plane on the way in and leaves it below (7/5)R.
 */
export function airbornePocketTime(b: BallState, p: BallParams, pocket: Pocket): number {
  const a = pocket.center[0]
  const bb = pocket.center[1]
  const r = pocket.radius
  const vx = b.v[0]
  const vy = b.v[1]
  const tLand = landingTime(b, p)
  const x = b.r[0] + vx * tLand
  const y = b.r[1] + vy * tLand
  if ((x - a) ** 2 + (y - bb) ** 2 < r * r) return Math.max(tLand - EPS, 0)
  const cx = b.r[0]
  const cy = b.r[1]
  solveQuadratic(0.5 * (vx * vx + vy * vy), vx * (cx - a) + vy * (cy - bb), 0.5 * (a * a + bb * bb + cx * cx + cy * cy - r * r) - (cx * a + cy * bb), roots)
  if (roots.count < 2 || Math.abs(roots.im[0]!) > 1e-9 || Math.abs(roots.im[1]!) > 1e-9) return Infinity
  const r1 = Math.min(roots.re[0]!, roots.re[1]!)
  const r2 = Math.max(roots.re[0]!, roots.re[1]!)
  if (r1 < 0) return Infinity
  const z0 = b.r[2]
  const v0z = b.v[2]
  const h0 = -0.5 * p.g * r1 * r1 + v0z * r1 + z0
  const hf = -0.5 * p.g * r2 * r2 + v0z * r2 + z0
  if (h0 < p.R) return Infinity
  if (hf > (7 / 5) * p.R) return Infinity
  return (r1 + r2) / 2
}

// ---- Pocket interiors (3D; see PocketInterior) ----

/** What a ball meets next in a pocket's interior. */
export const PocketEvent = { none: 0, drop: 1, capture: 2, wall: 3, edge: 4 } as const
export type PocketEvent = (typeof PocketEvent)[keyof typeof PocketEvent]

/** A ball closer to the edge than this (m) is touching it. */
const EDGE_TOL = 1e-9

/**
 * Distance from a point (relative to the cut's center) to the open part of
 * the edge (the arc of the circle of radius ρ at z = 0 facing the table),
 * and the unit vector from the nearest edge point to the point.
 */
function openEdgeDistance(x: number, y: number, z: number, rho: number, pk: PocketInterior, dir: Float64Array): number {
  const h = Math.hypot(x, y)
  const [ox, oy] = pk.open
  let qx: number
  let qy: number
  if (h > 0 && (x * ox + y * oy) / h >= pk.openCos) {
    qx = (rho * x) / h
    qy = (rho * y) / h
  } else {
    // Nearest end of the arc.
    const s = Math.sqrt(Math.max(0, 1 - pk.openCos * pk.openCos))
    const ax = rho * (pk.openCos * ox - s * oy)
    const ay = rho * (pk.openCos * oy + s * ox)
    const bx = rho * (pk.openCos * ox + s * oy)
    const by = rho * (pk.openCos * oy - s * ox)
    const useA = (x - ax) ** 2 + (y - ay) ** 2 <= (x - bx) ** 2 + (y - by) ** 2
    qx = useA ? ax : bx
    qy = useA ? ay : by
  }
  const d = Math.hypot(x - qx, y - qy, z)
  dir[0] = (x - qx) / d
  dir[1] = (y - qy) / d
  dir[2] = z / d
  return d
}

const edgeDir = new Float64Array(3)

/**
 * When an airborne ball touches the open edge, within [0, T]. The gap
 * d(t) = distance − R has d'' ≤ g + |v|²/R while the ball is clear of the
 * edge (the distance to a curve curves at most 1/distance), so
 *   d(t + s) ≥ d + d' s − ½ M s²,  M = g + 2 v²max / R,
 * and stepping to the first zero of that bound never steps past the first
 * contact: about a Newton step when approaching, long strides when leaving.
 * A ball that starts on the edge and is leaving it (just let go by a pivot,
 * or bounced) is first followed in doubling steps until it is clear;
 * pressing further in on the way is a contact.
 */
function edgeTime(b: BallState, p: BallParams, pocket: Pocket, T: number): number {
  const pk = pocket.interior!
  const [cx, cy] = pocket.center
  const x0 = b.r[0] - cx
  const y0 = b.r[1] - cy
  const [vx, vy, vz] = b.v
  const g = p.g
  const rho = pocket.radius
  const gap = (t: number) => openEdgeDistance(x0 + vx * t, y0 + vy * t, b.r[2] + vz * t - 0.5 * g * t * t, rho, pk, edgeDir) - p.R
  const v2max = vx * vx + vy * vy + Math.max(vz * vz, (vz - g * T) ** 2)
  const M = g + (2 * v2max) / p.R
  let t = 0
  let d = gap(0)
  if (d < EDGE_TOL) {
    const d0 = d
    let step = 1e-7
    while (d < EDGE_TOL) {
      t += step
      if (t > T) return Infinity
      d = gap(t)
      if (d < Math.min(d0, 0) - EDGE_TOL) return t
      step *= 2
    }
  }
  for (let i = 0; i < 10_000; i++) {
    if (d < EDGE_TOL) return t
    // d' = (unit vector from the edge) · velocity.
    const rate = edgeDir[0] * vx + edgeDir[1] * vy + edgeDir[2] * (vz - g * t)
    t += (rate + Math.sqrt(rate * rate + 2 * M * d)) / M
    if (t > T) return Infinity
    d = gap(t)
  }
  return t
}

/**
 * The next event between a ball and a pocket with an interior, as a delay:
 * - on the slate: its center reaches the edge of the cut (it starts to drop);
 * - in the air: it hits the open edge; or it is captured: its center falls
 *   to the slate's level inside the cut (it can no longer get back out), or
 *   it reaches the wall around the cut;
 * - pivoting: nothing (it is on its way in).
 */
export function pocketInteriorTime(b: BallState, p: BallParams, pocket: Pocket): { time: number; kind: PocketEvent } {
  if (b.s === MotionState.pivoting) return { time: Infinity, kind: PocketEvent.none }
  const [cx, cy] = pocket.center
  const rho = pocket.radius
  if (b.s !== MotionState.airborne) {
    // Crossing inward only (a ball riding over the edge leaves the circle outward).
    const t = circleTime(b, p, cx, cy, rho)
    if (t === Infinity) return { time: t, kind: PocketEvent.none }
    const at = evolve(b, p, t)
    const inward = (at.r[0] - cx) * at.v[0] + (at.r[1] - cy) * at.v[1] < 0
    return inward ? { time: t, kind: PocketEvent.drop } : { time: Infinity, kind: PocketEvent.none }
  }
  const pk = pocket.interior!
  const [x0, y0, z0] = [b.r[0] - cx, b.r[1] - cy, b.r[2]]
  const [vx, vy, vz] = b.v
  const zAt = (t: number) => z0 + vz * t - 0.5 * p.g * t * t
  let best = { time: Infinity, kind: PocketEvent.none as PocketEvent }
  // Capture: the center falls to the slate's level inside the cut.
  const tz = z0 <= 0 ? 0 : (vz + Math.sqrt(vz * vz + 2 * p.g * z0)) / p.g
  if ((x0 + vx * tz) ** 2 + (y0 + vy * tz) ** 2 < rho * rho) best = { time: tz, kind: PocketEvent.capture }
  // The wall around the cut above the slate (the facings' undercut faces and
  // the liner at the back): the center's distance from the axis grows to
  // ρ − R where there is wall, or to ρ outside the open arc (a ball slipping
  // past the end of the open edge). Below the rail's top, either sends the
  // ball down into the pocket (WPA §10): captured.
  const A = vx * vx + vy * vy
  if (A > 0) {
    const B = 2 * (x0 * vx + y0 * vy)
    for (const dist of [rho - p.R, rho]) {
      const C = x0 * x0 + y0 * y0 - dist * dist
      const disc = B * B - 4 * A * C
      if (disc < 0) continue
      const t = (-B + Math.sqrt(disc)) / (2 * A)
      const x = x0 + vx * t
      const y = y0 + vy * t
      const z = zAt(t)
      const open = (x * pk.open[0] + y * pk.open[1]) / Math.hypot(x, y) >= pk.openCos
      if (t > 1e-12 && t < best.time && !open && z > 0 && z < pk.wallTop) best = { time: t, kind: PocketEvent.wall }
    }
  }
  // The open edge, before either.
  const te = edgeTime(b, p, pocket, Math.min(best.time, tz))
  if (te < best.time) best = { time: te, kind: PocketEvent.edge }
  return best
}
