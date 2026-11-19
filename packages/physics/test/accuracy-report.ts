/**
 * Prints an accuracy report for the quartic solver against exact ground truth.
 *
 *   node test/accuracy-report.ts [countPerFamily]
 *   DEGREE=3 node test/accuracy-report.ts      (cubic solver)
 *   FAMILY="close real pair" WORST=1 ...       (one family, print worst case)
 *
 * Columns:
 *   stability  forward error / (eps * cond); 1 = as accurate as float64 allows
 *   bwd        backward error in units of eps: the change to each coefficient
 *              that makes the computed roots exact, relative to the size of that
 *              coefficient's terms (see test/support/metrics.ts)
 *   real≠      cases where the number of computed real roots differs from the
 *              exact number of distinct real roots, and the computed roots are
 *              NOT within 4 eps backward error (a genuine failure)
 *   undecidable  count differs, but the computed roots are exact for a
 *              polynomial within 4 eps per coefficient (float64 cannot decide)
 */
import { createRoots, solveCubic, solveQuartic } from "../src/index.ts"
import { cubicFamilies, families, generateFrom } from "./support/cases.ts"
import { analyze } from "./support/metrics.ts"

const count = Number(process.argv[2] ?? 300)
const out = createRoots()
const cubic = process.env.DEGREE === "3"
const set = cubic ? cubicFamilies : families

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toPrecision(3) : String(x))

console.log(
  ["family", "stab p50", "stab p99", "stab max", "bwd p50", "bwd max", "real≠", "undecidable"].join("\t"),
)
for (const family of Object.keys(set).filter((f) => !process.env.FAMILY || f === process.env.FAMILY)) {
  const stab: number[] = []
  const bwd: number[] = []
  let mismatch = 0
  let ambiguous = 0
  let worst = { stab: 0, coeffs: [] as number[] }
  for (const c of generateFrom(set, family, count, 12345)) {
    const k = c.coeffs as [number, number, number, number, number]
    if (cubic) solveCubic(k[0], k[1], k[2], k[3], out)
    else solveQuartic(k[0], k[1], k[2], k[3], k[4], out)
    const re = Array.from(out.re.subarray(0, out.count))
    const im = Array.from(out.im.subarray(0, out.count))
    const rep = analyze(c.coeffs, { re, im })
    for (const r of rep.roots) {
      if (Number.isFinite(r.cond)) stab.push(r.stability)
      if (r.stability > worst.stab) worst = { stab: r.stability, coeffs: c.coeffs }
    }
    bwd.push(rep.backwardError)
    if (rep.exactRealCount !== rep.computedRealCount && rep.backwardError <= 4) {
      // The computed roots are exact for a polynomial within 4 eps of the
      // input per coefficient: float64 cannot decide this real/complex split.
      ambiguous++
    } else if (rep.exactRealCount !== rep.computedRealCount) {
      mismatch++
      if (process.env.WORST) console.log("  count mismatch:", JSON.stringify(c.coeffs), JSON.stringify({ re, im }), rep.roots.map((x) => x.root), "bwd(eps):", rep.backwardError)
    }
  }
  console.log(
    [family, fmt(quantile(stab, 0.5)), fmt(quantile(stab, 0.99)), fmt(Math.max(...stab)),
      fmt(quantile(bwd, 0.5)), fmt(Math.max(...bwd)), mismatch, ambiguous].join("\t"),
  )
  if (process.env.WORST) console.log("  worst:", JSON.stringify(worst))
}
