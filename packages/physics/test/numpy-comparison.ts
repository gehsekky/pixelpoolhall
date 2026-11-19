/**
 * Scores our solvers and numpy.roots (LAPACK companion-matrix eigenvalues) on
 * the same cases, against the same exact roots.
 *
 *   node test/numpy-comparison.ts [countPerFamily]
 *   DEGREE=3 node test/numpy-comparison.ts        (cubic)
 *
 * Needs the reference venv (see tools/reference/README.md). Columns as in
 * accuracy-report.ts, plus:
 *   bad   roots with stability > 100, i.e. far less accurate than float64
 *         allows for that root
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createRoots, solveCubic, solveQuartic } from "../src/index.ts"
import { cubicFamilies, families, generateFrom } from "./support/cases.ts"
import { analyze, exactRealRoots, type ComputedRoots, type Report } from "./support/metrics.ts"

const count = Number(process.argv[2] ?? 100)
const cubic = process.env.DEGREE === "3"
const set = cubic ? cubicFamilies : families
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const python = process.env.REFERENCE_PYTHON ?? `${repo}tools/reference/.venv/bin/python`

function numpyRoots(cases: number[][]): ComputedRoots[] {
  const run = spawnSync(python, ["-I", `${repo}tools/reference/numpy_roots.py`], {
    input: JSON.stringify(cases),
    maxBuffer: 1 << 28,
    encoding: "utf8",
  })
  if (run.status !== 0) throw new Error(`numpy_roots.py failed: ${run.stderr || run.error}`)
  const raw = JSON.parse(run.stdout) as { re: (number | null)[]; im: (number | null)[] }[]
  return raw.map((r) => ({ re: r.re.map((x) => x ?? NaN), im: r.im.map((x) => x ?? NaN) }))
}

const out = createRoots()
function ourRoots(coeffs: number[]): ComputedRoots {
  const k = coeffs as [number, number, number, number, number]
  if (cubic) solveCubic(k[0], k[1], k[2], k[3], out)
  else solveQuartic(k[0], k[1], k[2], k[3], k[4], out)
  return { re: Array.from(out.re.subarray(0, out.count)), im: Array.from(out.im.subarray(0, out.count)) }
}

class Tally {
  stab: number[] = []
  bwd: number[] = []
  bad = 0
  mismatch = 0
  ambiguous = 0
  add(rep: Report) {
    for (const r of rep.roots) {
      if (!Number.isFinite(r.cond)) continue
      this.stab.push(r.stability)
      if (!(r.stability <= 100)) this.bad++
    }
    this.bwd.push(rep.backwardError)
    if (rep.exactRealCount !== rep.computedRealCount) {
      if (rep.backwardError <= 4) this.ambiguous++
      else this.mismatch++
    }
  }
  row(): (string | number)[] {
    return [fmt(q(this.stab, 0.5)), fmt(q(this.stab, 0.99)), fmt(max(this.stab)),
      fmt(q(this.bwd, 0.5)), fmt(max(this.bwd)), this.bad, this.mismatch, this.ambiguous]
  }
}

// NaN (e.g. an overflowed root) sorts last and counts as the maximum.
const key = (x: number) => (Number.isNaN(x) ? Infinity : x)
function q(xs: number[], p: number): number {
  if (xs.length === 0) return NaN
  const s = xs.slice().sort((a, b) => key(a) - key(b))
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
}
const max = (xs: number[]) => xs.reduce((m, x) => (key(x) > key(m) ? x : m), -Infinity)
const fmt = (x: number) => (Number.isFinite(x) ? x.toPrecision(3) : String(x))

console.log(["family", "solver", "stab p50", "stab p99", "stab max", "bwd p50", "bwd max", "bad", "real≠", "undecidable"].join("\t"))
for (const family of Object.keys(set).filter((f) => !process.env.FAMILY || f === process.env.FAMILY)) {
  const cases = generateFrom(set, family, count, 12345).map((c) => c.coeffs)
  const theirs = numpyRoots(cases)
  const ours = new Tally()
  const numpy = new Tally()
  cases.forEach((coeffs, i) => {
    const exact = exactRealRoots(coeffs)
    ours.add(analyze(coeffs, ourRoots(coeffs), exact))
    numpy.add(analyze(coeffs, theirs[i]!, exact))
  })
  console.log([family, "ours", ...ours.row()].join("\t"))
  console.log([family, "numpy", ...numpy.row()].join("\t"))
}
