import { describe, expect, it } from "vitest"
import { simulate } from "../src/engine.ts"
import { stateAtTime, trajectories } from "../src/trajectory.ts"
import { buildPocketTable, POOLTOOL_7FT } from "../src/table-builder.ts"
import { DEFAULT_BALL_PARAMS } from "../src/params.ts"
import { MotionState } from "../src/motion.ts"

describe("trajectories", () => {
  const p = DEFAULT_BALL_PARAMS
  const shot = {
    table: buildPocketTable(POOLTOOL_7FT),
    balls: [
      { id: "cue", params: p, state: { r: [0.5, 0.5, p.R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary } },
      { id: "1", params: p, state: { r: [0.5, 1.0, p.R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary } },
    ],
    cueBall: "cue",
    strike: { V0: 2, phi: 90, theta: 0, a: 0, b: 0.2 },
  } as Parameters<typeof simulate>[0]
  const result = simulate(shot)
  const traj = trajectories(shot, result)

  it("reproduces every post-event state at its event time, and the final state", () => {
    for (const e of result.events) {
      for (const [id, s] of Object.entries(e.states)) {
        expect(stateAtTime(traj.balls.find((b) => b.id === id)!, e.time)).toEqual(s)
      }
    }
    for (const b of traj.balls) expect(stateAtTime(b, traj.duration).r).toEqual(result.final[b.id]!.r)
  })

  it("starts from the initial layout", () => {
    expect(stateAtTime(traj.balls[1]!, 0).r).toEqual([0.5, 1.0, p.R])
  })
})
