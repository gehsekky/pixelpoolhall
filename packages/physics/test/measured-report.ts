/**
 * Compares the physics with published measurements (test/measured/data.ts)
 * and fits parameters to them by least squares.
 *
 *   node test/measured-report.ts
 *
 * Prints markdown: each dataset's residuals at the default parameters, for
 * both collision models, then the fits. The results are recorded in
 * docs/physics-design.md, "Measured data".
 */
import { DEFAULT_BALL_PARAMS as P, DEFAULT_MODEL_CONFIG as C, MEASURED_BALL_PARAMS as M, MEASURED_MODEL_CONFIG as MC, type BallParams, type ModelConfig } from "../src/params.ts"
import { SOURCES } from "./measured/data.ts"
import type { Setup } from "./measured/experiments.ts"
import { ballBallSpeeds, cushionRebound, maxAbs, railAngles, rms, snooker, throwInches, type Comparison } from "./measured/residuals.ts"
import { nelderMead } from "./support/nelder-mead.ts"

const cushionModels = ["stronge", "mathavan"] as const
const ballModels = ["frictional_inelastic", "mathavan"] as const
const withCushion = (model: (typeof cushionModels)[number]): ModelConfig => ({ ...C, cushion: { ...C.cushion, model } })
const withBall = (model: (typeof ballModels)[number], friction = C.ballBall.friction): ModelConfig => ({ ...C, ballBall: { ...C.ballBall, model, friction } })

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—")

function table(title: string, unit: string, columns: [string, Comparison[]][], d = 2): void {
  console.log(`\n#### ${title}\n`)
  console.log(`| | measured | ${columns.map(([n]) => n).join(" | ")} |`)
  console.log(`|---|---|${columns.map(() => "---").join("|")}|`)
  columns[0]![1].forEach((c, i) => {
    console.log(`| ${c.label} | ${f(c.measured, d)} | ${columns.map(([, cs]) => f(cs[i]!.predicted, d)).join(" | ")} |`)
  })
  console.log(`| **RMS error (${unit})** | | ${columns.map(([, cs]) => f(rms(cs), d)).join(" | ")} |`)
  console.log(`| **max error** | | ${columns.map(([, cs]) => f(maxAbs(cs), d)).join(" | ")} |`)
}

/** Least squares over bounded parameters (outside the bounds: a large penalty). */
function fit(names: string[], x0: number[], lo: number[], hi: number[], residuals: (x: number[]) => Comparison[]): { x: number[]; rms: number } {
  const cost = (x: number[]) => {
    if (x.some((v, i) => v < lo[i]! || v > hi[i]!)) return 1e9
    const cs = residuals(x)
    const r = rms(cs)
    return Number.isFinite(r) ? r * r : 1e9
  }
  const { x } = nelderMead(cost, x0, x0.map((v) => Math.max(0.05 * Math.abs(v), 0.01)), { maxIter: 300, tol: 1e-9 })
  console.log(`- ${names.map((n, i) => `${n} = ${x[i]!.toPrecision(3)}`).join(", ")} (RMS ${f(rms(residuals(x)), 3)})`)
  return { x, rms: rms(residuals(x)) }
}

const setup = (p: BallParams, config: ModelConfig): Setup => ({ p, config, dim: "3d" })

console.log("### Comparisons (pooltool = pooltool's default parameters; fitted = MEASURED_BALL_PARAMS)")

{
  const by = cushionModels.flatMap((m) => [[`${m}, pooltool`, railAngles(setup(P, withCushion(m)))] as const, [`${m}, fitted`, railAngles(setup(M[m], withCushion(m)))] as const])
  table(`Rail rebound angle, immediate (pool; ${SOURCES.alciatoreB11.cite})`, "°", by.map(([m, r]) => [m, r.immediate]), 1)
  table("Rail rebound angle, effective (after the ball stops curving)", "°", by.map(([m, r]) => [m, r.effective]), 1)
}
table(
  `Rebound speed straight off a snooker cushion, rolling ball (m/s; ${SOURCES.mathavan2009.cite}; measured = their fitted curve)`,
  "m/s",
  cushionModels.flatMap((m) => [
    [`${m}, pooltool`, cushionRebound(setup(snooker(P), withCushion(m)))],
    [`${m}, fitted`, cushionRebound(setup(snooker(M[m]), withCushion(m)))],
  ]),
)
table(
  `Throw, stun shots (inches per yard; ${SOURCES.alciatoreB3.cite})`,
  "in/yd",
  ballModels.flatMap((m) => [
    [`${m}, pooltool`, throwInches(setup(P, withBall(m)))],
    [`${m}, fitted`, throwInches(setup(P, withBall(m, MC.ballBall.friction)))],
  ]),
)
table(
  `Speeds once rolling after a ball–ball hit (snooker; ${SOURCES.mathavan2009.cite}, Table I)`,
  "m/s",
  ballModels.map((m) => [m, ballBallSpeeds(setup(snooker(P), withBall(m)))]),
  3,
)

console.log("\n### Fits")
for (const m of cushionModels) {
  console.log(`\nPool cushion (${m}), to the rail angles (immediate and effective):`)
  fit(["e_c", "f_c"], [P.e_c, P.f_c], [0.3, 0.01], [1, 1], ([e_c, f_c]) => {
    const r = railAngles(setup({ ...P, e_c: e_c!, f_c: f_c! }, withCushion(m)))
    return [...r.immediate, ...r.effective]
  })
  console.log(`Pool cushion (${m}), to the effective angles only:`)
  fit(["e_c", "f_c"], [P.e_c, P.f_c], [0.3, 0.01], [1, 1], ([e_c, f_c]) => railAngles(setup({ ...P, e_c: e_c!, f_c: f_c! }, withCushion(m))).effective)
  console.log(`Snooker cushion (${m}), to the rebound speeds:`)
  fit(["e_c", "f_c"], [P.e_c, P.f_c], [0.3, 0.01], [1, 1], ([e_c, f_c]) => cushionRebound(setup(snooker({ ...P, e_c: e_c!, f_c: f_c! }), withCushion(m))))
}
console.log("\nThrow friction (frictional_inelastic), u_b = a + b·exp(−c·v_rel), to all 18 throws:")
fit(["a", "b", "c"], [C.ballBall.friction.a, C.ballBall.friction.b, C.ballBall.friction.c], [0, 0, 0], [1, 2, 20], ([a, b, c]) =>
  throwInches(setup(P, withBall("frictional_inelastic", { a: a!, b: b!, c: c! }))),
)
