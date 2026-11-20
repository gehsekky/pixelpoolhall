/**
 * Replays pooltool fixture shots through our engine and compares the results
 * event by event.
 */
import { simulate, type ShotResult } from "../../src/engine.ts"
import { stateError, toCueSpecs, toModelConfig, toParams, toState, toTable } from "./fixture-convert.ts"
import type { FixtureFile, FixtureShot } from "./pooltool-fixtures.ts"

export interface ShotComparison {
  category: string
  name: string
  ours: ShotResult
  /** Events in pooltool's log (including the two "none" markers). */
  theirEvents: number
  /** Index of the first event whose type or ids differ, or -1 if the sequences match. */
  firstStructuralDivergence: number
  /** Index of the first event that differs (type, ids, or time/state beyond tolerance), or -1. */
  firstDivergence: number
  divergence?: string
  /** Largest event-time difference over the matching prefix, seconds. */
  maxTimeError: number
  /** Largest post-event state error over the matching prefix (relative). */
  maxStateError: number
  /** Largest final position difference over all balls, meters. */
  finalPositionError: number
}

export const TIME_TOL = 1e-6
export const STATE_TOL = 1e-5

export function compareShot(file: FixtureFile, shot: FixtureShot): ShotComparison {
  const ours = simulate({
    table: toTable(file),
    balls: shot.balls.map((b) => ({ id: b.id, params: toParams(b.params), state: toState(b) })),
    cueBall: shot.cue.ball,
    strike: shot.cue,
    cueSpecs: toCueSpecs(shot.cue.specs),
    config: toModelConfig(file),
  })
  let firstDivergence = -1
  let firstStructuralDivergence = -1
  let divergence: string | undefined
  let maxTimeError = 0
  let maxStateError = 0
  const n = Math.max(ours.events.length, shot.events.length)
  for (let i = 0; i < n; i++) {
    const a = ours.events[i]
    const b = shot.events[i]
    if (!a || !b || a.type !== b.type || a.ids.join() !== b.ids.join()) {
      firstStructuralDivergence = i
      if (firstDivergence < 0) {
        firstDivergence = i
        divergence = !a
          ? `ours ended early (pooltool next: ${b!.type} ${b!.ids})`
          : !b
            ? `ours continues (${a.type} ${a.ids})`
            : `ours ${a.type} [${a.ids}] @${a.time} vs pooltool ${b.type} [${b.ids}] @${b.time}`
      }
      break
    }
    const dt = Math.abs(a.time - b.time)
    let ds = 0
    for (const [id, s] of Object.entries(b.states)) ds = Math.max(ds, stateError(a.states[id]!, toState(s)))
    if (firstDivergence < 0 && (dt > TIME_TOL || ds > STATE_TOL)) {
      firstDivergence = i
      divergence = `${a.type} [${a.ids}]: time diff ${dt.toExponential(2)}, state err ${ds.toExponential(2)}`
    }
    maxTimeError = Math.max(maxTimeError, dt)
    maxStateError = Math.max(maxStateError, ds)
  }
  let finalPositionError = 0
  for (const [id, s] of Object.entries(shot.final)) {
    const o = ours.final[id]!
    finalPositionError = Math.max(finalPositionError, Math.hypot(o.r[0] - s.rvw[0][0], o.r[1] - s.rvw[0][1], o.r[2] - s.rvw[0][2]))
  }
  return {
    category: file.category,
    name: shot.name,
    ours,
    theirEvents: shot.events.length,
    firstStructuralDivergence,
    firstDivergence,
    ...(divergence === undefined ? {} : { divergence }),
    maxTimeError,
    maxStateError,
    finalPositionError,
  }
}
