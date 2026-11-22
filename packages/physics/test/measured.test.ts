/**
 * The physics against published measurements (test/measured/data.ts). These
 * hold the fitted parameters to what they were fitted for, and pin the
 * agreement we have elsewhere, so a model change that moves us away from
 * real balls fails here. `node test/measured-report.ts` prints the full
 * comparison and refits.
 */
import { describe, expect, it } from "vitest"
import { DEFAULT_BALL_PARAMS as P, DEFAULT_MODEL_CONFIG as C, MEASURED_BALL_PARAMS, MEASURED_MODEL_CONFIG, type ModelConfig } from "../src/params.ts"
import { CLOTH_FRICTION } from "./measured/data.ts"
import { ballBallSpeeds, cushionRebound, maxAbs, railAngles, rms, snooker, throwInches } from "./measured/residuals.ts"
import { inPerYd } from "./measured/experiments.ts"

const cushion = (model: "stronge" | "mathavan"): ModelConfig => ({ ...C, cushion: { ...C.cushion, model } })
const ballBall = (model: "frictional_inelastic" | "mathavan", base: ModelConfig = C): ModelConfig => ({ ...base, ballBall: { ...base.ballBall, model } })

describe("rail rebound angles (pool; Alciatore & Jewett, TP B.11)", () => {
  for (const model of ["stronge", "mathavan"] as const) {
    it(`${model}: with the fitted cushion, the angles once the ball stops curving are within 1° RMS (1.7° max)`, () => {
      const { effective } = railAngles({ p: MEASURED_BALL_PARAMS[model], config: cushion(model) })
      expect(rms(effective)).toBeLessThan(0.8)
      expect(maxAbs(effective)).toBeLessThan(1.7)
    })
  }

  it("the fit is better than pooltool's defaults for both models", () => {
    for (const model of ["stronge", "mathavan"] as const) {
      const fitted = rms(railAngles({ p: MEASURED_BALL_PARAMS[model], config: cushion(model) }).effective)
      const pooltool = rms(railAngles({ p: P, config: cushion(model) }).effective)
      expect(fitted, model).toBeLessThan(pooltool)
    }
  })
})

describe("cushion rebound speed (snooker; Mathavan 2009)", () => {
  it("stronge: the cushion fitted to pool angles also halves the error in snooker rebound speeds (an independent check)", () => {
    const fitted = rms(cushionRebound({ p: snooker(MEASURED_BALL_PARAMS.stronge), config: cushion("stronge") }))
    const pooltool = rms(cushionRebound({ p: snooker(P), config: cushion("stronge") }))
    expect(fitted).toBeLessThan(0.15)
    expect(fitted).toBeLessThan(pooltool / 1.9)
  })
})

describe("ball–ball (snooker; Mathavan 2009, Table I)", () => {
  it("speeds once both balls roll again are within 0.045 m/s RMS, for both models and both throw frictions", () => {
    for (const model of ["frictional_inelastic", "mathavan"] as const) for (const base of [C, MEASURED_MODEL_CONFIG]) {
      const cs = ballBallSpeeds({ p: snooker(P), config: ballBall(model, base) })
      // 0.036 with pooltool's throw friction, 0.041 with the fitted one.
      expect(rms(cs), model).toBeLessThan(0.045)
      // The worst is one shot whose cue ball the paper's own theory also misses by 12%.
      expect(maxAbs(cs), model).toBeLessThan(0.11)
    }
  })
})

describe("cloth (snooker; Mathavan 2009)", () => {
  it("sliding friction is within the measured range", () => {
    expect(P.u_s).toBeGreaterThanOrEqual(CLOTH_FRICTION.sliding[0])
    expect(P.u_s).toBeLessThanOrEqual(CLOTH_FRICTION.sliding[1])
  })
})

describe("throw (pool; Colenso, in Alciatore TP B.3)", () => {
  it("the fitted friction brings the 18 throws within 0.7 in/yd RMS (pooltool's: 1.8), for both models", () => {
    for (const model of ["frictional_inelastic", "mathavan"] as const) {
      expect(rms(throwInches({ p: P, config: ballBall(model, MEASURED_MODEL_CONFIG) })), model).toBeLessThan(0.7)
      expect(rms(throwInches({ p: P, config: ballBall(model) })), model).toBeGreaterThan(1.7)
    }
  })

  it("never exceeds the rigid-ball limit tan(throw) = 2 tan(cut) / (7 (1 + e_b)) on a stun shot, which the soft measurements do (a known gap)", () => {
    const cs = throwInches({ p: P, config: MEASURED_MODEL_CONFIG })
    for (const c of cs.filter((c) => c.label.endsWith(" 0% E"))) {
      const cut = Number.parseFloat(c.label)
      // The surfaces stop sliding: the object ball's sideways speed is v sin(cut) / 7, its speed along the line (1 + e_b) v cos(cut) / 2.
      const limit = inPerYd((Math.atan((2 * Math.tan((cut * Math.PI) / 180)) / (7 * (1 + P.e_b))) * 180) / Math.PI)
      // (Within 0.1%: the angle is of the whole path to rest, which the cloth bends very slightly.)
      expect(c.predicted).toBeLessThanOrEqual(limit * 1.001)
      if (c.label.includes("4 km/h")) expect(c.measured).toBeGreaterThan(limit)
    }
  })
})
