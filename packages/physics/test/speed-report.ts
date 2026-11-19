/**
 * Throughput of solveQuartic per test family, and how often the robust
 * (Aberth) fallback runs.
 *
 *   node test/speed-report.ts
 */
import { createRoots, solveQuartic } from "../src/index.ts"
import { quarticStats } from "../src/math/roots/quartic.ts"
import { families, generate } from "./support/cases.ts"

const N = 20000
const out = createRoots()
console.log(["family", "Msolves/s", "fallback %"].join("\t"))
for (const family of Object.keys(families)) {
  const cases = generate(family, N, 777).map((c) => c.coeffs)
  const flat = new Float64Array(cases.flat())
  // warm up
  for (let i = 0; i < N; i++) solveQuartic(flat[5 * i], flat[5 * i + 1], flat[5 * i + 2], flat[5 * i + 3], flat[5 * i + 4], out)
  quarticStats.calls = 0
  quarticStats.fallbacks = 0
  const reps = 10
  const t0 = performance.now()
  for (let r = 0; r < reps; r++)
    for (let i = 0; i < N; i++) solveQuartic(flat[5 * i], flat[5 * i + 1], flat[5 * i + 2], flat[5 * i + 3], flat[5 * i + 4], out)
  const dt = (performance.now() - t0) / 1000
  console.log([family, ((N * reps) / dt / 1e6).toFixed(2), ((100 * quarticStats.fallbacks) / quarticStats.calls).toFixed(2)].join("\t"))
}
