/**
 * Motion equations and transition times, checked against every transition in
 * the pooltool fixtures: from a ball's previous recorded state, our closed
 * forms must predict the transition's type, time and resulting state.
 */
import { describe, expect, it } from "vitest"
import { applyTransition, evolve, MotionState, nextTransition, type BallState } from "../src/motion.ts"
import { type BallParams } from "../src/params.ts"
import { loadFixtures, type BallState as FixtureState } from "./support/pooltool-fixtures.ts"

const files = loadFixtures()
const TRANSITIONS = new Set(["sliding_rolling", "rolling_spinning", "rolling_stationary", "spinning_stationary"])

export const toState = (f: FixtureState): BallState => ({
  r: [...f.rvw[0]],
  v: [...f.rvw[1]],
  w: [...f.rvw[2]],
  s: f.s as BallState["s"],
})

/** Largest difference between two states, relative to the scale of each vector (≥ 1e-3). */
function stateError(a: BallState, b: BallState): number {
  let worst = 0
  for (const k of ["r", "v", "w"] as const) {
    const scale = Math.max(1e-3, Math.hypot(...b[k]))
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(a[k][i]! - b[k][i]!) / scale)
  }
  return worst
}

describe("motion vs pooltool fixtures", () => {
  it("predicts every transition's type, time and resulting state", () => {
    let checked = 0
    let worstTime = 0
    let worstState = 0
    const failures: string[] = []
    for (const file of files) {
      for (const shot of file.shots) {
        const params = new Map(shot.balls.map((b) => [b.id, b.params as BallParams]))
        const last = new Map<string, { t: number; state: BallState }>()
        for (const e of shot.events) {
          for (const [id, st] of Object.entries(e.states)) {
            const prev = last.get(id)
            if (TRANSITIONS.has(e.type) && prev) {
              const p = params.get(id)!
              const next = nextTransition(prev.state, p)
              const tPred = prev.t + (next?.dt ?? Infinity)
              const expected = toState(st)
              const got = applyTransition(evolve(prev.state, p, e.time - prev.t), e.type as never)
              const dt = Math.abs(tPred - e.time) / Math.max(1, e.time)
              const ds = stateError(got, expected)
              worstTime = Math.max(worstTime, dt)
              worstState = Math.max(worstState, ds)
              checked++
              if (next?.type !== e.type || dt > 1e-12 || ds > 1e-11 || got.s !== expected.s) {
                failures.push(`${file.category}/${shot.name} ${id} ${e.type}@${e.time}: predicted ${next?.type}@${tPred}, state err ${ds}`)
              }
            }
            last.set(id, { t: e.time, state: toState(st) })
          }
        }
      }
    }
    console.log(`transitions checked: ${checked}, worst time err ${worstTime.toExponential(2)}, worst state err ${worstState.toExponential(2)}`)
    expect(checked).toBeGreaterThan(1000)
    expect(failures.slice(0, 10)).toEqual([])
  })

  it("leaves stationary and pocketed balls untouched", () => {
    const p = files[0]!.shots[0]!.balls[0]!.params as BallParams
    const b: BallState = { r: [0.5, 0.5, p.R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary }
    expect(evolve(b, p, 3)).toEqual(b)
  })
})
