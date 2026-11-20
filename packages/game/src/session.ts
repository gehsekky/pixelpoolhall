/**
 * A game at the table: ball positions, the rules state, and the flow between
 * shots (simulate → extract facts → judge → spot balls / place cue ball /
 * re-rack). Deterministic from its seed.
 */
import {
  buildPocketTable,
  DEFAULT_BALL_PARAMS,
  MotionState,
  simulate,
  trajectories,
  WPA_9FT,
  type BallParams,
  type BallState,
  type CueStrike,
  type ShotResult,
  type Table,
  type TableSpec,
  type Trajectories,
} from "@pixelpoolhall/physics"
import { shotFacts } from "./facts.ts"
import { layoutFor, placementProblem, rackPositions, spotPosition, type Layout, type Point } from "./layout.ts"
import { createRng, type Rng } from "./rng.ts"
import { decide, judge, newRack } from "./rules/index.ts"
import { CUE, other, type Call, type Discipline, type GameState, type Option, type Player, type Ruling, type RuleOptions, type ShotFacts } from "./types.ts"

export interface GameOptions {
  discipline: Discipline
  table?: TableSpec
  ballParams?: BallParams
  seed?: number
  rules?: Partial<RuleOptions>
  /** Breaker of the first rack (the lag isn't simulated). Default player 0. */
  firstBreaker?: Player
}

export interface ShotOptions {
  call?: Call | null
  pushOut?: boolean
}

export interface Preview {
  result: ShotResult
  trajectories: Trajectories
  facts: ShotFacts
  ruling: Ruling
  /** Balls left on the table, at rest, before any spotting or cue-ball placement. */
  after: Map<string, BallState>
}

export interface ShotRecord {
  shooter: Player
  strike: CueStrike
  options: ShotOptions
  /** Ball states when the shot began. */
  start: Map<string, BallState>
  result: ShotResult
  trajectories: Trajectories
  facts: ShotFacts
  ruling: Ruling
}

const rest = ([x, y]: Point, R: number): BallState => ({ r: [x, y, R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary })

export class Game {
  readonly spec: TableSpec
  readonly table: Table
  readonly layout: Layout
  readonly params: BallParams
  readonly discipline: Discipline
  state: GameState
  /** Balls on the table (the cue ball is absent only between a scratch and its placement). */
  balls = new Map<string, BallState>()
  /** Racks won by each player. */
  score: [number, number] = [0, 0]
  readonly history: ShotRecord[] = []
  private readonly rng: Rng

  constructor(opts: GameOptions) {
    this.discipline = opts.discipline
    this.spec = opts.table ?? WPA_9FT
    this.params = opts.ballParams ?? DEFAULT_BALL_PARAMS
    this.table = buildPocketTable(this.spec)
    this.layout = layoutFor(
      this.spec,
      this.params.R,
      this.table.pockets.map((p) => ({ center: [p.center[0], p.center[1]], radius: p.radius })),
    )
    this.rng = createRng(opts.seed ?? 1)
    this.state = newRack(this.discipline, opts.firstBreaker ?? 0, opts.rules)
    this.rack()
  }

  /** Object balls on the table. */
  objectBalls(): Set<string> {
    return new Set([...this.balls.keys()].filter((id) => id !== CUE))
  }

  /** Why the cue ball can't go at `p` now, or null if it can. */
  placementProblem(p: Point, balls: ReadonlyMap<string, BallState> = this.balls): string | null {
    if (this.state.cueBallInHand === "none") return "the cue ball isn't in hand"
    const others = [...balls].filter(([id]) => id !== CUE).map(([, s]) => [s.r[0], s.r[1]] as Point)
    return placementProblem(this.layout, p, others, this.state.cueBallInHand)
  }

  placeCueBall(p: Point): void {
    const problem = this.placementProblem(p)
    if (problem) throw new Error(`can't place the cue ball there: ${problem}`)
    this.balls.set(CUE, rest(p, this.params.R))
  }

  /**
   * Simulate and judge a shot without changing the game. `balls` overrides
   * the current positions (e.g. to try a ball-in-hand placement).
   */
  preview(strike: CueStrike, options: ShotOptions = {}, balls: ReadonlyMap<string, BallState> = this.balls): Preview {
    const s = this.state
    const shot = {
      table: this.table,
      balls: [...balls].map(([id, state]) => ({ id, params: this.params, state })),
      cueBall: CUE,
      strike,
    }
    const result = simulate(shot)
    const traj = trajectories(shot, result)
    const facts = shotFacts(result, traj, this.layout.headStringY)
    const onTable = new Set([...balls.keys()].filter((id) => id !== CUE))
    const ruling = judge(s, { facts, onTable, call: options.call ?? null, pushOut: options.pushOut ?? false })
    // Positions after the shot: pocketed and off-table balls leave the table.
    const after = new Map(
      Object.entries(result.final)
        .filter(([, st]) => st.s !== MotionState.pocketed && st.s !== MotionState.offTable)
        .map(([id, st]) => [id, { ...st, v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary }] as [string, BallState]),
    )
    return { result, trajectories: traj, facts, ruling, after }
  }

  shoot(strike: CueStrike, options: ShotOptions = {}): ShotRecord {
    const s = this.state
    if (s.winner !== null) throw new Error("the rack is over")
    if (s.pending) throw new Error(`waiting for player ${s.pending.player + 1} to choose`)
    const cue = this.balls.get(CUE)
    if (!cue) throw new Error("the cue ball must be placed first")
    if (s.cueBallInHand !== "none") {
      const problem = this.placementProblem([cue.r[0], cue.r[1]])
      if (problem) throw new Error(`illegal cue ball placement: ${problem}`)
    }
    const start = new Map(this.balls)
    const p = this.preview(strike, options)
    const record: ShotRecord = {
      shooter: s.shooter,
      strike,
      options,
      start,
      result: p.result,
      trajectories: p.trajectories,
      facts: p.facts,
      ruling: p.ruling,
    }
    this.history.push(record)
    this.balls = p.after
    this.apply(p.ruling)
    return record
  }

  decide(option: Option): Ruling {
    const ruling = decide(this.state, option)
    this.apply(ruling)
    return ruling
  }

  /** Start the next rack after a win; the break alternates (WPA 1.3). */
  nextRack(): void {
    const w = this.state.winner
    if (w === null) throw new Error("the rack isn't over")
    this.score[w] += 1
    this.state = newRack(this.discipline, other(this.state.breaker), this.state.rules)
    this.rack()
  }

  private apply(ruling: Ruling): void {
    this.state = ruling.state
    if (ruling.rerack) {
      this.rack()
      return
    }
    for (const id of ruling.spot) {
      const occupied = new Map([...this.balls].map(([k, st]) => [k, [st.r[0], st.r[1]] as Point]))
      this.balls.set(id, rest(spotPosition(this.layout, occupied, CUE), this.params.R))
    }
    if (this.state.cueBallInHand !== "none") this.ensureCueBallPlaced()
  }

  /** Put the cue ball somewhere legal for the current ball in hand, keeping its position if it already is. */
  private ensureCueBallPlaced(): void {
    const cue = this.balls.get(CUE)
    if (cue && !this.placementProblem([cue.r[0], cue.r[1]])) return
    const { w, headStringY, R } = this.layout
    const start: Point = [w / 2, this.state.cueBallInHand === "kitchen" ? headStringY - 4 * R : headStringY]
    // Search outward from the start point on a small grid.
    for (let ring = 0; ring < 200; ring++) {
      for (let k = 0; k < Math.max(1, 8 * ring); k++) {
        const a = (2 * Math.PI * k) / Math.max(1, 8 * ring)
        const p: Point = [start[0] + ring * R * Math.cos(a), start[1] + ring * R * Math.sin(a)]
        if (!this.placementProblem(p)) {
          this.balls.set(CUE, rest(p, R))
          return
        }
      }
    }
    throw new Error("no legal place for the cue ball")
  }

  private rack(): void {
    const R = this.params.R
    this.balls = new Map()
    for (const [id, p] of rackPositions(this.discipline, this.layout, this.rng)) this.balls.set(id, rest(p, R))
    this.ensureCueBallPlaced()
  }
}
