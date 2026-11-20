/**
 * Airborne ball landing on the slate: a frictional inelastic impulse
 * (Alciatore TP A-14). The normal speed reverses scaled by the table
 * restitution e_t; friction (μs) acts against the contact point's slip,
 * unless less than the impulse that would stop the slip outright, in which
 * case the ball leaves rolling. Bounces lower than `minBounceHeight` are
 * killed so balls settle instead of chattering.
 *
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt).
 * Modified: rewritten in TypeScript (FrictionalInelasticTable).
 */
import { add, cross, norm, scale, squaredNorm, sub, type Vec3 } from "../math/vec3.ts"
import { classify, EPS, MotionState, type BallState } from "../motion.ts"
import type { BallParams, ModelConfig } from "../params.ts"

const Z: Vec3 = [0, 0, 1]

export function resolveBallTable(b: BallState, p: BallParams, config: ModelConfig["ballTable"]): BallState {
  // Contact placement: on the table.
  const r: Vec3 = [b.r[0], b.r[1], p.R]
  if (!(b.v[2] < 0)) throw new Error("ball-table collision needs a downward velocity")
  const dvPerpMag = (1 + p.e_t) * -b.v[2]
  const vi: Vec3 = [b.v[0], b.v[1], 0]
  const wi = b.w
  // Contact point velocity: v + ω × (−R ẑ).
  const vc = add(vi, cross(wi, [0, 0, -p.R]))
  const slipping = squaredNorm(vc) > EPS * EPS
  const vcHat = slipping ? scale(vc, 1 / norm(vc)) : ([0, 0, 0] as Vec3)
  const dvSlip = slipping ? scale(vcHat, -p.u_s * dvPerpMag) : ([0, 0, 0] as Vec3)
  const dvNoSlip = scale(sub(scale(cross(wi, Z), p.R), vi), 2 / 7)
  let v: Vec3
  let w: Vec3
  if (!slipping || squaredNorm(dvNoSlip) <= squaredNorm(dvSlip)) {
    v = add(add(b.v, [0, 0, dvPerpMag]), dvNoSlip)
    w = add(wi, scale(add(scale(wi, -1), scale(cross(Z, vi), 1 / p.R)), 5 / 7))
  } else {
    v = add(add(b.v, [0, 0, dvPerpMag]), dvSlip)
    w = add(wi, scale(cross(Z, vcHat), (2.5 / p.R) * norm(dvSlip)))
  }
  if ((0.5 * v[2] * v[2]) / p.g < config.minBounceHeight) v[2] = 0
  return { r, v, w, s: classify(r, v, w, p) }
}

/** A ball that left the table stays where it crossed the edge, with no motion. */
export function resolveOffTable(b: BallState): BallState {
  return { r: [b.r[0], b.r[1], b.r[2]], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.offTable }
}
