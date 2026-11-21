/**
 * Collision resolvers checked against every collision in the pooltool
 * fixtures, in isolation from detection: each involved ball's last recorded
 * state is evolved to the event time, resolved, and compared with pooltool's
 * post-event state. Runs on the default-model fixtures and on the ones made
 * with Mathavan's ball-ball and cushion models.
 */
import { describe, expect, it } from "vitest"
import { evolve, type BallState } from "../src/motion.ts"
import { resolveBallBall } from "../src/resolve/ball-ball.ts"
import { resolveCircularCushion, resolveLinearCushion } from "../src/resolve/cushion.ts"
import { resolvePocket } from "../src/resolve/pocket.ts"
import { resolveStickBall } from "../src/resolve/stick-ball.ts"
import { stateError, toCueSpecs, toModelConfig, toParams, toState, toTable } from "./support/fixture-convert.ts"
import { loadFixtures, type FixtureEvent, type FixtureFile } from "./support/pooltool-fixtures.ts"

interface Stat { n: number; worst: number; where: string; failures: string[] }

function check(files: FixtureFile[], tolerance: number): Map<string, Stat> {
const stats = new Map<string, Stat>()
for (const file of files) {
  const table = toTable(file)
  const config = toModelConfig(file)
  const linear = new Map(table.linear.map((c) => [c.id, c]))
  const circular = new Map(table.circular.map((c) => [c.id, c]))
  const pockets = new Map(table.pockets.map((p) => [p.id, p]))
  for (const shot of file.shots) {
    const params = new Map(shot.balls.map((b) => [b.id, toParams(b.params)]))
    const last = new Map<string, { t: number; state: BallState }>(shot.balls.map((b) => [b.id, { t: 0, state: toState(b) }]))
    const at = (id: string, t: number) => {
      const l = last.get(id)!
      return evolve(l.state, params.get(id)!, t - l.t)
    }
    for (const e of shot.events) {
      const got = resolveEvent(e)
      if (got) {
        const st = stats.get(e.type) ?? { n: 0, worst: 0, where: "", failures: [] }
        for (const [id, s] of Object.entries(got)) {
          const err = stateError(s, toState(e.states[id]!))
          st.n++
          if (err > st.worst) {
            st.worst = err
            st.where = `${file.category}/${shot.name} t=${e.time}`
          }
          if (err > tolerance || s.s !== e.states[id]!.s) st.failures.push(`${file.category}/${shot.name} ${e.type} t=${e.time} ${id}: err ${err}, state ${s.s} vs ${e.states[id]!.s}`)
        }
        stats.set(e.type, st)
      }
      for (const [id, s] of Object.entries(e.states)) last.set(id, { t: e.time, state: toState(s) })
    }

    function resolveEvent(e: FixtureEvent): Record<string, BallState> | null {
      const [a, b] = e.ids as [string, string]
      switch (e.type) {
        case "stick_ball":
          return { [b]: resolveStickBall(at(b, e.time), params.get(b)!, shot.cue, toCueSpecs(shot.cue.specs), config.stickBall) }
        case "ball_ball": {
          const [s1, s2] = resolveBallBall(at(a, e.time), at(b, e.time), params.get(a)!, params.get(b)!, config.ballBall)
          return { [a]: s1, [b]: s2 }
        }
        case "ball_linear_cushion":
          return { [a]: resolveLinearCushion(at(a, e.time), linear.get(b)!, params.get(a)!, config.cushion) }
        case "ball_circular_cushion":
          return { [a]: resolveCircularCushion(at(a, e.time), circular.get(b)!, params.get(a)!, config.cushion) }
        case "ball_pocket":
          return { [a]: resolvePocket(pockets.get(b)!) }
        default:
          return null
      }
    }
  }
}

return stats
}

const sets = [
  { name: "default models", files: loadFixtures(), tolerance: 1e-8 },
  { name: "Mathavan models", files: loadFixtures("mathavan"), tolerance: 1e-8 },
]

for (const set of sets) {
  describe(`collision resolvers vs pooltool fixtures (${set.name})`, () => {
    const stats = check(set.files, set.tolerance)
    for (const type of ["stick_ball", "ball_ball", "ball_linear_cushion", "ball_circular_cushion", "ball_pocket"]) {
      it(type, () => {
        const st = stats.get(type)!
        console.log(`${set.name} ${type}: ${st.n} states, worst relative error ${st.worst.toExponential(2)} (${st.where}), failures ${st.failures.length}`)
        expect(st.n).toBeGreaterThan(0)
        expect(st.failures.slice(0, 8)).toEqual([])
      })
    }
  })
}
