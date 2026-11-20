/**
 * 3D engine (`dim: "3d"`) against pooltool's 3D engine (`is_3d=True`):
 * every 2D category re-run in 3D (rail hops, airborne breaks) plus jump
 * shots, balls leaving the table and collisions in the air.
 */
import { describe, expect, it } from "vitest"
import { compareShot, STATE_TOL, TIME_TOL, type ShotComparison } from "./support/compare-shots.ts"
import { loadFixtures } from "./support/pooltool-fixtures.ts"

const files = loadFixtures(true)
const results: ShotComparison[] = files.flatMap((f) => f.shots.map((s) => compareShot(f, s)))

describe("3D engine vs pooltool 3D fixtures", () => {
  it("produces the same event sequence for every shot", () => {
    const events = results.reduce((n, r) => n + r.theirEvents, 0)
    console.log(`${results.length} shots, ${events} events`)
    expect(results.filter((r) => r.firstStructuralDivergence >= 0).map((r) => `${r.category}/${r.name} at event ${r.firstStructuralDivergence}: ${r.divergence}`)).toEqual([])
  })

  it(`matches event times within ${TIME_TOL} s and states within ${STATE_TOL} (all but breaks)`, () => {
    const calm = results.filter((r) => r.category !== "break")
    const worstTime = Math.max(...calm.map((r) => r.maxTimeError))
    const worstState = Math.max(...calm.map((r) => r.maxStateError))
    console.log(`worst time error ${worstTime.toExponential(2)} s, worst state error ${worstState.toExponential(2)}`)
    expect(calm.filter((r) => r.firstDivergence >= 0).map((r) => `${r.category}/${r.name} at event ${r.firstDivergence}: ${r.divergence}`)).toEqual([])
  })

  it("ends every shot within 0.1 mm of pooltool's final positions", () => {
    const worst = results.reduce((a, r) => (r.finalPositionError > a.finalPositionError ? r : a))
    console.log(`worst final position error ${worst.finalPositionError.toExponential(2)} m (${worst.category}/${worst.name})`)
    expect(results.filter((r) => r.finalPositionError > 1e-4).map((r) => `${r.category}/${r.name}`)).toEqual([])
  })
})

describe("3D engine: physical invariants", () => {
  const params = new Map(files.flatMap((f) => f.shots.map((s) => [`${f.category}/${s.name}`, s.balls[0]!.params as { m: number; R: number; g: number }] as const)))

  it("mechanical energy (kinetic + potential) never increases after the strike", () => {
    const bad: string[] = []
    for (const r of results) {
      const { m, R, g } = params.get(`${r.category}/${r.name}`)!
      const energy = new Map<string, number>()
      let total = Infinity
      for (const e of r.ours.events) {
        for (const [id, s] of Object.entries(e.states)) {
          const onTable = s.s !== 4 && s.s !== 6
          energy.set(id, onTable ? 0.5 * m * (s.v[0] ** 2 + s.v[1] ** 2 + s.v[2] ** 2) + 0.2 * m * R * R * (s.w[0] ** 2 + s.w[1] ** 2 + s.w[2] ** 2) + m * g * (s.r[2] - R) : 0)
        }
        if (e.type === "none") continue
        const now = [...energy.values()].reduce((a, b) => a + b, 0)
        if (e.type !== "stick_ball" && now > total * (1 + 1e-9) + 1e-12) bad.push(`${r.category}/${r.name} ${e.type} @${e.time}`)
        total = now
      }
    }
    expect(bad).toEqual([])
  })

  it("never leaves a ball below the slate, and every ball ends at rest, pocketed or off the table", () => {
    const bad: string[] = []
    for (const r of results) {
      const { R } = params.get(`${r.category}/${r.name}`)!
      for (const e of r.ours.events)
        for (const [id, s] of Object.entries(e.states)) if (s.s !== 4 && s.r[2] < R - 1e-12) bad.push(`${r.category}/${r.name} ${id} z=${s.r[2]}`)
      for (const [id, s] of Object.entries(r.ours.final)) if (![0, 4, 6].includes(s.s)) bad.push(`${r.category}/${r.name} ${id} ends in state ${s.s}`)
    }
    expect(bad).toEqual([])
  })
})
