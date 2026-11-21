/**
 * Mathavan's ball–ball (2014) and ball–cushion (2010) models:
 * - the core solvers against the reference (pooltool's, with the zero-slip
 *   patches in tools/reference/mathavan_patched.py) on random inputs;
 * - well-conditioning: a change in the last bit of the input changes the
 *   result by about as much, not by a whole impulse step (the property the
 *   patches restore);
 * - convergence as the impulse steps shrink;
 * - in 3D, balls in the air fall back to the closed-form models.
 * Whole-shot comparisons are in engine.test.ts and resolve.test.ts.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { Vec3 } from "../src/math/vec3.ts"
import { MotionState, type BallState } from "../src/motion.ts"
import { DEFAULT_BALL_PARAMS, DEFAULT_MODEL_CONFIG, type ModelConfig } from "../src/params.ts"
import { resolveBallBall } from "../src/resolve/ball-ball.ts"
import { resolveLinearCushion } from "../src/resolve/cushion.ts"
import { mathavanBallBall, mathavanCushionLocal, type MathavanCushionOptions } from "../src/resolve/mathavan.ts"
import { buildPocketTable, POOLTOOL_7FT } from "../src/table-builder.ts"

interface Core {
  cushion: { input: number[]; rolling: boolean; output: number[] }[]
  ball_ball: {
    input: { r_i: Vec3; v_i: Vec3; w_i: Vec3; r_j: Vec3; v_j: Vec3; w_j: Vec3; R: number; M: number; u_s: number; u_b: number; e_b: number; iterations: number }
    rolling: boolean
    output: [Vec3, Vec3, Vec3, Vec3]
  }[]
}
const core = JSON.parse(readFileSync(new URL("./fixtures/mathavan-core.json", import.meta.url), "utf8")) as Core

const relErr = (a: number[], b: number[]) => {
  const scale = Math.max(1e-3, ...b.map(Math.abs))
  return Math.max(...a.map((x, i) => Math.abs(x - b[i]!))) / scale
}

const { m: M, R } = DEFAULT_BALL_PARAMS
const H = POOLTOOL_7FT.cushionHeight
const cushionOpts = (maxSteps = 1000, deltaP = 0.001): MathavanCushionOptions => ({
  e_c: DEFAULT_BALL_PARAMS.e_c, f_c: DEFAULT_BALL_PARAMS.f_c, u_s: DEFAULT_BALL_PARAMS.u_s, h: H, maxSteps, deltaP,
})
const local = (o: { vx: number; vy: number; wx: number; wy: number; wz: number }) => [o.vx, o.vy, o.wx, o.wy, o.wz]
const nextUp = (x: number) => x + Math.abs(x) * Number.EPSILON

describe("Mathavan core solvers vs reference", () => {
  it("cushion: 300 random impacts (a third rolling) within 1e-12", () => {
    let worst = 0
    for (const c of core.cushion) {
      const [m, r, h, e_c, u_s, f_c, vx, vy, wx, wy, wz, maxSteps, deltaP] = c.input as number[]
      expect([m, r]).toEqual([M, R])
      const out = mathavanCushionLocal(m!, r!, { e_c: e_c!, f_c: f_c!, u_s: u_s!, h: h!, maxSteps: maxSteps!, deltaP: deltaP! }, { vx: vx!, vy: vy!, wx: wx!, wy: wy!, wz: wz! })
      worst = Math.max(worst, relErr(local(out), c.output))
    }
    console.log(`cushion: worst relative error ${worst.toExponential(2)}`)
    expect(worst).toBeLessThan(1e-12)
  })

  it("ball-ball: 300 random collisions (a third rolling) within 1e-12", () => {
    let worst = 0
    for (const c of core.ball_ball) {
      const i = c.input
      const out = mathavanBallBall(i.r_i, i.v_i, i.w_i, i.r_j, i.v_j, i.w_j, i.R, i.M, { u_b: i.u_b, e_b: i.e_b, u_s1: i.u_s, u_s2: i.u_s, iterations: i.iterations })
      const got = [...out.v1.slice(0, 2), ...out.w1, ...out.v2.slice(0, 2), ...out.w2]
      const want = [...c.output[0].slice(0, 2), ...c.output[1], ...c.output[2].slice(0, 2), ...c.output[3]]
      worst = Math.max(worst, relErr(got, want))
    }
    console.log(`ball-ball: worst relative error ${worst.toExponential(2)}`)
    expect(worst).toBeLessThan(1e-12)
  })
})

describe("Mathavan models are well-conditioned", () => {
  // A rolling ball has zero slip on the cloth; unpatched, the direction of
  // the first step's cloth friction came from rounding noise.
  it("cushion: a rolling ball's rebound moves by ~1 ulp when its speed does", () => {
    for (const [vx, vy, wz] of [[0.46245654949, 0.5265283794737546, -39.2], [0, 1.2, 0], [0.3, 0.8, 15], [-0.7, 2.1, -5]] as const) {
      const rolling = (vy: number) => ({ vx, vy, wx: -vy / R, wy: vx / R, wz })
      const a = local(mathavanCushionLocal(M, R, cushionOpts(), rolling(vy)))
      const b = local(mathavanCushionLocal(M, R, cushionOpts(), rolling(nextUp(vy))))
      expect(relErr(a, b)).toBeLessThan(1e-12)
    }
  })

  // Straight-on with draw: the vertical slip between the balls sticks at
  // zero; unpatched, it chattered across zero and the object ball left with a
  // sideways speed (~1e-4 m/s) whose sign came from rounding noise.
  it("ball-ball: a straight draw shot sends the object ball straight", () => {
    const r_i: Vec3 = [0.5, 0.5, R]
    const r_j: Vec3 = [0.5, 0.5 + 2 * R + 1e-6, R]
    for (const noise of [0, 1e-16, -1e-16, 3e-15]) {
      const out = mathavanBallBall(r_i, [noise, 4.4, 0], [-16.6, 0, 0], r_j, [0, 0, 0], [0, 0, 0], R, M, {
        u_b: 0.011, e_b: 0.95, u_s1: 0.2, u_s2: 0.2, iterations: 1000,
      })
      expect(Math.abs(out.v2[0])).toBeLessThan(1e-12)
      expect(Math.abs(out.v1[0])).toBeLessThan(1e-12)
    }
  })

  // Unpatched, a frictionless collision ended exactly on the stopping
  // threshold, so rounding chose whether it took one more step (+0.2% rebound).
  it("ball-ball: head-on without friction gives the restitution exactly", () => {
    for (const v of [0.5, 1, 2.345, 7]) {
      const out = mathavanBallBall([0, 0, R], [0, v, 0], [0, 0, 0], [0, 2 * R, R], [0, 0, 0], [0, 0, 0], R, M, {
        u_b: 0, e_b: 0.95, u_s1: 0.2, u_s2: 0.2, iterations: 1000,
      })
      // Energetic restitution without friction equals Newton's: v_rel' = e v_rel.
      expect((out.v2[1] - out.v1[1]) / v).toBeCloseTo(0.95, 6)
      expect(out.v1[1] + out.v2[1]).toBeCloseTo(v, 12)
    }
  })
})

describe("Mathavan models converge as the steps shrink", () => {
  const close = (a: number[], b: number[]) => relErr(a, b)
  it("cushion: halving the step halves the error", () => {
    const s0 = { vx: 0.6, vy: 1.5, wx: 20, wy: -10, wz: 30 }
    const run = (k: number) => local(mathavanCushionLocal(M, R, cushionOpts(1000 * k, 0.001 / k), s0))
    const fine = run(64)
    const e1 = close(run(1), fine)
    const e2 = close(run(2), fine)
    const e4 = close(run(4), fine)
    expect(e2).toBeLessThan(0.7 * e1)
    expect(e4).toBeLessThan(0.7 * e2)
  })

  it("ball-ball: the default 1000 steps is within 0.5% of the converged result", () => {
    const run = (iterations: number) => {
      const r_j: Vec3 = [0.03, Math.sqrt((2 * R) ** 2 - 0.03 ** 2), R]
      const o = mathavanBallBall([0, 0, R], [0.8, 2.5, 0], [-40, 25, 12], r_j, [0, 0, 0], [0, 0, 0], R, M, {
        u_b: 0.05, e_b: 0.95, u_s1: 0.2, u_s2: 0.2, iterations,
      })
      return [...o.v1, ...o.w1, ...o.v2, ...o.w2]
    }
    const fine = run(64000)
    expect(close(run(1000), fine)).toBeLessThan(5e-3)
    expect(close(run(8000), fine)).toBeLessThan(close(run(1000), fine))
  })
})

describe("Mathavan models in 3D", () => {
  const config: ModelConfig = {
    ...DEFAULT_MODEL_CONFIG,
    ballBall: { ...DEFAULT_MODEL_CONFIG.ballBall, model: "mathavan" },
    cushion: { ...DEFAULT_MODEL_CONFIG.cushion, model: "mathavan" },
  }
  const rail = buildPocketTable(POOLTOOL_7FT).linear.find((c) => c.id === "3")!
  const p = DEFAULT_BALL_PARAMS

  it("a ball on the cloth uses Mathavan's cushion model; one in the air uses Stronge's", () => {
    const at = (z: number, vz: number, s: BallState["s"]): BallState => ({ r: [R + rail.noseRadius + 1e-6, 0.5, z], v: [-1, 0.2, vz], w: [0, 0, 0], s })
    const onCloth = at(R, 0, MotionState.sliding)
    const strongeOut = resolveLinearCushion(onCloth, rail, p, DEFAULT_MODEL_CONFIG.cushion, true)
    const mathavanOut = resolveLinearCushion(onCloth, rail, p, config.cushion, true)
    expect(mathavanOut.v).not.toEqual(strongeOut.v)
    expect(mathavanOut.v[2]).toBe(0)
    const flying = at(R + 0.01, 0.5, MotionState.airborne)
    expect(resolveLinearCushion(flying, rail, p, config.cushion, true)).toEqual(resolveLinearCushion(flying, rail, p, DEFAULT_MODEL_CONFIG.cushion, true))
  })

  it("two balls on the cloth use Mathavan's ball-ball model; if either is in the air, the closed form", () => {
    const b1: BallState = { r: [0.5, 0.5, R], v: [0, 2, 0], w: [-30, 0, 0], s: MotionState.sliding }
    const b2: BallState = { r: [0.51, 0.5 + Math.sqrt((2 * R) ** 2 - 0.01 ** 2), R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary }
    const closed = resolveBallBall(b1, b2, p, p, DEFAULT_MODEL_CONFIG.ballBall, true)
    expect(resolveBallBall(b1, b2, p, p, config.ballBall, true)[1].v).not.toEqual(closed[1].v)
    const up = { ...b1, r: [0.5, 0.5, R + 0.002] as Vec3, v: [0, 2, -0.5] as Vec3, s: MotionState.airborne }
    expect(resolveBallBall(up, b2, p, p, config.ballBall, true)).toEqual(resolveBallBall(up, b2, p, p, DEFAULT_MODEL_CONFIG.ballBall, true))
  })
})
