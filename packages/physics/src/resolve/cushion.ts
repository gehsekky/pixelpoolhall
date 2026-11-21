/**
 * Ball–cushion collisions (straight rails and jaws) with Stronge's compliant
 * model, plus pooltool's contact placement (make_kiss).
 *
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt).
 * Modified: rewritten in TypeScript.
 */
import { createRoots, solveQuadratic } from "../math/roots/index.ts"
import { smallestMagnitudeReal } from "../math/roots/select.ts"
import { add, addScaled, cross, dot, norm, scale, sub, surfaceVelocity, unit, type Vec3 } from "../math/vec3.ts"
import { classify, isNontranslating, MotionState, type BallState } from "../motion.ts"
import type { BallParams, ModelConfig } from "../params.ts"
import { unitAxis, type CircularCushion, type LinearCushion } from "../table.ts"
import { MIN_DIST } from "./ball-ball.ts"
import { mathavanCushion } from "./mathavan.ts"
import { resolveCompliantCollision } from "./stronge.ts"

/** make_kiss falls back to normal placement if the velocity-based move exceeds this many MIN_DISTs. */
const FALLBACK_DISPLACEMENT_FACTOR = 5
const roots = createRoots()

function closestPointOnLine(p1: Vec3, p2: Vec3, p: Vec3): Vec3 {
  const d = sub(p2, p1)
  const t = -dot(sub(p1, p), d) / dot(d, d)
  return addScaled(p1, d, t)
}

/** Unit normal from the rail's nose line to the ball center (3D). */
export function linearNormal(c: LinearCushion, r: Vec3): Vec3 {
  const u = unitAxis(c)
  const q = sub(r, c.p1)
  return unit(addScaled(q, u, -dot(q, u)))
}

/** Unit normal from the jaw's center point (at cushion height) to the ball center (3D, as in pooltool). */
export const circularNormal = (c: CircularCushion, r: Vec3): Vec3 => unit(sub(r, c.center))

/**
 * Rotate `pos` about the rail axis, keeping its distance to the axis, until
 * the ball sits on the table (z = R); keeps the ball on its side of the rail.
 */
function constrainToTable(pos: Vec3, c: LinearCushion, R: number, airborne: boolean): Vec3 {
  if (airborne ? pos[2] >= R : pos[2] === R) return pos
  const foot = closestPointOnLine(c.p1, c.p2, pos)
  const arm = sub(pos, foot)
  const len = norm(arm)
  const u = unitAxis(c)
  const h: Vec3 = [u[1], -u[0], 0]
  const a = (R - foot[2]) / len
  const side = dot(arm, h) >= 0 ? 1 : -1
  const b = side * Math.sqrt(1 - a * a)
  return add(foot, scale(add([0, 0, a], scale(h, b)), len))
}

export function makeKissLinear(b: BallState, c: LinearCushion, R: number): Vec3 {
  const target = R + c.noseRadius + MIN_DIST
  const fallback = () => {
    const foot = closestPointOnLine(c.p1, c.p2, b.r)
    const candidate = addScaled(foot, unit(sub(b.r, foot)), target)
    return constrainToTable(candidate, c, R, b.s === MotionState.airborne)
  }
  if (isNontranslating(b.s)) return fallback()
  const u = unitAxis(c)
  const q = sub(b.r, c.p1)
  const vPerp = addScaled(b.v, u, -dot(b.v, u))
  const qPerp = addScaled(q, u, -dot(q, u))
  solveQuadratic(dot(vPerp, vPerp), 2 * dot(qPerp, vPerp), dot(qPerp, qPerp) - target * target, roots)
  const t = smallestMagnitudeReal(roots)
  if (!Number.isFinite(t) || norm(scale(b.v, t)) > FALLBACK_DISPLACEMENT_FACTOR * MIN_DIST) return fallback()
  return constrainToTable(addScaled(b.r, b.v, t), c, R, b.s === MotionState.airborne)
}

export function makeKissCircular(b: BallState, c: CircularCushion, R: number): Vec3 {
  const target = R + c.radius + MIN_DIST
  const center: Vec3 = [c.center[0], c.center[1], b.r[2]]
  const fallback = () => addScaled(center, unit(sub(b.r, center)), target)
  if (isNontranslating(b.s)) return fallback()
  const dx = b.r[0] - center[0]
  const dy = b.r[1] - center[1]
  solveQuadratic(b.v[0] ** 2 + b.v[1] ** 2, 2 * (dx * b.v[0] + dy * b.v[1]), dx * dx + dy * dy - target * target, roots)
  const t = smallestMagnitudeReal(roots)
  if (!(norm(scale(b.v, t)) <= FALLBACK_DISPLACEMENT_FACTOR * MIN_DIST)) return fallback()
  return addScaled(b.r, b.v, t)
}

/** Normal speed of the contact point along n (negative = closing). */
const closingSpeed = (b: BallState, n: Vec3, p: BallParams) => dot(n, surfaceVelocity(b.v, b.w, scale(n, -1), p.R))

/**
 * Apply Stronge's model at a contact with outward unit normal n (from cushion
 * to ball). A contact that isn't closing along n gets no impulse: the ball is
 * already leaving. (pooltool raises an assertion error there; it only arises
 * in 3D, see resolveCircularCushion.)
 */
function strongeImpulse(b: BallState, n: Vec3, p: BallParams, omegaRatio: number): { v: Vec3; w: Vec3 } {
  const beta_t = 3.5
  const beta_n = 1
  const vc = surfaceVelocity(b.v, b.w, scale(n, -1), p.R)
  const vn0 = dot(n, vc)
  if (!(vn0 < 0)) return { v: [...b.v], w: [...b.w] }
  const nxv = cross(n, vc)
  const vt0 = -norm(nxv) // tangent direction chosen so v_t0 <= 0
  const t: Vec3 = vt0 !== 0 ? scale(cross(nxv, n), 1 / vt0) : [0, 0, 0]
  const { vt, vn } = resolveCompliantCollision(vt0, vn0, p.m, beta_t, beta_n, p.f_c, p.e_c, 1e3, beta_t / beta_n / omegaRatio ** 2)
  const dvn = (vn - vn0) / beta_n
  const dvt = (vt - vt0) / beta_t
  const v = addScaled(addScaled(b.v, n, dvn), t, dvt)
  const w = add(b.w, scale(cross(scale(n, -1), scale(t, dvt)), 2.5 / p.R))
  return { v, w }
}

function finish(r: Vec3, v: Vec3, w: Vec3, p: BallParams, threeD: boolean): BallState {
  if (!threeD) v[2] = 0
  return { r, v, w, s: classify(r, v, w, p) }
}

/**
 * pooltool's in-plane rail normal, from the rail's line toward the ball,
 * built from the line's general form (l_x x + l_y y + l_0 = 0).
 */
function linearNormalXY(c: LinearCushion, r: Vec3): Vec3 {
  const [p1x, p1y] = c.p1
  const [p2x, p2y] = c.p2
  const vertical = p2x - p1x === 0
  const lx = vertical ? 1 : -(p2y - p1y) / (p2x - p1x)
  const ly = vertical ? 0 : 1
  const l0 = vertical ? -p1x : ((p2y - p1y) / (p2x - p1x)) * p1x - p1y
  const n = unit([lx, ly, 0])
  return lx * r[0] + ly * r[1] + l0 >= 0 ? n : scale(n, -1)
}

/** Mathavan's model at a contact whose in-plane normal (cushion to ball) is n. */
function mathavan(b: BallState, r: Vec3, n: Vec3, h: number, p: BallParams, config: ModelConfig["cushion"], threeD: boolean): BallState {
  const out = mathavanCushion(r, b.v, b.w, scale(n, -1), p.m, p.R, {
    e_c: p.e_c, f_c: p.f_c, u_s: p.u_s, h, maxSteps: config.maxSteps, deltaP: config.deltaP,
  })
  return finish(out.r, out.v, out.w, p, threeD)
}

export function resolveLinearCushion(b: BallState, c: LinearCushion, p: BallParams, config: ModelConfig["cushion"], threeD = false): BallState {
  const r = makeKissLinear(b, c, p.R)
  if (config.model === "mathavan" && b.s !== MotionState.airborne) return mathavan(b, r, linearNormalXY(c, r), c.p1[2], p, config, threeD)
  const { v, w } = strongeImpulse({ ...b, r }, linearNormal(c, r), p, config.omegaRatio)
  return finish(r, v, w, p, threeD)
}

export function resolveCircularCushion(b: BallState, c: CircularCushion, p: BallParams, config: ModelConfig["cushion"], threeD = false): BallState {
  const r = makeKissCircular(b, c, p.R)
  if (config.model === "mathavan" && b.s !== MotionState.airborne) {
    return mathavan(b, r, unit([r[0] - c.center[0], r[1] - c.center[1], 0]), c.center[2], p, config, threeD)
  }
  let n = circularNormal(c, r)
  // pooltool's jaw normal points from a point at cushion height, so it tilts
  // vertically, while jaw contact is detected in the table plane. In 3D a
  // hopping ball can be approaching in the plane yet separating along the
  // tilted normal (pooltool asserts there). Then use the horizontal normal of
  // the vertical cylinder the detector used, which is closing.
  if (!(closingSpeed({ ...b, r }, n, p) < 0)) n = unit([r[0] - c.center[0], r[1] - c.center[1], 0])
  const { v, w } = strongeImpulse({ ...b, r }, n, p, config.omegaRatio)
  return finish(r, v, w, p, threeD)
}
