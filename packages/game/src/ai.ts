/**
 * Computer opponent: shot search over the real physics and rules.
 *
 * 1. Candidates. Pot shots use ghost-ball aims for every legal ball and
 *    pocket, at several speeds and amounts of follow and draw. Each aim is
 *    corrected for throw and squirt by measuring the object ball's actual
 *    departure in the simulation (a secant step), as a good player
 *    compensates. Safeties are a sweep of soft shots in every direction.
 *    With ball in hand, placements are tried behind the most makeable shots.
 * 2. Evaluation. Every candidate runs through `Game.preview` (physics plus
 *    the WPA referee) and is scored. A win is worth the most; then keeping
 *    the turn, plus position for the next shot; a foul costs. When the turn
 *    passes, the score is minus the opponent's best shot.
 * 3. Robustness. Stronger levels re-run their finalists under their own
 *    execution noise and keep the best expected score, so they don't choose
 *    shots they can't make.
 * 4. Execution. The chosen strike is perturbed by the level's aim, speed
 *    and tip noise. That's how the computer misses.
 *
 * Not yet: kick and bank shots, combinations, intentional push outs.
 */
import { MotionState, type BallState, type CueStrike } from "@pixelpoolhall/physics"
import { legalTargets } from "./rules/eight-ball.ts"
import { lowestBall } from "./rules/nine-ball.ts"
import type { Point } from "./layout.ts"
import type { Rng } from "./rng.ts"
import type { Game, Preview } from "./session.ts"
import { CUE, other, type Call, type GameState, type Option, type Player } from "./types.ts"

export interface AiLevel {
  name: string
  /** Execution noise (1σ): aim in degrees, speed as a fraction, tip offset in ball radii. */
  aimSigma: number
  speedSigma: number
  tipSigma: number
  /** Weight on the ease of the next shot (position play), 0–1. */
  positionWeight: number
  /** Finalists re-checked under execution noise, and noisy samples each (0 = no check). */
  finalists: number
  robustSamples: number
  /** Break cue speed, m/s. */
  breakSpeed: number
}

export const AI_LEVELS = {
  easy: { name: "Easy", aimSigma: 0.5, speedSigma: 0.12, tipSigma: 0.06, positionWeight: 0, finalists: 0, robustSamples: 0, breakSpeed: 7 },
  medium: { name: "Medium", aimSigma: 0.2, speedSigma: 0.07, tipSigma: 0.03, positionWeight: 0.6, finalists: 6, robustSamples: 6, breakSpeed: 8 },
  hard: { name: "Hard", aimSigma: 0.07, speedSigma: 0.04, tipSigma: 0.015, positionWeight: 1, finalists: 10, robustSamples: 10, breakSpeed: 8.5 },
} as const satisfies Record<string, AiLevel>

export interface AiPlan {
  /** Intended strike (before execution noise). */
  strike: CueStrike
  call: Call | null
  /** Where to put the cue ball first, when it's in hand. */
  placement: Point | null
  kind: "break" | "pot" | "safety"
  /** Expected score (see the module comment). */
  value: number
  target?: { ball: string; pocket: string }
}

// ---------- Scoring ----------

const WIN = 1000
const CONTINUE = 300
const POSITION = 200
const FOUL = -300
const PASS = -200
/** Reference aim error (degrees) for shot ease; a strong player's. */
const EASE_SIGMA = 0.15

const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180

/** erf, Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const s = Math.sign(x)
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return s * y
}

function gaussian(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next())
}

const xy = (b: BallState): Point => [b.r[0], b.r[1]]

/** Distance from p to the segment a–b. */
function segDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

interface ShotGeometry {
  ghost: Point
  /** Unit direction from the object ball to the pocket. */
  u: Point
  /** Aim angle from the cue ball to the ghost ball, degrees. */
  phi: number
  ease: number
}

/**
 * Geometry and ease of potting `ball` in `pocket` from cue position `c`.
 * Ease is the probability that a shot with EASE_SIGMA aim error goes in:
 * the pocket's angular tolerance seen from the object ball, carried back to
 * the cue ball (an aim error δφ shifts the contact point by d₁δφ, which turns
 * the object ball by d₁δφ / (2R cos θ)). Zero if blocked or too thin.
 */
export function shotGeometry(game: Game, c: Point, ball: string, pocket: string, balls: ReadonlyMap<string, BallState>): ShotGeometry | null {
  const R = game.params.R
  const o = balls.get(ball)
  const pk = game.table.pockets.find((p) => p.id === pocket)
  if (!o || !pk) return null
  const O = xy(o)
  const P: Point = [pk.center[0], pk.center[1]]
  const d2 = Math.hypot(P[0] - O[0], P[1] - O[1])
  const u: Point = [(P[0] - O[0]) / d2, (P[1] - O[1]) / d2]
  const ghost: Point = [O[0] - 2 * R * u[0], O[1] - 2 * R * u[1]]
  const vx = ghost[0] - c[0]
  const vy = ghost[1] - c[1]
  const d1 = Math.hypot(vx, vy)
  const phi = deg(Math.atan2(vy, vx))
  if (d1 < 1e-6) return null
  const cosCut = (vx * u[0] + vy * u[1]) / d1
  if (cosCut < Math.cos(rad(78))) return { ghost, u, phi, ease: 0 }
  // Pocket acceptance: the opening narrows as the approach leaves the pocket's axis.
  const side = pocket.endsWith("c")
  const { w, l } = game.spec
  let nx = side ? (P[0] < w / 2 ? 1 : -1) : w / 2 - P[0]
  let ny = side ? 0 : l / 2 - P[1]
  if (!side) {
    // Corner axis: the 45° diagonal into the table.
    nx = Math.sign(nx)
    ny = Math.sign(ny)
  }
  const nn = Math.hypot(nx, ny)
  const accept = (-u[0] * nx - u[1] * ny) / nn
  if (accept < (side ? Math.cos(rad(60)) : Math.cos(rad(75)))) return { ghost, u, phi, ease: 0 }
  for (const [id, b] of balls) {
    if (id === CUE || id === ball) continue
    const B = xy(b)
    if (segDist(B, c, ghost) < 2 * R || segDist(B, O, P) < 2 * R) return { ghost, u, phi, ease: 0 }
  }
  const mouth = side ? game.spec.sidePocketWidth : game.spec.cornerPocketWidth
  const halfWidth = ((mouth - 2 * R) / 2) * accept
  const alphaObj = halfWidth / d2
  const alphaCue = (alphaObj * 2 * R * cosCut) / Math.max(d1, 2 * R)
  return { ghost, u, phi, ease: erf(alphaCue / (rad(EASE_SIGMA) * Math.SQRT2)) }
}

/** Balls `player` may pot next, given a rules state and the balls on the table. */
function targetsFor(game: Game, state: GameState, player: Player, balls: ReadonlyMap<string, BallState>): string[] {
  const onTable = new Set([...balls.keys()].filter((id) => id !== CUE))
  if (game.discipline === "9-ball") {
    const lo = lowestBall(onTable)
    return lo ? [lo] : []
  }
  return [...legalTargets(state, player, onTable)]
}

/** Best shot ease for `player` with the cue ball where it lies (1 if they'll have ball in hand). */
export function bestEase(game: Game, state: GameState, player: Player, balls: ReadonlyMap<string, BallState>): number {
  if (state.cueBallInHand !== "none") return 1
  const cue = balls.get(CUE)
  if (!cue) return 1
  let best = 0
  for (const t of targetsFor(game, state, player, balls))
    for (const p of game.table.pockets) best = Math.max(best, shotGeometry(game, xy(cue), t, p.id, balls)?.ease ?? 0)
  return best
}

/** Score of a previewed shot for the shooter `me`. */
function score(game: Game, me: Player, p: Preview, level: AiLevel): number {
  const st = p.ruling.state
  if (st.winner === me) return WIN
  if (st.winner === other(me)) return -WIN
  if (p.ruling.fouls.length > 0) return FOUL
  if (st.pending) return st.pending.player === me ? 0 : PASS / 4
  if (st.shooter === me) return CONTINUE + POSITION * level.positionWeight * bestEase(game, st, me, p.after)
  return PASS * bestEase(game, st, other(me), p.after)
}

// ---------- Candidates ----------

interface Candidate {
  strike: CueStrike
  call: Call | null
  placement: Point | null
  kind: AiPlan["kind"]
  target?: { ball: string; pocket: string }
  balls: ReadonlyMap<string, BallState>
  value: number
}

const SPEEDS = [1.3, 2.2, 3.4, 5]
const TIP_HEIGHTS = [-0.35, 0, 0.35]

/** Object ball's departure angle (degrees) after the first contact, if the cue ball hit `ball` first. */
function departure(p: Preview, ball: string): number | null {
  if (p.facts.firstContacts[0] !== ball) return null
  for (const e of p.result.events) {
    if (e.type === "ball_ball" && e.ids.includes(CUE) && e.ids.includes(ball)) {
      const v = e.states[ball]!.v
      return deg(Math.atan2(v[1], v[0]))
    }
  }
  return null
}

const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180

function potCandidates(game: Game, me: Player, level: AiLevel, balls: ReadonlyMap<string, BallState>, placement: Point | null, only?: { ball: string; pocket: string }): Candidate[] {
  const cue = balls.get(CUE)
  if (!cue) return []
  const out: Candidate[] = []
  const pairs = only ? [only] : targetsFor(game, game.state, me, balls).flatMap((ball) => game.table.pockets.map((p) => ({ ball, pocket: p.id })))
  for (const { ball, pocket } of pairs) {
    const g = shotGeometry(game, xy(cue), ball, pocket, balls)
    if (!g || g.ease <= 0.02) continue
    const want = deg(Math.atan2(g.u[1], g.u[0]))
    const call: Call | null = game.discipline === "8-ball" ? { ball, pocket } : null
    for (const V0 of SPEEDS) {
      for (const b of TIP_HEIGHTS) {
        // Secant correction of the aim for throw and squirt.
        let phi = g.phi
        const strike = (ph: number): CueStrike => ({ V0, phi: ph, theta: 0, a: 0, b })
        let p = game.preview(strike(phi), { call }, balls)
        const d0 = departure(p, ball)
        if (d0 !== null) {
          const h = 0.05
          const p1 = game.preview(strike(phi + h), { call }, balls)
          const d1 = departure(p1, ball)
          if (d1 !== null && Math.abs(wrap(d1 - d0)) > 1e-9) {
            const step = (-wrap(d0 - want) * h) / wrap(d1 - d0)
            if (Math.abs(step) < 5) {
              phi += step
              p = game.preview(strike(phi), { call }, balls)
            }
          }
        }
        out.push({ strike: strike(phi), call, placement, kind: "pot", target: { ball, pocket }, balls, value: score(game, me, p, level) })
      }
    }
  }
  return out
}

function safetyCandidates(game: Game, me: Player, level: AiLevel, balls: ReadonlyMap<string, BallState>, placement: Point | null): Candidate[] {
  const out: Candidate[] = []
  const call: Call | null = game.discipline === "8-ball" ? "safety" : null
  for (let deg6 = 0; deg6 < 360; deg6 += 6) {
    for (const V0 of [0.9, 1.8]) {
      const strike: CueStrike = { V0, phi: deg6, theta: 0, a: 0, b: 0 }
      out.push({ strike, call, placement, kind: "safety", balls, value: score(game, me, game.preview(strike, { call }, balls), level) })
    }
  }
  return out
}

/** Cue-ball placements for ball in hand: behind the most makeable shots. */
function placements(game: Game, me: Player): { at: Point; target: { ball: string; pocket: string }; ease: number }[] {
  const R = game.params.R
  const out: { at: Point; target: { ball: string; pocket: string }; ease: number }[] = []
  const without = new Map([...game.balls].filter(([id]) => id !== CUE))
  for (const ball of targetsFor(game, game.state, me, without)) {
    const o = without.get(ball)!
    for (const pk of game.table.pockets) {
      const dx = pk.center[0] - o.r[0]
      const dy = pk.center[1] - o.r[1]
      const n = Math.hypot(dx, dy)
      for (const back of [0.15, 0.3]) {
        for (const off of [-25, -12, 0, 12, 25]) {
          // Behind the ghost ball, rotated by `off` for a slight cut (room for position).
          const a = Math.atan2(dy, dx) + Math.PI + rad(off)
          const gx = o.r[0] - (2 * R * dx) / n
          const gy = o.r[1] - (2 * R * dy) / n
          const at: Point = [gx + back * Math.cos(a), gy + back * Math.sin(a)]
          if (game.placementProblem(at, without)) continue
          const balls = new Map(without).set(CUE, { r: [at[0], at[1], R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary })
          const ease = shotGeometry(game, at, ball, pk.id, balls)?.ease ?? 0
          if (ease > 0.05) out.push({ at, target: { ball, pocket: pk.id }, ease })
        }
      }
    }
  }
  return out.sort((p, q) => q.ease - p.ease)
}

// ---------- Planning ----------

/** Execution noise for `level`, applied to an intended strike. */
export function executionNoise(strike: CueStrike, level: AiLevel, rng: Rng): CueStrike {
  const a = strike.a + level.tipSigma * gaussian(rng)
  const b = strike.b + level.tipSigma * gaussian(rng)
  const r = Math.hypot(a, b)
  const k = r > 0.6 ? 0.6 / r : 1
  return {
    ...strike,
    phi: strike.phi + level.aimSigma * gaussian(rng),
    V0: Math.max(0.1, strike.V0 * (1 + level.speedSigma * gaussian(rng))),
    a: a * k,
    b: b * k,
  }
}

function breakPlan(game: Game, level: AiLevel): AiPlan {
  const { w } = game.spec
  const R = game.params.R
  const head = game.layout.headStringY
  const placement: Point = [w / 2 + 0.12, head - 3 * R]
  // Aim at the head ball of the rack (the 1 at 9-ball, the apex at 8-ball).
  const objs = [...game.balls].filter(([id]) => id !== CUE)
  const apex = objs.reduce((m, b) => (b[1].r[1] < m[1].r[1] ? b : m))[1]
  const phi = deg(Math.atan2(apex.r[1] - placement[1], apex.r[0] - placement[0]))
  return { strike: { V0: level.breakSpeed, phi, theta: 0, a: 0, b: -0.15 }, call: null, placement, kind: "break", value: 0 }
}

/** Plan the next shot for the current shooter. Deterministic given the rng state. */
export function planShot(game: Game, level: AiLevel, rng: Rng): AiPlan {
  const s = game.state
  if (s.winner !== null || s.pending) throw new Error("no shot to plan")
  if (s.isBreak) return breakPlan(game, level)
  const me = s.shooter

  let cands: Candidate[] = []
  if (s.cueBallInHand !== "none") {
    for (const pl of placements(game, me).slice(0, 10)) {
      const balls = new Map(game.balls).set(CUE, { r: [pl.at[0], pl.at[1], game.params.R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary })
      cands.push(...potCandidates(game, me, level, balls, pl.at, pl.target))
    }
    // The current spot (it may be legal and good) for safeties.
    const cue = game.balls.get(CUE)
    if (cue && !game.placementProblem(xy(cue))) cands.push(...safetyCandidates(game, me, level, game.balls, xy(cue)))
  } else {
    cands = [...potCandidates(game, me, level, game.balls, null), ...safetyCandidates(game, me, level, game.balls, null)]
  }
  if (cands.length === 0) {
    // Nothing found (e.g. nowhere legal to place): hit the first legal ball softly.
    const t = targetsFor(game, s, me, game.balls)[0]
    const c = game.balls.get(CUE)!
    const o = t ? game.balls.get(t)! : c
    const phi = deg(Math.atan2(o.r[1] - c.r[1], o.r[0] - c.r[0]))
    return { strike: { V0: 2, phi, theta: 0, a: 0, b: 0 }, call: game.discipline === "8-ball" ? "safety" : null, placement: null, kind: "safety", value: 0 }
  }

  cands.sort((p, q) => q.value - p.value)
  let best = cands[0]!
  if (level.finalists > 0 && level.robustSamples > 0) {
    // Finalists: the best pots and the best safeties, re-run under our own noise.
    const pots = cands.filter((c) => c.kind === "pot").slice(0, level.finalists)
    const safeties = cands.filter((c) => c.kind === "safety").slice(0, Math.ceil(level.finalists / 2))
    let bestMean = -Infinity
    for (const c of [...pots, ...safeties]) {
      let sum = 0
      for (let i = 0; i < level.robustSamples; i++) {
        sum += score(game, me, game.preview(executionNoise(c.strike, level, rng), { call: c.call }, c.balls), level)
      }
      const mean = sum / level.robustSamples
      if (mean > bestMean) {
        bestMean = mean
        best = { ...c, value: mean }
      }
    }
  }
  return { strike: best.strike, call: best.call, placement: best.placement, kind: best.kind, value: best.value, ...(best.target ? { target: best.target } : {}) }
}

/** Resolve a pending decision for the AI. */
export function chooseOption(game: Game, level: AiLevel, rng: Rng): Option {
  const p = game.state.pending
  if (!p) throw new Error("no decision is pending")
  const has = (o: Option) => p.options.includes(o)
  if (has("spot_eight")) return "spot_eight"
  // Would we like to shoot from here? Plan as if the table were accepted.
  const saved = game.state
  let value: number
  try {
    game.state = { ...saved, pending: null, shooter: p.player, cueBallInHand: "none" }
    value = game.balls.has(CUE) ? planShot(game, level, rng).value : -Infinity
  } finally {
    game.state = saved
  }
  const good = value > CONTINUE / 2
  switch (p.kind) {
    case "after_push_out":
      return good ? "shoot" : "pass"
    case "three_ball_rule":
      return good ? "accept_table" : "pass"
    case "illegal_break":
      return good ? "accept_table" : "rerack_and_break"
    case "break_foul":
      return good && has("accept_table") ? "accept_table" : "cue_ball_in_kitchen"
    default:
      return p.options[0]!
  }
}
