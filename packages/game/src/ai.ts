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
 * Harder shots (banks, kicks, combinations) are searched only when the
 * direct options are weak. Their aim comes from mirror geometry and is then
 * solved in the simulation: sweep the aim, measure the signed miss, and
 * root-find where it crosses zero. At 9-ball the computer also pushes out
 * when it has no good shot.
 */
import { MotionState, stateAtTime, type BallState, type CueStrike } from "@pixelpoolhall/physics"
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
  kind: "break" | "pot" | "bank" | "combo" | "kick" | "safety" | "push"
  /** 9-ball: declare this shot a push out. */
  pushOut: boolean
  /** Expected score (see the module comment). */
  value: number
  target?: { ball: string; pocket: string }
  /** Plain-language description, e.g. "bank the 3 off the left rail into the foot-right corner". */
  description: string
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
  pushOut?: boolean
  target?: { ball: string; pocket: string }
  description: string
  balls: ReadonlyMap<string, BallState>
  value: number
}

const POCKET_TEXT: Record<string, string> = {
  lb: "head-left corner",
  lc: "left side",
  lt: "foot-left corner",
  rb: "head-right corner",
  rc: "right side",
  rt: "foot-right corner",
}
const pocketText = (id: string) => POCKET_TEXT[id] ?? id

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
        out.push({
          strike: strike(phi),
          call,
          placement,
          kind: "pot",
          target: { ball, pocket },
          description: `the ${ball} in the ${pocketText(pocket)}`,
          balls,
          value: score(game, me, p, level),
        })
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
      out.push({ strike, call, placement, kind: "safety", description: "a safety", balls, value: score(game, me, game.preview(strike, { call }, balls), level) })
    }
  }
  return out
}

// ---------- Harder shots: aim solved in the simulation ----------

/**
 * Signed closest approach (m) of `ball`'s path to point P: positive if P
 * passes on the ball's left. The path is sampled per trajectory segment
 * (each a parabola) and measured against the polyline. Zero if the ball was
 * pocketed in `pocket`. Null if the ball never moved.
 */
function pathMiss(p: Preview, ball: string, P: Point, pocket?: string): number | null {
  if (pocket && p.facts.pocketed.some((x) => x.ball === ball && x.pocket === pocket)) return 0
  const tb = p.trajectories.balls.find((b) => b.id === ball)
  if (!tb) return null
  const until = p.facts.pocketed.find((x) => x.ball === ball)?.time ?? p.trajectories.duration
  const pts: Point[] = []
  tb.segments.forEach((seg, i) => {
    const t0 = seg.t0
    if (t0 >= until && i > 0) return
    const t1 = Math.min(until, i + 1 < tb.segments.length ? tb.segments[i + 1]!.t0 : until)
    const one = { ...tb, segments: [seg] }
    for (let k = 0; k <= 12; k++) {
      const r = stateAtTime(one, t0 + ((t1 - t0) * k) / 12).r
      pts.push([r[0], r[1]])
    }
  })
  let best = Infinity
  let signed: number | null = null
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-14) continue
    const t = Math.max(0, Math.min(1, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / len2))
    const cx = a[0] + t * dx
    const cy = a[1] + t * dy
    const d = Math.hypot(P[0] - cx, P[1] - cy)
    if (d < best) {
      best = d
      signed = Math.sign(dx * (P[1] - cy) - dy * (P[0] - cx)) * d
    }
  }
  return signed
}

/**
 * Solve the aim φ for f(φ) = 0 near φ₀: sample [φ₀ − span, φ₀ + span],
 * take the sign change nearest φ₀, then refine with the Illinois variant of
 * regula falsi. `f` returns null where the shot is invalid (e.g. the wrong
 * first contact). Returns the best preview found, or null.
 */
function solveAim(phi0: number, span: number, f: (phi: number) => { v: number | null; p: Preview }, samples = 9, iters = 5): { phi: number; p: Preview } | null {
  const xs: { phi: number; v: number | null; p: Preview }[] = []
  for (let i = 0; i < samples; i++) {
    const phi = phi0 - span + (2 * span * i) / (samples - 1)
    xs.push({ phi, ...f(phi) })
  }
  const zero = xs.find((x) => x.v === 0)
  if (zero) return zero
  let bracket: [(typeof xs)[number], (typeof xs)[number]] | null = null
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]!
    const b = xs[i + 1]!
    if (a.v === null || b.v === null || Math.sign(a.v) === Math.sign(b.v)) continue
    // Jumps across a discontinuity (e.g. a jaw) aren't real crossings.
    if (Math.abs(a.v) > 0.25 || Math.abs(b.v) > 0.25) continue
    if (!bracket || Math.abs((a.phi + b.phi) / 2 - phi0) < Math.abs((bracket[0].phi + bracket[1].phi) / 2 - phi0)) bracket = [a, b]
  }
  if (!bracket) return null
  let [a, b] = bracket
  let fa = a.v!
  let fb = b.v!
  let side = 0
  let best = Math.abs(fa) < Math.abs(fb) ? a : b
  for (let k = 0; k < iters; k++) {
    const phi = (a.phi * fb - b.phi * fa) / (fb - fa)
    const c = { phi, ...f(phi) }
    if (c.v === null) break
    if (Math.abs(c.v) < Math.abs(best.v!)) best = c
    if (c.v === 0) break
    if (Math.sign(c.v) === Math.sign(fb)) {
      b = c
      fb = c.v
      if (side === -1) fa /= 2
      side = -1
    } else {
      a = c
      fa = c.v
      if (side === 1) fb /= 2
      side = 1
    }
  }
  return best
}

/** The four rails as the lines a ball's center reflects off: [axis, coordinate, name]. */
function railLines(game: Game): [0 | 1, number, string][] {
  const R = game.params.R
  const { w, l } = game.spec
  return [
    [0, R, "left rail"],
    [0, w - R, "right rail"],
    [1, R, "head rail"],
    [1, l - R, "foot rail"],
  ]
}

const mirror = (p: Point, axis: 0 | 1, c: number): Point => (axis === 0 ? [2 * c - p[0], p[1]] : [p[0], 2 * c - p[1]])

const firstContactIs = (p: Preview, ball: string) => p.facts.firstContacts[0] === ball

/** Aim (degrees) from the cue ball at C to send the ball at O toward D, plus that shot's cut angle. */
function aimToSend(game: Game, C: Point, O: Point, D: Point): { phi: number; cut: number } {
  const R = game.params.R
  const dx = D[0] - O[0]
  const dy = D[1] - O[1]
  const n = Math.hypot(dx, dy)
  const ghost: Point = [O[0] - (2 * R * dx) / n, O[1] - (2 * R * dy) / n]
  const vx = ghost[0] - C[0]
  const vy = ghost[1] - C[1]
  const cut = deg(Math.acos(Math.max(-1, Math.min(1, (vx * dx + vy * dy) / (Math.hypot(vx, vy) * n)))))
  return { phi: deg(Math.atan2(vy, vx)), cut }
}

/** Whether any ball other than `except` lies within 2R of the segment a–b. */
function blocked(game: Game, balls: ReadonlyMap<string, BallState>, a: Point, b: Point, except: string[]): boolean {
  for (const [id, s] of balls) if (!except.includes(id) && segDist(xy(s), a, b) < 2 * game.params.R) return true
  return false
}

/** One-rail banks: the object ball off a rail into a pocket. */
export function bankCandidates(game: Game, me: Player, level: AiLevel, balls: ReadonlyMap<string, BallState>): Candidate[] {
  const cue = balls.get(CUE)
  if (!cue) return []
  const C = xy(cue)
  const out: Candidate[] = []
  for (const ball of targetsFor(game, game.state, me, balls)) {
    const O = xy(balls.get(ball)!)
    for (const pk of game.table.pockets) {
      const P: Point = [pk.center[0], pk.center[1]]
      for (const [axis, c, railName] of railLines(game)) {
        const Pm = mirror(P, axis, c)
        // The bank point must be on the rail, between the object ball and the mirrored pocket.
        const t = (c - O[axis]) / (Pm[axis] - O[axis])
        if (!(t > 0 && t < 1)) continue
        const hit: Point = [O[0] + t * (Pm[0] - O[0]), O[1] + t * (Pm[1] - O[1])]
        const along = hit[1 - axis]!
        const span = axis === 0 ? game.spec.l : game.spec.w
        if (along < 0.12 || along > span - 0.12) continue
        if (axis === 1 ? false : Math.abs(along - game.spec.l / 2) < 0.12) continue
        const { phi, cut } = aimToSend(game, C, O, Pm)
        if (cut > 65) continue
        if (blocked(game, balls, C, O, [CUE, ball]) || blocked(game, balls, O, hit, [CUE, ball]) || blocked(game, balls, hit, P, [CUE, ball])) continue
        const call: Call | null = game.discipline === "8-ball" ? { ball, pocket: pk.id } : null
        for (const V0 of [2.4, 3.6]) {
          const strike = (ph: number): CueStrike => ({ V0, phi: ph, theta: 0, a: 0, b: 0 })
          const sol = solveAim(phi, 1.5, (ph) => {
            const p = game.preview(strike(ph), { call }, balls)
            return { p, v: firstContactIs(p, ball) ? pathMiss(p, ball, P, pk.id) : null }
          })
          if (!sol) continue
          out.push({
            strike: strike(sol.phi),
            call,
            placement: null,
            kind: "bank",
            target: { ball, pocket: pk.id },
            description: `bank the ${ball} off the ${railName} into the ${pocketText(pk.id)}`,
            balls,
            value: score(game, me, sol.p, level),
          })
        }
      }
    }
  }
  return out
}

/** Combinations: the cue ball drives a legal ball A into ball B, which goes in. */
export function comboCandidates(game: Game, me: Player, level: AiLevel, balls: ReadonlyMap<string, BallState>, onlyBall?: string): Candidate[] {
  const cue = balls.get(CUE)
  if (!cue) return []
  const C = xy(cue)
  const R = game.params.R
  const out: Candidate[] = []
  const firsts = targetsFor(game, game.state, me, balls)
  // At 8-ball the called ball must be a legal one too; at 9-ball any ball counts.
  const seconds = [...balls.keys()].filter(
    (id) => id !== CUE && (onlyBall ? id === onlyBall : game.discipline === "9-ball" || firsts.includes(id)),
  )
  for (const a of firsts) {
    const A = xy(balls.get(a)!)
    for (const b of seconds) {
      if (b === a) continue
      const B = xy(balls.get(b)!)
      if (Math.hypot(B[0] - A[0], B[1] - A[1]) > 0.8) continue
      for (const pk of game.table.pockets) {
        const P: Point = [pk.center[0], pk.center[1]]
        const dB = Math.hypot(P[0] - B[0], P[1] - B[1])
        const ghostB: Point = [B[0] - (2 * R * (P[0] - B[0])) / dB, B[1] - (2 * R * (P[1] - B[1])) / dB]
        // Cut at B: A arrives along A→ghostB.
        const ax = ghostB[0] - A[0]
        const ay = ghostB[1] - A[1]
        const cutB = deg(Math.acos(Math.max(-1, Math.min(1, (ax * (P[0] - B[0]) + ay * (P[1] - B[1])) / (Math.hypot(ax, ay) * dB)))))
        if (cutB > 45) continue
        const { phi, cut } = aimToSend(game, C, A, ghostB)
        if (cut > 55) continue
        if (blocked(game, balls, C, A, [CUE, a]) || blocked(game, balls, A, ghostB, [CUE, a, b]) || blocked(game, balls, B, P, [CUE, a, b])) continue
        const call: Call | null = game.discipline === "8-ball" ? { ball: b, pocket: pk.id } : null
        for (const V0 of [2.2, 3.4]) {
          const strike = (ph: number): CueStrike => ({ V0, phi: ph, theta: 0, a: 0, b: 0 })
          const sol = solveAim(phi, 1.2, (ph) => {
            const p = game.preview(strike(ph), { call }, balls)
            return { p, v: firstContactIs(p, a) ? pathMiss(p, b, P, pk.id) : null }
          })
          if (!sol) continue
          out.push({
            strike: strike(sol.phi),
            call,
            placement: null,
            kind: "combo",
            target: { ball: b, pocket: pk.id },
            description: `the ${a}–${b} combination into the ${pocketText(pk.id)}`,
            balls,
            value: score(game, me, sol.p, level),
          })
        }
      }
    }
  }
  return out
}

/**
 * One-rail kicks: the cue ball off a rail to hit a legal ball, for when no
 * direct path is open. The aim solves for a full hit (zero contact offset).
 */
export function kickCandidates(game: Game, me: Player, level: AiLevel, balls: ReadonlyMap<string, BallState>): Candidate[] {
  const cue = balls.get(CUE)
  if (!cue) return []
  const C = xy(cue)
  const out: Candidate[] = []
  const call: Call | null = game.discipline === "8-ball" ? "safety" : null
  for (const ball of targetsFor(game, game.state, me, balls)) {
    const O = xy(balls.get(ball)!)
    for (const [axis, c, railName] of railLines(game)) {
      const Om = mirror(O, axis, c)
      const t = (c - C[axis]) / (Om[axis] - C[axis])
      if (!(t > 0 && t < 1)) continue
      const phi = deg(Math.atan2(Om[1] - C[1], Om[0] - C[0]))
      for (const V0 of [1.6, 2.8]) {
        const strike = (ph: number): CueStrike => ({ V0, phi: ph, theta: 0, a: 0, b: 0 })
        const sol = solveAim(phi, 2.5, (ph) => {
          const p = game.preview(strike(ph), { call }, balls)
          return { p, v: contactOffset(p, ball) ?? pathMiss(p, CUE, O) }
        })
        if (!sol) continue
        out.push({
          strike: strike(sol.phi),
          call,
          placement: null,
          kind: "kick",
          description: `a kick off the ${railName} at the ${ball}`,
          balls,
          value: score(game, me, sol.p, level),
        })
      }
    }
  }
  return out
}

/**
 * Signed contact offset (m) when the cue ball's first contact is `ball`: the
 * object ball's center relative to the cue ball's incoming path (positive to
 * its left); 0 is a full hit. Null if `ball` wasn't hit first.
 */
function contactOffset(p: Preview, ball: string): number | null {
  if (!firstContactIs(p, ball)) return null
  const e = p.result.events.find((x) => x.type === "ball_ball" && x.ids.includes(CUE) && x.ids.includes(ball))
  const cueTraj = p.trajectories.balls.find((b) => b.id === CUE)
  if (!e || !cueTraj) return null
  const before = { ...cueTraj, segments: cueTraj.segments.filter((s) => s.t0 < e.time) }
  if (before.segments.length === 0) return null
  const v = stateAtTime(before, e.time).v
  const n = Math.hypot(v[0], v[1])
  if (n === 0) return null
  const C = e.states[CUE]!.r
  const O = e.states[ball]!.r
  return (v[0] * (O[1] - C[1]) - v[1] * (O[0] - C[0])) / n
}

/**
 * 9-ball push outs (5.4). The opponent then chooses who shoots, so a push is
 * worth most when the next shot is a coin flip for whoever takes it:
 * value −POSITION·|2E − 1|, where E is that shot's ease.
 */
export function pushCandidates(game: Game, balls: ReadonlyMap<string, BallState>): Candidate[] {
  const out: Candidate[] = []
  for (let d = 0; d < 360; d += 10) {
    for (const V0 of [0.6, 1.1]) {
      const strike: CueStrike = { V0, phi: d, theta: 0, a: 0, b: 0 }
      const p = game.preview(strike, { pushOut: true }, balls)
      let value: number
      if (p.ruling.fouls.length > 0) value = FOUL
      else {
        const st = { ...p.ruling.state, pending: null }
        value = -POSITION * Math.abs(2 * bestEase(game, st, st.shooter, p.after) - 1)
      }
      out.push({ strike, call: null, placement: null, kind: "push", pushOut: true, description: "a push out", balls, value })
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
  return { strike: { V0: level.breakSpeed, phi, theta: 0, a: 0, b: -0.15 }, call: null, placement, kind: "break", pushOut: false, value: 0, description: "the break" }
}

/** Plan the next shot for the current shooter. Deterministic given the rng state. */
export function planShot(game: Game, level: AiLevel, rng: Rng): AiPlan {
  const s = game.state
  if (s.winner !== null || s.pending) throw new Error("no shot to plan")
  if (s.isBreak) return breakPlan(game, level)
  const me = s.shooter
  const top = (cs: Candidate[]) => cs.reduce((m, c) => Math.max(m, c.value), -Infinity)

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
    const pots = potCandidates(game, me, level, game.balls, null)
    cands = [...pots, ...safetyCandidates(game, me, level, game.balls, null)]
    // A combination on the 9 wins the rack: always look for one.
    if (game.discipline === "9-ball" && game.balls.has("9")) cands.push(...comboCandidates(game, me, level, game.balls, "9"))
    // No makeable direct pot: try banks and combinations.
    if (top(pots) < CONTINUE) {
      cands.push(...bankCandidates(game, me, level, game.balls))
      if (game.discipline === "8-ball") cands.push(...comboCandidates(game, me, level, game.balls))
    }
    // Every option fouls or leaves a disaster (e.g. snookered): try kicks.
    if (top(cands) < PASS) cands.push(...kickCandidates(game, me, level, game.balls))
  }
  // 9-ball: push out instead, if nothing beats a coin-flip position.
  if (s.pushOutAvailable) {
    const push = pushCandidates(game, game.balls)
    if (top(push) > top(cands)) cands.push(...push)
  }
  if (cands.length === 0) {
    // Nothing found (e.g. nowhere legal to place): hit the first legal ball softly.
    const t = targetsFor(game, s, me, game.balls)[0]
    const c = game.balls.get(CUE)!
    const o = t ? game.balls.get(t)! : c
    const phi = deg(Math.atan2(o.r[1] - c.r[1], o.r[0] - c.r[0]))
    return {
      strike: { V0: 2, phi, theta: 0, a: 0, b: 0 },
      call: game.discipline === "8-ball" ? "safety" : null,
      placement: null,
      kind: "safety",
      pushOut: false,
      value: 0,
      description: "a safety",
    }
  }

  // On a tie, an intended shot beats a safety that happens to score as well
  // (e.g. a soft shot that wins by luck off several rails).
  cands.sort((p, q) => q.value - p.value || Number(p.kind === "safety") - Number(q.kind === "safety"))
  let best = cands[0]!
  if (level.finalists > 0 && level.robustSamples > 0) {
    // Finalists: the best pots and the best safeties, re-run under our own noise.
    const pots = cands.filter((c) => c.kind !== "safety" && c.kind !== "push").slice(0, level.finalists)
    const safeties = cands.filter((c) => c.kind === "safety").slice(0, Math.ceil(level.finalists / 2))
    let bestMean = -Infinity
    const pushes = cands.filter((c) => c.kind === "push").slice(0, 2)
    for (const c of [...pots, ...safeties, ...pushes]) {
      let sum = 0
      for (let i = 0; i < level.robustSamples; i++) {
        const p = game.preview(executionNoise(c.strike, level, rng), { call: c.call, pushOut: c.pushOut ?? false }, c.balls)
        sum += c.pushOut ? (p.ruling.fouls.length > 0 ? FOUL : c.value) : score(game, me, p, level)
      }
      const mean = sum / level.robustSamples
      if (mean > bestMean) {
        bestMean = mean
        best = { ...c, value: mean }
      }
    }
  }
  return {
    strike: best.strike,
    call: best.call,
    placement: best.placement,
    kind: best.kind,
    pushOut: best.pushOut ?? false,
    value: best.value,
    description: best.description,
    ...(best.target ? { target: best.target } : {}),
  }
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
