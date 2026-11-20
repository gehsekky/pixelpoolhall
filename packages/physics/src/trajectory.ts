/**
 * Exact evaluation of a simulated shot at any time, for rendering and
 * analysis. Each ball's motion is a list of segments (one per event that
 * involved it); within a segment the state is evaluated in closed form.
 */
import type { ShotResult, Shot } from "./engine.ts"
import { evolve, type BallState } from "./motion.ts"
import type { BallParams } from "./params.ts"

export interface Segment {
  /** Segment start time. */
  t0: number
  /** State at t0. */
  state: BallState
}

export interface Trajectories {
  /** Time of the last event. */
  duration: number
  balls: { id: string; params: BallParams; segments: Segment[] }[]
}

export function trajectories(shot: Pick<Shot, "balls">, result: ShotResult): Trajectories {
  const balls = shot.balls.map((b) => ({ id: b.id, params: b.params, segments: [{ t0: 0, state: b.state }] as Segment[] }))
  const byId = new Map(balls.map((b) => [b.id, b]))
  for (const e of result.events) {
    for (const [id, state] of Object.entries(e.states)) byId.get(id)?.segments.push({ t0: e.time, state })
  }
  return { duration: result.events.at(-1)?.time ?? 0, balls }
}

/** A ball's state at time t (clamped to [0, duration]). */
export function stateAtTime(ball: Trajectories["balls"][number], t: number): BallState {
  const segs = ball.segments
  // Last segment starting at or before t (segments are in time order).
  let lo = 0
  let hi = segs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segs[mid]!.t0 <= t) lo = mid
    else hi = mid - 1
  }
  const seg = segs[lo]!
  return evolve(seg.state, ball.params, Math.max(0, t - seg.t0))
}
