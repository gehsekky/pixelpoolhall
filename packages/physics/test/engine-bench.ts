/**
 * Engine throughput on the pooltool fixture shots.
 *
 *   node test/engine-bench.ts            all categories
 *   CATEGORY=break node test/engine-bench.ts
 */
import { simulate, type Shot } from "../src/engine.ts"
import { toCueSpecs, toModelConfig, toParams, toState, toTable } from "./support/fixture-convert.ts"
import { loadFixtures } from "./support/pooltool-fixtures.ts"

const budgetMs = Number(process.env.BUDGET_MS ?? 1500)
console.log(["category", "ms/shot", "events/shot", "shots/s", "events/s"].join("\t"))
for (const f of loadFixtures().filter((f) => !process.env.CATEGORY || f.category === process.env.CATEGORY)) {
  const shots: Shot[] = f.shots.map((s) => ({
    table: toTable(f),
    balls: s.balls.map((b) => ({ id: b.id, params: toParams(b.params), state: toState(b) })),
    cueBall: s.cue.ball,
    strike: s.cue,
    cueSpecs: toCueSpecs(s.cue.specs),
    config: toModelConfig(f),
  }))
  for (let i = 0; i < 3; i++) for (const s of shots) simulate(s) // warm up the JIT
  let runs = 0
  let events = 0
  const t0 = performance.now()
  while (performance.now() - t0 < budgetMs) {
    for (const s of shots) events += simulate(s).events.length
    runs += shots.length
  }
  const ms = (performance.now() - t0) / runs
  console.log([f.category, ms.toFixed(3), (events / runs).toFixed(0), (1000 / ms).toFixed(0), ((events / runs) * (1000 / ms)).toFixed(0)].join("\t"))
}
