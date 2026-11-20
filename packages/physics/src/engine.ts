/**
 * Event-based simulation loop.
 *
 * Each ball stores the start of its current trajectory segment (state and
 * time). A ball's state at any later time is evaluated in closed form from
 * that start, so no error accumulates between events; a ball gets a new
 * segment only when an event involves it.
 *
 * Event selection, caching, invalidation and tie-breaking follow pooltool
 * 0.6.0 (so the two engines produce comparable event sequences):
 * - next-event times are cached per ball (transitions) and per ball–object
 *   pair (collisions), and only entries involving a resolved event's balls
 *   are recomputed;
 * - events at exactly the same time are ordered by tier (strike, then
 *   transitions and pockets, then collisions) and, within a tier, by
 *   decreasing energy.
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt).
 * Modified: rewritten in TypeScript with per-ball trajectory segments.
 */
import { ballBallTime, ballsOverlap, circularCushionTime, linearCushionTime, pocketTime } from "./detect.ts"
import { squaredNorm, sub } from "./math/vec3.ts"
import {
  applyTransition,
  cloneState,
  evolve,
  isNontranslating,
  isOutOfPlay,
  nextTransition,
  type BallState,
  type TransitionType,
} from "./motion.ts"
import { DEFAULT_CUE_SPECS, DEFAULT_MODEL_CONFIG, type BallParams, type CueSpecs, type ModelConfig } from "./params.ts"
import { resolveBallBall } from "./resolve/ball-ball.ts"
import { resolveCircularCushion, resolveLinearCushion } from "./resolve/cushion.ts"
import { resolvePocket } from "./resolve/pocket.ts"
import { resolveStickBall, type CueStrike } from "./resolve/stick-ball.ts"
import type { Table } from "./table.ts"

export type EventType =
  | "none"
  | "stick_ball"
  | "ball_ball"
  | "ball_linear_cushion"
  | "ball_circular_cushion"
  | "ball_pocket"
  | TransitionType

export interface SimEvent {
  type: EventType
  time: number
  /** Ball ids, then the cushion or pocket id where relevant. */
  ids: string[]
  /** Post-event state of each ball involved. */
  states: Record<string, BallState>
}

export interface BallInput {
  id: string
  params: BallParams
  state: BallState
}

export interface Shot {
  table: Table
  balls: BallInput[]
  cueBall: string
  strike: CueStrike
  cueSpecs?: CueSpecs
  config?: ModelConfig
  /** Stop after this many events (all balls are then stopped). Default 10,000. */
  maxEvents?: number
}

export interface ShotResult {
  events: SimEvent[]
  final: Record<string, BallState>
  /** True if the event cap was hit. */
  truncated: boolean
}

interface Ball {
  id: string
  p: BallParams
  /** State at the start of the current segment. */
  start: BallState
  /** Time the current segment starts. */
  t0: number
}

interface Candidate {
  type: EventType
  time: number
  ids: string[]
}

const stateAt = (b: Ball, t: number): BallState => evolve(b.start, b.p, t - b.t0)

/** Mechanical energy relative to a ball at rest on the table. */
function energy(s: BallState, p: BallParams): number {
  return 0.5 * p.m * squaredNorm(s.v) + 0.5 * (2 / 5) * p.m * p.R * p.R * squaredNorm(s.w) + p.m * p.g * (s.r[2] - p.R)
}

function tier(type: EventType): number {
  switch (type) {
    case "stick_ball":
      return 1
    case "ball_pocket":
    case "sliding_rolling":
    case "rolling_spinning":
    case "rolling_stationary":
    case "spinning_stationary":
      return 2
    case "none":
      return 99
    default:
      return 4
  }
}

export function simulate(shot: Shot): ShotResult {
  const config = shot.config ?? DEFAULT_MODEL_CONFIG
  const cueSpecs = shot.cueSpecs ?? DEFAULT_CUE_SPECS
  const maxEvents = shot.maxEvents ?? 10_000
  const balls: Ball[] = shot.balls.map((b) => ({ id: b.id, p: b.params, start: cloneState(b.state), t0: 0 }))
  const byId = new Map(balls.map((b) => [b.id, b]))
  const { linear, circular, pockets } = shot.table

  let t = 0
  const events: SimEvent[] = [{ type: "none", time: 0, ids: ["dummy"], states: {} }]
  let struck = false

  // Caches: absolute event times. Transition entries hold their type too.
  const transitions = new Map<string, { time: number; type: TransitionType } | null>()
  const pairTimes = new Map<string, number>() // "i|j" by index into balls
  const linearTimes = new Map<string, number>()
  const circularTimes = new Map<string, number>()
  const pocketTimes = new Map<string, number>()

  const refreshTransition = (b: Ball) => {
    const next = nextTransition(b.start, b.p)
    transitions.set(b.id, next ? { time: b.t0 + next.dt, type: next.type } : null)
  }
  for (const b of balls) refreshTransition(b)

  const invalidate = (ids: Set<string>) => {
    for (const map of [pairTimes, linearTimes, circularTimes, pocketTimes]) {
      for (const key of map.keys()) {
        const [a, b] = key.split("|")
        if (map === pairTimes ? ids.has(balls[+a!]!.id) || ids.has(balls[+b!]!.id) : ids.has(a!)) map.delete(key)
      }
    }
  }

  function nextEvent(): Candidate {
    const candidates: Candidate[] = []
    const cue = byId.get(shot.cueBall)!
    if (!struck && t === 0 && !isOutOfPlay(cue.start.s) && shot.strike.V0 > 0) {
      candidates.push({ type: "stick_ball", time: 0, ids: ["cue_stick", shot.cueBall] })
    }

    // Transitions: first in ball order among the earliest.
    let tr: Candidate = { type: "none", time: Infinity, ids: [] }
    for (const b of balls) {
      const e = transitions.get(b.id)
      if (e && e.time < tr.time) tr = { type: e.type, time: e.time, ids: [b.id] }
    }
    candidates.push(tr)

    const now = balls.map((b) => stateAt(b, t))
    const min = (map: Map<string, number>, type: EventType, ids: (k: string) => string[]): Candidate => {
      let best: Candidate = { type, time: Infinity, ids: [] }
      for (const [k, v] of map) if (v < best.time) best = { type, time: v, ids: ids(k) }
      return best
    }

    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!
      const s = now[i]!
      for (const c of linear) {
        const key = `${b.id}|${c.id}`
        if (!linearTimes.has(key)) linearTimes.set(key, t + (isNontranslating(s.s) ? Infinity : linearCushionTime(s, b.p, c)))
      }
    }
    candidates.push(min(linearTimes, "ball_linear_cushion", (k) => k.split("|")))
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!
      const s = now[i]!
      for (const c of circular) {
        const key = `${b.id}|${c.id}`
        if (!circularTimes.has(key)) circularTimes.set(key, t + (isNontranslating(s.s) ? Infinity : circularCushionTime(s, b.p, c)))
      }
    }
    candidates.push(min(circularTimes, "ball_circular_cushion", (k) => k.split("|")))
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!
      const s = now[i]!
      for (const pk of pockets) {
        const key = `${b.id}|${pk.id}`
        if (!pocketTimes.has(key)) pocketTimes.set(key, t + (isNontranslating(s.s) ? Infinity : pocketTime(s, b.p, pk)))
      }
    }
    candidates.push(min(pocketTimes, "ball_pocket", (k) => k.split("|")))
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const key = `${i}|${j}`
        if (pairTimes.has(key)) continue
        const a = now[i]!
        const b = now[j]!
        let time: number
        if (isOutOfPlay(a.s) || isOutOfPlay(b.s) || (isNontranslating(a.s) && isNontranslating(b.s))) time = Infinity
        else if (ballsOverlap(a, b, balls[i]!.p.R, balls[j]!.p.R)) time = t
        else time = t + ballBallTime(a, balls[i]!.p, b, balls[j]!.p)
        pairTimes.set(key, time)
      }
    }
    candidates.push(min(pairTimes, "ball_ball", (k) => k.split("|").map((x) => balls[+x]!.id)))

    const tMin = Math.min(...candidates.map((c) => c.time))
    if (tMin === Infinity) return { type: "none", time: Infinity, ids: [] }
    const simultaneous = candidates.filter((c) => c.time === tMin)
    if (simultaneous.length === 1) return simultaneous[0]!
    const priority = (c: Candidate): [number, number] => {
      if (c.type === "stick_ball") return [1, shot.strike.V0 ** 2]
      if (c.type === "ball_ball") {
        const [a, b] = c.ids.map((id) => byId.get(id)!)
        const sa = stateAt(a!, t)
        const sb = stateAt(b!, t)
        const mu = (a!.p.m * b!.p.m) / (a!.p.m + b!.p.m)
        return [4, 0.5 * mu * squaredNorm(sub(sa.v, sb.v))]
      }
      const b = byId.get(c.ids[0]!)!
      return [tier(c.type), energy(stateAt(b, t), b.p)]
    }
    return simultaneous.reduce((best, c) => {
      const [tb, eb] = priority(best)
      const [tc, ec] = priority(c)
      return tc < tb || (tc === tb && ec > eb) ? c : best
    })
  }

  let truncated = false
  for (let n = 0; ; n++) {
    const ev = nextEvent()
    if (ev.time === Infinity) break
    t = ev.time
    const involved = ev.type === "stick_ball" ? [ev.ids[1]!] : ev.type === "ball_ball" ? ev.ids : [ev.ids[0]!]
    const pre = involved.map((id) => stateAt(byId.get(id)!, t))
    let post: BallState[]
    switch (ev.type) {
      case "stick_ball": {
        const b = byId.get(ev.ids[1]!)!
        post = [resolveStickBall(pre[0]!, b.p, shot.strike, cueSpecs, config.stickBall)]
        struck = true
        break
      }
      case "ball_ball": {
        const [a, b] = ev.ids.map((id) => byId.get(id)!)
        post = resolveBallBall(pre[0]!, pre[1]!, a!.p, b!.p, config.ballBall)
        break
      }
      case "ball_linear_cushion":
        post = [resolveLinearCushion(pre[0]!, linear.find((c) => c.id === ev.ids[1])!, byId.get(ev.ids[0]!)!.p, config.cushion)]
        break
      case "ball_circular_cushion":
        post = [resolveCircularCushion(pre[0]!, circular.find((c) => c.id === ev.ids[1])!, byId.get(ev.ids[0]!)!.p, config.cushion)]
        break
      case "ball_pocket":
        post = [resolvePocket(pockets.find((p) => p.id === ev.ids[1])!)]
        break
      default:
        post = [applyTransition(pre[0]!, ev.type as TransitionType)]
    }
    const states: Record<string, BallState> = {}
    involved.forEach((id, k) => {
      const b = byId.get(id)!
      b.start = post[k]!
      b.t0 = t
      states[id] = cloneState(post[k]!)
      refreshTransition(b)
    })
    invalidate(new Set(involved))
    events.push({ type: ev.type, time: t, ids: ev.ids, states })
    if (n + 1 >= maxEvents) {
      truncated = true
      for (const b of balls) {
        const s = stateAt(b, t)
        b.start = { ...s, v: [0, 0, 0], w: [0, 0, 0], s: isOutOfPlay(s.s) ? s.s : 0 }
        b.t0 = t
      }
      break
    }
  }
  events.push({ type: "none", time: t, ids: ["dummy"], states: {} })
  const final: Record<string, BallState> = {}
  for (const b of balls) final[b.id] = stateAt(b, t)
  return { events, final, truncated }
}
