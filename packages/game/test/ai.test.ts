import { MotionState, type BallState } from "@pixelpoolhall/physics"
import { describe, expect, it } from "vitest"
import { AI_LEVELS, bankCandidates, chooseOption, kickCandidates, planShot, pushCandidates, shotGeometry } from "../src/ai.ts"
import { createRng } from "../src/rng.ts"
import { Game } from "../src/session.ts"
import { CUE } from "../src/types.ts"

const R = 0.028575
const at = (x: number, y: number): BallState => ({ r: [x, y, R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary })

function setUp(discipline: "8-ball" | "9-ball", balls: Record<string, [number, number]>, groups: boolean = true) {
  const g = new Game({ discipline, seed: 3 })
  g.balls = new Map(Object.entries(balls).map(([id, [x, y]]) => [id, at(x, y)]))
  g.state = { ...g.state, isBreak: false, cueBallInHand: "none", groups: discipline === "8-ball" && groups ? ["solids", "stripes"] : null }
  return g
}

describe("computer opponent", () => {
  it("rates a short straight shot easy and a blocked one zero", () => {
    const g = setUp("9-ball", { cue: [1.0, 2.0], "1": [1.1, 2.2], "9": [0.3, 0.5] })
    const easy = shotGeometry(g, [1.0, 2.0], "1", "rt", g.balls)!
    expect(easy.ease).toBeGreaterThan(0.5)
    const blocked = setUp("9-ball", { cue: [1.0, 2.0], "2": [1.05, 2.1], "1": [1.1, 2.2], "9": [0.3, 0.5] })
    expect(shotGeometry(blocked, [1.0, 2.0], "1", "rt", blocked.balls)!.ease).toBe(0)
  })

  it("pots a 30° cut with its noiseless plan (aim corrected for throw)", () => {
    // Object ball 0.6 m from the foot-right corner; the cue ball set for a ~30° cut.
    const g = setUp("8-ball", { cue: [0.55, 1.45], "3": [0.85, 2.0], "8": [0.2, 0.4], "12": [0.25, 1.2] })
    const plan = planShot(g, { ...AI_LEVELS.hard, finalists: 0 }, createRng(1))
    expect(plan.kind).toBe("pot")
    expect(plan.call).toEqual({ ball: "3", pocket: plan.target!.pocket })
    const rec = g.shoot(plan.strike, { call: plan.call })
    expect(rec.facts.pocketed.map((p) => p.ball)).toContain("3")
    expect(rec.ruling.fouls).toEqual([])
    expect(g.state.shooter).toBe(0)
  })

  it("is deterministic for a given rng seed", () => {
    const mk = () => setUp("9-ball", { cue: [0.6, 0.8], "1": [0.9, 1.6], "2": [0.3, 2.1], "9": [1.0, 2.3] })
    const a = planShot(mk(), AI_LEVELS.medium, createRng(42))
    const b = planShot(mk(), AI_LEVELS.medium, createRng(42))
    expect(a).toEqual(b)
  })

  it("places the cue ball legally when it has ball in hand", () => {
    const g = setUp("9-ball", { "1": [0.9, 1.6], "5": [0.4, 2.0], "9": [1.0, 2.3] })
    g.state = { ...g.state, cueBallInHand: "table" }
    g.balls.set(CUE, at(0.6, 0.6))
    const plan = planShot(g, AI_LEVELS.hard, createRng(5))
    expect(plan.placement).not.toBeNull()
    expect(g.placementProblem(plan.placement!)).toBeNull()
    expect(plan.kind).toBe("pot")
  })

  it("answers pending decisions with one of the offered options", () => {
    const g = setUp("9-ball", { cue: [0.6, 0.8], "1": [0.9, 1.6], "9": [1.0, 2.3] })
    g.state = { ...g.state, shooter: 1, pending: { kind: "after_push_out", player: 1, options: ["shoot", "pass"] } }
    const o = chooseOption(g, AI_LEVELS.medium, createRng(1))
    expect(["shoot", "pass"]).toContain(o)
    expect(g.state.pending?.kind).toBe("after_push_out")
  })

  it("plays a full 9-ball rack against itself", () => {
    const g = new Game({ discipline: "9-ball", seed: 9 })
    const rng = createRng(9)
    for (let i = 0; i < 120 && g.state.winner === null; i++) {
      if (g.state.pending) {
        g.decide(chooseOption(g, AI_LEVELS.hard, rng))
        continue
      }
      const plan = planShot(g, AI_LEVELS.hard, rng)
      if (plan.placement) g.placeCueBall(plan.placement)
      g.shoot(plan.strike, { call: plan.call })
    }
    expect(g.state.winner).not.toBeNull()
  })

  const noiseless = { ...AI_LEVELS.hard, finalists: 0 }

  it("banks: a solved bank pockets the ball after a rail", () => {
    // The 1 straight up the table: banks off the foot rail back into the head corners.
    const g = setUp("9-ball", { cue: [0.63, 1.5], "1": [0.63, 2.2], "9": [1.1, 0.4] })
    const banks = bankCandidates(g, 0, noiseless, g.balls)
    expect(banks.length).toBeGreaterThan(0)
    const made = banks.filter((c) => {
      const p = g.preview(c.strike, {}, g.balls)
      const pocketed = p.facts.pocketed.find((x) => x.ball === "1")
      const railBefore = p.result.events.some(
        (e) => (e.type === "ball_linear_cushion" || e.type === "ball_circular_cushion") && e.ids[0] === "1" && (!pocketed || e.time < pocketed.time),
      )
      return pocketed?.pocket === c.target!.pocket && railBefore
    })
    expect(made.length).toBeGreaterThan(0)
  })

  it("combinations: plays the 1–9 combination to win when the 1 itself is blocked", () => {
    // Cue ball, 1 and 9 on the diagonal to the foot-right corner.
    const g = setUp("9-ball", { cue: [0.75, 2.02], "1": [0.95, 2.22], "9": [1.1, 2.37], "5": [0.3, 0.6] })
    const plan = planShot(g, noiseless, createRng(3))
    expect(plan.kind).toBe("combo")
    const rec = g.shoot(plan.strike, { call: plan.call })
    expect(rec.facts.firstContacts).toEqual(["1"])
    expect(g.state.winner).toBe(0)
  })

  it("kicks: escapes a snooker with legal contact", () => {
    // A wall of three balls between the cue ball and the 1.
    const g = setUp("9-ball", { cue: [0.3, 0.5], "1": [0.3, 2.0], "2": [0.22, 1.25], "3": [0.28, 1.25], "4": [0.34, 1.25], "9": [1.0, 2.3] })
    expect(shotGeometry(g, [0.3, 0.5], "1", "lt", g.balls)!.ease).toBe(0)
    const kicks = kickCandidates(g, 0, noiseless, g.balls)
    const legal = kicks.filter((c) => g.preview(c.strike, {}, g.balls).ruling.fouls.length === 0)
    expect(legal.length).toBeGreaterThan(0)
    const plan = planShot(g, noiseless, createRng(4))
    const rec = g.shoot(plan.strike, { call: plan.call, pushOut: plan.pushOut })
    expect(rec.ruling.fouls).toEqual([])
  })

  it("push outs: the best push leaves the choice to the opponent", () => {
    const g = setUp("9-ball", { cue: [0.3, 0.5], "1": [0.3, 2.0], "2": [0.22, 1.25], "3": [0.28, 1.25], "4": [0.34, 1.25], "9": [1.0, 2.3] })
    g.state = { ...g.state, pushOutAvailable: true }
    const pushes = pushCandidates(g, g.balls).sort((a, b) => b.value - a.value)
    expect(pushes[0]!.value).toBeLessThanOrEqual(0)
    const rec = g.shoot(pushes[0]!.strike, { pushOut: true })
    expect(rec.ruling.fouls).toEqual([])
    expect(g.state.pending?.kind).toBe("after_push_out")
  })
})
