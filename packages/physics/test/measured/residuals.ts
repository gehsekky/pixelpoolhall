/**
 * Our predictions against each measured dataset, as residuals (prediction −
 * measurement) with their units.
 */
import { DEFAULT_BALL_PARAMS, type BallParams } from "../../src/params.ts"
import { BALL_BALL_SPEEDS, CUSHION_REBOUND_SPEED, RAIL_REBOUND_ANGLE, SNOOKER, THROW } from "./data.ts"
import { fromRail, inPerYd, railHit, rollingSpeedsAfterHit, throwAngle, type Setup } from "./experiments.ts"

export interface Comparison {
  label: string
  predicted: number
  measured: number
}

export const rms = (cs: Comparison[]): number => Math.sqrt(cs.reduce((s, c) => s + (c.predicted - c.measured) ** 2, 0) / cs.length)
export const maxAbs = (cs: Comparison[]): number => Math.max(...cs.map((c) => Math.abs(c.predicted - c.measured)))

/** Snooker ball parameters with everything else (friction, restitution) from `p`. */
export const snooker = (p: BallParams): BallParams => ({ ...p, R: SNOOKER.R, m: SNOOKER.m })

/** Pool cushion nose height used by the WPA table (0.635 × ball diameter). */
const POOL_NOSE = 0.635 * 2 * DEFAULT_BALL_PARAMS.R

/**
 * "Slow" in Alciatore & Jewett's rail data isn't quantified; Alciatore's
 * speed scale calls 4 km/h soft. (The closed-form cushion model's angles
 * don't depend on speed; Mathavan's change by under 0.5° from 0.5 to 2 m/s.)
 */
export const RAIL_SPEED = 4 / 3.6

/** Rail rebound angles (degrees from the rail), immediate and effective. */
export function railAngles(s: Setup): { immediate: Comparison[]; effective: Comparison[] } {
  const immediate: Comparison[] = []
  const effective: Comparison[] = []
  RAIL_REBOUND_ANGLE.in.forEach((a, i) => {
    const h = railHit(s, RAIL_SPEED, a, POOL_NOSE)
    immediate.push({ label: `${a}°`, predicted: fromRail(h.after), measured: RAIL_REBOUND_ANGLE.immediate[i]! })
    effective.push({ label: `${a}°`, predicted: h.rolling ? fromRail(h.rolling) : NaN, measured: RAIL_REBOUND_ANGLE.effective[i]! })
  })
  return { immediate, effective }
}

/** Incoming speeds at which the cushion rebound curve is compared (m/s, within the measured range). */
export const REBOUND_SPEEDS = [0.3, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5]

/** Rebound speed straight off a snooker cushion (m/s), against the measured fit. Snooker balls. */
export function cushionRebound(s: Setup): Comparison[] {
  return REBOUND_SPEEDS.map((v) => {
    const h = railHit(s, v, 90, SNOOKER.cushionHeight)
    return { label: `${v} m/s`, predicted: Math.hypot(...h.after), measured: CUSHION_REBOUND_SPEED.rebound(v) }
  })
}

/** Object ball throw (inches per yard). */
export function throwInches(s: Setup): Comparison[] {
  return THROW.points.map((t) => ({
    label: `${t.cut}°, ${(t.v * 3.6).toFixed(0)} km/h, ${t.english > 0 ? "+" : ""}${Math.round(t.english * 100)}% E`,
    predicted: inPerYd(throwAngle(s, t.v, t.cut, t.english)),
    measured: t.throwInPerYd,
  }))
}

/** Speeds once rolling after a ball–ball hit (m/s). Snooker balls. */
export function ballBallSpeeds(s: Setup): Comparison[] {
  return BALL_BALL_SPEEDS.shots.flatMap((t) => {
    const r = rollingSpeedsAfterHit(s, t.v, t.cut)
    const label = `${t.v} m/s, ${t.cut}°`
    return [
      { label: `${label}, cue`, predicted: r.cue ?? NaN, measured: t.cue },
      { label: `${label}, object`, predicted: r.object ?? NaN, measured: t.object },
    ]
  })
}
