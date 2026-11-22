/**
 * The measured experiments (data.ts), replayed in our engine. Each takes the
 * ball parameters and model config, so the same code validates the defaults
 * and drives the fits.
 */
import { simulate, type ShotResult } from "../../src/engine.ts"
import { classify, MotionState, type BallState } from "../../src/motion.ts"
import { DEFAULT_MODEL_CONFIG, type BallParams, type ModelConfig } from "../../src/params.ts"
import { CushionSide, type Table } from "../../src/table.ts"
import type { Vec3 } from "../../src/math/vec3.ts"

export interface Setup {
  p: BallParams
  config?: ModelConfig
  dim?: "2d" | "3d"
}

const NO_STRIKE = { V0: 0, phi: 0, theta: 0, a: 0, b: 0 }
const OPEN: Table = { linear: [], circular: [], pockets: [] }

/** A ball on the slate with velocity v and angular velocity w. */
function ball(r: [number, number], v: [number, number], w: Vec3, p: BallParams): BallState {
  const pos: Vec3 = [r[0], r[1], p.R]
  const vel: Vec3 = [v[0], v[1], 0]
  return { r: pos, v: vel, w, s: classify(pos, vel, w, p) }
}

/** Rolling (natural roll) at velocity v. */
const rollingW = (v: [number, number], p: BallParams): Vec3 => [-v[1] / p.R, v[0] / p.R, 0]

function run(s: Setup, table: Table, balls: { id: string; state: BallState }[]): ShotResult {
  return simulate({
    table,
    balls: balls.map((b) => ({ id: b.id, params: s.p, state: b.state })),
    cueBall: balls[0]!.id,
    strike: NO_STRIKE,
    config: s.config ?? DEFAULT_MODEL_CONFIG,
    dim: s.dim ?? "3d",
  })
}

/** A straight cushion along the x axis at y = 0 (nose at height h), balls approaching from y > 0. */
function rail(h: number): Table {
  return { linear: [{ id: "rail", p1: [-10, 0, h], p2: [10, 0, h], noseRadius: 0, side: CushionSide.both }], circular: [], pockets: [] }
}

/** Gap left before a contact (m): small enough that the cloth changes nothing measurable on the way. */
const GAP = 1e-7

export interface RailHit {
  /** Velocity in the table plane just after the cushion, and once the ball rolls again. */
  after: [number, number]
  rolling: [number, number] | null
}

/**
 * A ball rolling at `speed` into a rail, `angle` (degrees) from the rail.
 * Returns its velocity just after the impact and once it rolls again.
 */
export function railHit(s: Setup, speed: number, angle: number, h: number): RailHit {
  const a = (angle * Math.PI) / 180
  const v: [number, number] = [speed * Math.cos(a), -speed * Math.sin(a)]
  const d = s.p.R + GAP
  const start = ball([-(d * Math.cos(a)) / Math.sin(a), d], v, rollingW(v, s.p), s.p)
  const res = run(s, rail(h), [{ id: "b", state: start }])
  const k = res.events.findIndex((e) => e.type === "ball_linear_cushion")
  if (k < 0) throw new Error(`no rail contact at ${speed} m/s, ${angle}°`)
  const post = res.events[k]!.states.b!
  // The first time it rolls on the slate after the rail.
  let rolling: [number, number] | null = null
  for (const e of res.events.slice(k)) {
    const st = e.states.b
    if (st && st.s === MotionState.rolling) {
      rolling = [st.v[0], st.v[1]]
      break
    }
  }
  return { after: [post.v[0], post.v[1]], rolling }
}

/** Angle of a velocity from the rail (x axis), degrees, for a ball moving away from it. */
export const fromRail = (v: [number, number]): number => (Math.atan2(Math.abs(v[1]), v[0]) * 180) / Math.PI

/**
 * Stun shot at speed v into an object ball at cut angle `cut` (degrees),
 * with side spin `english` (Alciatore's fraction: ω = (5/4)(v/R)·english,
 * positive outside). Returns the object ball's throw, degrees: the angle of
 * its path (start to rest) from the line of centers, positive in the
 * direction of the cue ball's motion across that line.
 */
export function throwAngle(s: Setup, v: number, cut: number, english: number): number {
  const c = (cut * Math.PI) / 180
  const R = s.p.R
  // Cue ball moving +y. Line of centers at contact n = (sin c, cos c); the
  // cue ball's motion across it is toward (−cos c, sin c) (counterclockwise).
  // Outside English spins the cue ball so its surface at the contact moves
  // with the object ball's (reducing the sliding there): clockwise here.
  const wz = -(5 / 4) * (v / R) * english
  const n: [number, number] = [Math.sin(c), Math.cos(c)]
  const d = 2 * R + GAP
  const cue = ball([0, 0], [0, v], [0, 0, wz], s.p)
  const ob = ball([d * n[0], d * n[1]], [0, 0], [0, 0, 0], s.p)
  const res = run(s, OPEN, [
    { id: "cue", state: cue },
    { id: "ob", state: ob },
  ])
  const end = res.final.ob!
  const dx = end.r[0] - ob.r[0]
  const dy = end.r[1] - ob.r[1]
  // Signed angle from n to the path, counterclockwise positive.
  return (Math.atan2(n[0] * dy - n[1] * dx, n[0] * dx + n[1] * dy) * 180) / Math.PI
}

/** Inches of throw per yard of travel, from degrees. */
export const inPerYd = (deg: number): number => 36 * Math.tan((deg * Math.PI) / 180)

/**
 * A rolling cue ball at speed v into an object ball at cut angle `cut`
 * (degrees). Returns each ball's speed once it first rolls after the
 * collision (null if it never does).
 */
export function rollingSpeedsAfterHit(s: Setup, v: number, cut: number): { cue: number | null; object: number | null } {
  const c = (cut * Math.PI) / 180
  const R = s.p.R
  const d = 2 * R + GAP
  const vel: [number, number] = [0, v]
  const cue = ball([0, 0], vel, rollingW(vel, s.p), s.p)
  const ob = ball([d * Math.sin(c), d * Math.cos(c)], [0, 0], [0, 0, 0], s.p)
  const res = run(s, OPEN, [
    { id: "cue", state: cue },
    { id: "ob", state: ob },
  ])
  const k = res.events.findIndex((e) => e.type === "ball_ball")
  if (k < 0) throw new Error("no collision")
  const speed = (id: string): number | null => {
    for (const e of res.events.slice(k)) {
      const st = e.states[id]
      if (st && st.s === MotionState.rolling) return Math.hypot(st.v[0], st.v[1])
    }
    return null
  }
  return { cue: speed("cue"), object: speed("ob") }
}
