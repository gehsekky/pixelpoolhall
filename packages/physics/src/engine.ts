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
import {
  ballBallTime,
  ballBallTime3D,
  ballsOverlap,
  circularCushionTime,
  contactDistance,
  landingTime,
  linearCushionTime,
  linearCushionTime3D,
  offTableTime,
  PocketEvent,
  pocketInteriorTime,
  pocketTime,
} from "./detect.ts"
import { squaredNorm, sub, ZERO } from "./math/vec3.ts"
import {
  applyTransition,
  cloneState,
  evolve,
  halfAcceleration,
  isNontranslating,
  isOutOfPlay,
  MotionState,
  nextTransition,
  type BallState,
  type TransitionType,
} from "./motion.ts"
import { DEFAULT_CUE_SPECS, DEFAULT_MODEL_CONFIG, type BallParams, type CueSpecs, type ModelConfig } from "./params.ts"
import { resolveBallBall } from "./resolve/ball-ball.ts"
import { resolveBallTable, resolveOffTable } from "./resolve/ball-table.ts"
import { resolveCircularCushion, resolveLinearCushion } from "./resolve/cushion.ts"
import { resolveDrop, resolvePocket, resolvePocketEdge } from "./resolve/pocket.ts"
import { resolveStickBall, type CueStrike } from "./resolve/stick-ball.ts"
import { lineCoefficients, type Table } from "./table.ts"

export type EventType =
  | "none"
  | "stick_ball"
  | "ball_ball"
  | "ball_linear_cushion"
  | "ball_circular_cushion"
  | "ball_pocket"
  | "ball_table"
  | "ball_off_table"
  /** Pocket interiors (3D): center over the edge of the slate cut; hitting the edge. */
  | "ball_drop"
  | "ball_pocket_edge"
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
  /**
   * "2d" (default): balls stay on the slate, as pooltool's 2D engine.
   * "3d": balls can leave it: jump shots, hops off rails, flying off the
   * table (pooltool's `is_3d` engine).
   */
  dim?: "2d" | "3d"
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
    case "ball_drop":
    case "pivoting_airborne":
    case "sliding_rolling":
    case "rolling_spinning":
    case "rolling_stationary":
    case "spinning_stationary":
      return 2
    case "ball_off_table":
      // A ball leaving through a pocket at the same instant is pocketed.
      return 3
    case "none":
      return 99
    default:
      return 4
  }
}

/** A pending event, by index: ball i; ball j (ball_ball) or the cushion/pocket index. */
interface Pending {
  type: EventType
  time: number
  i: number
  j: number
}

const NONE: Pending = { type: "none", time: Infinity, i: -1, j: -1 }

const POCKET_EVENT_TYPE: Record<PocketEvent, EventType> = {
  [PocketEvent.none]: "none",
  [PocketEvent.drop]: "ball_drop",
  [PocketEvent.capture]: "ball_pocket",
  // Reaching the wall around the cut is a capture.
  [PocketEvent.wall]: "ball_pocket",
  [PocketEvent.edge]: "ball_pocket_edge",
}

export function simulate(shot: Shot): ShotResult {
  const config = shot.config ?? DEFAULT_MODEL_CONFIG
  const cueSpecs = shot.cueSpecs ?? DEFAULT_CUE_SPECS
  const maxEvents = shot.maxEvents ?? 10_000
  const threeD = shot.dim === "3d"
  const size = shot.table.size
  const balls: Ball[] = shot.balls.map((b) => ({ id: b.id, p: b.params, start: cloneState(b.state), t0: 0 }))
  const n = balls.length
  const cueIndex = balls.findIndex((b) => b.id === shot.cueBall)
  const { linear, circular, pockets } = shot.table
  const nL = linear.length
  const nC = circular.length
  const nP = pockets.length
  const lineGeom = linear.map((c) => {
    const l = lineCoefficients(c)
    return { ...l, ln: Math.hypot(l.lx, l.ly) }
  })

  let t = 0
  const events: SimEvent[] = [{ type: "none", time: 0, ids: ["dummy"], states: {} }]
  let struck = false

  // Caches of absolute event times; NaN marks an entry to recompute. Pair
  // entries use the upper triangle (i < j) of an n×n matrix.
  const pairT = new Float64Array(n * n).fill(NaN)
  const linT = new Float64Array(n * nL).fill(NaN)
  const circT = new Float64Array(n * nC).fill(NaN)
  const pockT = new Float64Array(n * nP).fill(NaN)
  // What each cached pocket time is (a PocketEvent).
  const pockKind = new Uint8Array(n * nP)
  const trT = new Float64Array(n)
  const trType: (TransitionType | null)[] = new Array(n).fill(null)
  // 3D: per-ball landing and leaving-the-table times (NaN = recompute).
  const tableT = new Float64Array(n).fill(NaN)
  const offT = new Float64Array(n).fill(NaN)
  // A ball coming down over a pocket's slate cut doesn't land: it falls in.
  const interiors = pockets.filter((pk) => pk.interior)
  const overCut = (x: number, y: number) => interiors.some((pk) => (x - pk.center[0]) ** 2 + (y - pk.center[1]) ** 2 < pk.radius ** 2)
  const landing = (i: number): number => {
    let v = tableT[i]!
    if (v !== v) {
      v = Infinity
      if (threeD) {
        const s = current(i)
        const dt = landingTime(s, balls[i]!.p)
        // (A ball just off a pocket's edge, at z = R and not yet falling, isn't landing.)
        const leaving = dt <= 0 && !(s.v[2] < 0)
        if (dt !== Infinity && !leaving && !overCut(s.r[0] + s.v[0] * dt, s.r[1] + s.v[1] * dt)) v = t + dt
      }
      tableT[i] = v
    }
    return v
  }
  const leaving = (i: number): number => {
    let v = offT[i]!
    if (v !== v) {
      v = threeD && size ? t + offTableTime(current(i), balls[i]!.p, size, pockets) : Infinity
      offT[i] = v
    }
    return v
  }

  // Each ball's state at the current time t, evaluated on demand.
  const now: (BallState | null)[] = new Array(n).fill(null)
  const nowAt = new Float64Array(n).fill(NaN)
  const current = (i: number): BallState => {
    if (nowAt[i] !== t) {
      now[i] = stateAt(balls[i]!, t)
      nowAt[i] = t
    }
    return now[i]!
  }

  /**
   * Quick rejection. A ball's current trajectory segment lasts until its next
   * transition, which invalidates all of its cached times before any later
   * collision could fire, so only contacts within that horizon matter. Within
   * horizon H the ball moves at most |v|·H + |h|·H² (h = half its
   * acceleration), so objects farther away need no root solve.
   */
  const reachOf = (i: number, horizon: number): number => {
    const s = current(i)
    if (isNontranslating(s.s)) return 0
    const h = halfAcceleration(s, balls[i]!.p)
    const speed = Math.hypot(s.v[0], s.v[1])
    const decel = Math.hypot(h[0], h[1])
    // Rolling: h is exactly opposite v, so the reach is the distance rolled
    // (horizon ≤ the stopping time). Otherwise bound |v τ + h τ²| by the
    // triangle inequality.
    if (s.s === MotionState.rolling) return speed * horizon - decel * horizon * horizon
    return speed * horizon + decel * horizon * horizon
  }
  // An airborne ball's segment ends when it lands.
  const horizon = (i: number) => Math.min(trT[i]!, landing(i)) - t
  // Each ball's reach over its own horizon, cached per time step. Reach grows
  // with the horizon, so this also bounds the reach over any shorter one.
  const reachVal = new Float64Array(n)
  const reachAt = new Float64Array(n).fill(NaN)
  const reach = (i: number): number => {
    if (reachAt[i] !== t) {
      reachVal[i] = reachOf(i, horizon(i))
      reachAt[i] = t
    }
    return reachVal[i]!
  }

  /**
   * How much two balls' separation can shrink before either changes state:
   * relative motion C + B τ + A τ² closes by at most |B| H + |A| H². Tighter
   * than the sum of reaches when the balls move together (e.g. after a break).
   */
  const relativeReach = (i: number, j: number): number => {
    const H = Math.min(horizon(i), horizon(j))
    const a = current(i)
    const b = current(j)
    const ha = isNontranslating(a.s) ? ZERO : halfAcceleration(a, balls[i]!.p)
    const hb = isNontranslating(b.s) ? ZERO : halfAcceleration(b, balls[j]!.p)
    const va = isNontranslating(a.s) ? ZERO : a.v
    const vb = isNontranslating(b.s) ? ZERO : b.v
    return Math.hypot(vb[0] - va[0], vb[1] - va[1]) * H + Math.hypot(hb[0] - ha[0], hb[1] - ha[1]) * H * H
  }

  const refreshTransition = (i: number) => {
    const b = balls[i]!
    const next = nextTransition(b.start, b.p)
    trT[i] = next ? b.t0 + next.dt : Infinity
    trType[i] = next ? next.type : null
  }
  for (let i = 0; i < n; i++) refreshTransition(i)

  const invalidate = (i: number) => {
    for (let k = 0; k < n; k++) {
      pairT[i < k ? i * n + k : k * n + i] = NaN
    }
    linT.fill(NaN, i * nL, (i + 1) * nL)
    circT.fill(NaN, i * nC, (i + 1) * nC)
    pockT.fill(NaN, i * nP, (i + 1) * nP)
    lin.rowT[i] = NaN
    circ.rowT[i] = NaN
    pock.rowT[i] = NaN
    nowAt[i] = NaN
    reachAt[i] = NaN
    tableT[i] = NaN
    offT[i] = NaN
  }

  /** Earliest pending entry of one ball–object cache, computing stale entries. */
  /** A ball–object cache plus each ball's row minimum (NaN = row changed). */
  interface ObjectCache { times: Float64Array; m: number; rowT: Float64Array; rowK: Int32Array }
  const objectCache = (times: Float64Array, m: number): ObjectCache =>
    ({ times, m, rowT: new Float64Array(n).fill(NaN), rowK: new Int32Array(n) })
  const lin = objectCache(linT, nL)
  const circ = objectCache(circT, nC)
  const pock = objectCache(pockT, nP)

  /** Earliest pending entry of a ball–object cache, recomputing only rows that changed. */
  function earliest(
    c: ObjectCache, type: EventType,
    time: (s: BallState, p: BallParams, k: number, i: number) => number,
    gap: (s: BallState, p: BallParams, k: number) => number,
  ): Pending {
    const { times, m, rowT, rowK } = c
    let bestT = Infinity
    let bestI = -1
    for (let i = 0; i < n; i++) {
      if (rowT[i] !== rowT[i]) {
        let rt = Infinity
        let rk = -1
        for (let k = 0; k < m; k++) {
          const idx = i * m + k
          let v = times[idx]!
          if (v !== v) {
            const s = current(i)
            const p = balls[i]!.p
            if (isNontranslating(s.s) || s.s === MotionState.pivoting || gap(s, p, k) > reach(i)) v = Infinity
            else v = t + time(s, p, k, i)
            times[idx] = v
          }
          if (v < rt) {
            rt = v
            rk = k
          }
        }
        rowT[i] = rt
        rowK[i] = rk
      }
      if (rowT[i]! < bestT) {
        bestT = rowT[i]!
        bestI = i
      }
    }
    return bestI < 0 ? NONE : { type, time: bestT, i: bestI, j: rowK[bestI]! }
  }

  function nextEvent(): Pending {
    const candidates: Pending[] = []
    if (!struck && t === 0 && cueIndex >= 0 && !isOutOfPlay(balls[cueIndex]!.start.s) && shot.strike.V0 > 0) {
      candidates.push({ type: "stick_ball", time: 0, i: cueIndex, j: -1 })
    }
    let tr = NONE
    for (let i = 0; i < n; i++) if (trT[i]! < tr.time) tr = { type: trType[i]!, time: trT[i]!, i, j: -1 }
    candidates.push(tr)
    candidates.push(earliest(lin, "ball_linear_cushion",
      threeD ? (s, p, k) => linearCushionTime3D(s, p, linear[k]!) : (s, p, k) => linearCushionTime(s, p, linear[k]!),
      (s, p, k) => {
        const g = lineGeom[k]!
        const dist = Math.abs(g.l0 + g.lx * s.r[0] + g.ly * s.r[1]) / g.ln
        // In 3D a ball in the air can touch the nose from above, at any horizontal distance up to R + nose.
        return dist - (threeD ? p.R + linear[k]!.noseRadius : contactDistance(p.R, linear[k]!))
      }))
    candidates.push(earliest(circ, "ball_circular_cushion", (s, p, k) => circularCushionTime(s, p, circular[k]!),
      (s, p, k) => Math.hypot(s.r[0] - circular[k]!.center[0], s.r[1] - circular[k]!.center[1]) - circular[k]!.radius - p.R))
    const pk = earliest(pock, "ball_pocket",
      (s, p, k, i) => {
        const pocket = pockets[k]!
        if (!(threeD && pocket.interior)) {
          pockKind[i * nP + k] = PocketEvent.capture
          return pocketTime(s, p, pocket)
        }
        const e = pocketInteriorTime(s, p, pocket)
        pockKind[i * nP + k] = e.kind
        return e.time
      },
      (s, _p, k) => Math.hypot(s.r[0] - pockets[k]!.center[0], s.r[1] - pockets[k]!.center[1]) - pockets[k]!.radius)
    if (pk.i >= 0) pk.type = POCKET_EVENT_TYPE[pockKind[pk.i * nP + pk.j] as PocketEvent]
    candidates.push(pk)
    let bb = NONE
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const idx = i * n + j
        let v = pairT[idx]!
        if (v !== v) {
          const a = current(i)
          const b = current(j)
          // A ball tipping into a pocket is left alone until it lets go of the edge.
          if (isOutOfPlay(a.s) || isOutOfPlay(b.s) || a.s === MotionState.pivoting || b.s === MotionState.pivoting) v = Infinity
          else if (isNontranslating(a.s) && isNontranslating(b.s)) v = Infinity
          else if (ballsOverlap(a, b, balls[i]!.p.R, balls[j]!.p.R)) v = t
          else {
            const gap = Math.hypot(a.r[0] - b.r[0], a.r[1] - b.r[1]) - balls[i]!.p.R - balls[j]!.p.R
            v =
              gap > reach(i) + reach(j) || gap > relativeReach(i, j)
                ? Infinity
                : t + (threeD ? ballBallTime3D : ballBallTime)(a, balls[i]!.p, b, balls[j]!.p)
          }
          pairT[idx] = v
        }
        if (v < bb.time) bb = { type: "ball_ball", time: v, i, j }
      }
    }
    candidates.push(bb)
    if (threeD) {
      let land = NONE
      let off = NONE
      for (let i = 0; i < n; i++) {
        if (landing(i) < land.time) land = { type: "ball_table", time: landing(i), i, j: -1 }
        if (leaving(i) < off.time) off = { type: "ball_off_table", time: leaving(i), i, j: -1 }
      }
      candidates.push(land, off)
    }

    let tMin = Infinity
    for (const c of candidates) if (c.time < tMin) tMin = c.time
    if (tMin === Infinity) return NONE
    const simultaneous = candidates.filter((c) => c.time === tMin)
    if (simultaneous.length === 1) return simultaneous[0]!
    const priority = (c: Pending): [number, number] => {
      if (c.type === "stick_ball") return [1, shot.strike.V0 ** 2]
      if (c.type === "ball_ball") {
        const [a, b] = [balls[c.i]!, balls[c.j]!]
        const mu = (a.p.m * b.p.m) / (a.p.m + b.p.m)
        return [4, 0.5 * mu * squaredNorm(sub(current(c.i).v, current(c.j).v))]
      }
      return [tier(c.type), energy(current(c.i), balls[c.i]!.p)]
    }
    return simultaneous.reduce((best, c) => {
      const [tb, eb] = priority(best)
      const [tc, ec] = priority(c)
      return tc < tb || (tc === tb && ec > eb) ? c : best
    })
  }

  let truncated = false
  for (let count = 0; ; count++) {
    const ev = nextEvent()
    if (ev.time === Infinity) break
    t = ev.time
    const involved = ev.type === "ball_ball" ? [ev.i, ev.j] : [ev.i]
    let post: BallState[]
    let ids: string[]
    const bi = balls[ev.i]!
    switch (ev.type) {
      case "stick_ball":
        post = [resolveStickBall(current(ev.i), bi.p, shot.strike, cueSpecs, config.stickBall, threeD)]
        ids = ["cue_stick", bi.id]
        struck = true
        break
      case "ball_ball": {
        const bj = balls[ev.j]!
        post = resolveBallBall(current(ev.i), current(ev.j), bi.p, bj.p, config.ballBall, threeD)
        ids = [bi.id, bj.id]
        break
      }
      case "ball_linear_cushion":
        post = [resolveLinearCushion(current(ev.i), linear[ev.j]!, bi.p, config.cushion, threeD)]
        ids = [bi.id, linear[ev.j]!.id]
        break
      case "ball_circular_cushion":
        post = [resolveCircularCushion(current(ev.i), circular[ev.j]!, bi.p, config.cushion, threeD)]
        ids = [bi.id, circular[ev.j]!.id]
        break
      case "ball_pocket":
        post = [resolvePocket(pockets[ev.j]!)]
        ids = [bi.id, pockets[ev.j]!.id]
        break
      case "ball_drop":
        post = [resolveDrop(current(ev.i), pockets[ev.j]!, bi.p)]
        ids = [bi.id, pockets[ev.j]!.id]
        break
      case "ball_pocket_edge":
        post = [resolvePocketEdge(current(ev.i), pockets[ev.j]!, bi.p, config.ballTable)]
        ids = [bi.id, pockets[ev.j]!.id]
        break
      case "ball_table":
        post = [resolveBallTable(current(ev.i), bi.p, config.ballTable)]
        ids = [bi.id]
        break
      case "ball_off_table":
        post = [resolveOffTable(current(ev.i))]
        ids = [bi.id]
        break
      default:
        post = [applyTransition(current(ev.i), ev.type as TransitionType, bi.p)]
        ids = [bi.id]
    }
    const states: Record<string, BallState> = {}
    involved.forEach((i, k) => {
      const b = balls[i]!
      b.start = post[k]!
      b.t0 = t
      states[b.id] = cloneState(post[k]!)
      refreshTransition(i)
      invalidate(i)
    })
    // A ball caught at the pocket's edge is pocketed there.
    const type = ev.type === "ball_pocket_edge" && post[0]!.s === MotionState.pocketed ? "ball_pocket" : ev.type
    events.push({ type, time: t, ids, states })
    if (count + 1 >= maxEvents) {
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
