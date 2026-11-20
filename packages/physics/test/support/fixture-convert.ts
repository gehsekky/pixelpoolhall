/** Convert pooltool fixture data into engine types. */
import type { BallState } from "../../src/motion.ts"
import type { BallParams, CueSpecs, ModelConfig } from "../../src/params.ts"
import type { CushionSide, Table } from "../../src/table.ts"
import type { BallState as FixtureState, FixtureFile } from "./pooltool-fixtures.ts"

export const toState = (f: FixtureState): BallState => ({
  r: [...f.rvw[0]],
  v: [...f.rvw[1]],
  w: [...f.rvw[2]],
  s: f.s as BallState["s"],
})

export function toTable(f: FixtureFile): Table {
  return {
    linear: f.table.linear.map((c) => ({ id: c.id, p1: [...c.p1], p2: [...c.p2], noseRadius: c.nose_radius, side: c.direction as CushionSide })),
    circular: f.table.circular.map((c) => ({ id: c.id, center: [...c.center], radius: c.radius })),
    pockets: f.table.pockets.map((p) => ({ id: p.id, center: [...p.center], radius: p.radius, depth: p.depth })),
  }
}

export function toModelConfig(f: FixtureFile): ModelConfig {
  const r = f.engine.resolver as Record<string, Record<string, unknown>>
  const friction = r.ball_ball!.friction as { a: number; b: number; c: number }
  return {
    ballBall: { friction: { a: friction.a, b: friction.b, c: friction.c } },
    cushion: { omegaRatio: r.ball_linear_cushion!.omega_ratio as number },
    stickBall: {
      englishThrottle: r.stick_ball!.english_throttle as number,
      squirtThrottle: r.stick_ball!.squirt_throttle as number,
    },
  }
}

export const toParams = (p: unknown): BallParams => p as BallParams
export const toCueSpecs = (s: Record<string, unknown>): CueSpecs => ({
  M: s.M as number,
  end_mass: s.end_mass as number,
  tip_radius: s.tip_radius as number,
})

/** Largest difference between two states, relative to each vector's size (floored at `floor`). */
export function stateError(a: BallState, b: BallState, floor = 1e-3): number {
  let worst = 0
  for (const k of ["r", "v", "w"] as const) {
    const scale = Math.max(floor, Math.hypot(...b[k]))
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(a[k][i]! - b[k][i]!) / scale)
  }
  return worst
}
