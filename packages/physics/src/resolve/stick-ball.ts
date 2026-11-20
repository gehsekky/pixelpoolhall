/**
 * Cue strike: instantaneous point contact plus squirt.
 *
 * Physics: Alciatore, TP A-30 (cue–ball impulse) and TP A-31 (squirt).
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt).
 * Modified: rewritten in TypeScript; same model and conventions.
 */
import { classify, type BallState } from "../motion.ts"
import type { Vec3 } from "../math/vec3.ts"
import type { BallParams, CueSpecs, ModelConfig } from "../params.ts"

export interface CueStrike {
  /** Cue speed, m/s. */
  V0: number
  /** Aim direction in the table plane, degrees from +x. */
  phi: number
  /** Cue elevation, degrees. */
  theta: number
  /**
   * Contact point on the ball's surface, normalized by R: `a` is side offset
   * (positive = left of center as seen from behind the cue, i.e. left english),
   * `b` vertical offset (positive = above center). pooltool treats these as the
   * contact point itself (its tip-radius correction is documented but not
   * applied in 0.6.0); we do the same.
   */
  a: number
  b: number
}

/** Rotate a vector about the vertical axis by `angle` radians. */
const rotateZ = (v: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]
}

/** Squirt (cue-ball deflection) angle in radians; positive deflects left (TP A-31). */
export function squirtAngle(ballMass: number, endMass: number, a: number, throttle: number): number {
  const A = 1 - a * a
  return -throttle * Math.atan2(2.5 * a * Math.sqrt(A), 1 + ballMass / endMass + 2.5 * A)
}

/**
 * The ball's state just after the strike (2D: vertical velocity is dropped).
 */
export function resolveStickBall(
  ball: BallState,
  p: BallParams,
  cue: CueStrike,
  specs: CueSpecs,
  config: ModelConfig["stickBall"],
): BallState {
  const phi = (cue.phi * Math.PI) / 180
  const theta = (cue.theta * Math.PI) / 180
  // Contact point in the cue frame (a: side, c: along the cue, b: up), rotated
  // into the ball frame by the cue elevation.
  const cueC = Math.sqrt(1 - cue.a * cue.a - cue.b * cue.b)
  const qa = p.R * cue.a
  const qc = p.R * (Math.cos(theta) * cueC - Math.sin(theta) * cue.b)
  const qb = p.R * (Math.sin(theta) * cueC + Math.cos(theta) * cue.b)

  const I = (2 / 5) * p.R * p.R // moment of inertia per unit mass
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const lever = qa * qa + (qb * cos) ** 2 + (qc * sin) ** 2 - 2 * qb * qc * cos * sin
  const speed = (2 * cue.V0) / (1 + p.m / specs.M + lever / I)

  // Ball frame: y along the shot, x to the right, z up; rotated by phi + 90° into the table.
  const vBall: Vec3 = [0, -speed * cos, -speed * sin]
  const wBall: Vec3 = [(speed / I) * (-qc * sin + qb * cos), (speed / I) * qa * sin, (speed / I) * -qa * cos]
  let v = rotateZ(vBall, phi + Math.PI / 2)
  const w = rotateZ(wBall, phi + Math.PI / 2).map((x) => x * config.englishThrottle) as Vec3
  v = rotateZ(v, squirtAngle(p.m, specs.end_mass, cue.a, config.squirtThrottle))
  v[2] = 0
  const r: Vec3 = [ball.r[0], ball.r[1], ball.r[2]]
  return { r, v, w, s: classify(r, v, w, p) }
}
