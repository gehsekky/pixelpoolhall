import { MotionState, type BallState } from "@pixelpoolhall/physics"
import { describe, expect, it } from "vitest"
import { Game } from "../src/session.ts"
import { CUE } from "../src/types.ts"

const R = 0.028575
const at = (x: number, y: number): BallState => ({ r: [x, y, R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary })
const aim = (from: BallState, to: [number, number]) => (Math.atan2(to[1] - from.r[1], to[0] - from.r[0]) * 180) / Math.PI

/** A game past the break with the given balls, player 0 to shoot. */
function setUp(discipline: "8-ball" | "9-ball", balls: Record<string, [number, number]>) {
  const g = new Game({ discipline, seed: 3 })
  g.balls = new Map(Object.entries(balls).map(([id, [x, y]]) => [id, at(x, y)]))
  g.state = { ...g.state, isBreak: false, cueBallInHand: "none", groups: discipline === "8-ball" ? ["solids", "stripes"] : null }
  return g
}

describe("game session", () => {
  it("a straight shot into the foot-right corner: called ball pocketed, shooter continues", () => {
    const g = setUp("8-ball", { cue: [0.8, 1.9], "3": [1.07, 2.34], "11": [0.3, 0.5], "8": [0.6, 1.2] })
    const w = g.spec.w
    const l = g.spec.l
    // Aim through the object ball at the corner.
    const obj = g.balls.get("3")!
    const dir = Math.atan2(l - obj.r[1], w - obj.r[0])
    const ghost: [number, number] = [obj.r[0] - 2 * R * Math.cos(dir), obj.r[1] - 2 * R * Math.sin(dir)]
    const phi = aim(g.balls.get(CUE)!, ghost)
    const rec = g.shoot({ V0: 1.5, phi, theta: 0, a: 0, b: 0 }, { call: { ball: "3", pocket: "rt" } })
    expect(rec.facts.firstContacts).toEqual(["3"])
    expect(rec.facts.pocketed.map((p) => [p.ball, p.pocket])).toEqual([["3", "rt"]])
    expect(rec.ruling.fouls).toEqual([])
    expect(g.state.shooter).toBe(0)
    expect(g.balls.has("3")).toBe(false)
  })

  it("missing every ball is a foul: ball in hand anywhere for the opponent", () => {
    const g = setUp("9-ball", { cue: [0.3, 1.2], "1": [1.0, 2.2], "9": [1.1, 0.3] })
    const rec = g.shoot({ V0: 1.0, phi: 90, theta: 0, a: 0, b: 0 })
    expect(rec.facts.firstContacts).toEqual([])
    expect(rec.ruling.fouls).toEqual(["no_contact"])
    expect(g.state.shooter).toBe(1)
    expect(g.state.cueBallInHand).toBe("table")
    // The cue ball stays where it stopped (still a legal spot), and can be moved.
    expect(g.placementProblem([0.6, 1.2])).toBeNull()
    g.placeCueBall([0.6, 1.2])
    expect(g.balls.get(CUE)!.r.slice(0, 2)).toEqual([0.6, 1.2])
  })

  it("a scratch removes the cue ball and gives the opponent ball in hand with the cue ball placed legally", () => {
    const g = setUp("9-ball", { cue: [0.8, 1.9], "1": [0.4, 0.5], "9": [0.6, 1.0] })
    // Straight into the foot-right corner pocket.
    const cue = g.balls.get(CUE)!
    const phi = aim(cue, [g.spec.w, g.spec.l])
    const rec = g.shoot({ V0: 2, phi, theta: 0, a: 0, b: 0 })
    expect(rec.facts.pocketed.map((p) => p.ball)).toEqual([CUE])
    expect(rec.ruling.fouls).toContain("cue_ball_scratch")
    expect(g.state.cueBallInHand).toBe("table")
    const c = g.balls.get(CUE)!
    expect(g.placementProblem([c.r[0], c.r[1]])).toBeNull()
  })

  it("a 9 pocketed on a foul is spotted on the foot spot", () => {
    // Cue ball hits the 9 (not the lowest ball) straight into the foot-right corner.
    const g = setUp("9-ball", { cue: [0.8, 1.9], "9": [1.07, 2.34], "1": [0.3, 0.5] })
    const obj = g.balls.get("9")!
    const dir = Math.atan2(g.spec.l - obj.r[1], g.spec.w - obj.r[0])
    const ghost: [number, number] = [obj.r[0] - 2 * R * Math.cos(dir), obj.r[1] - 2 * R * Math.sin(dir)]
    const rec = g.shoot({ V0: 1.5, phi: aim(g.balls.get(CUE)!, ghost), theta: 0, a: 0, b: 0 })
    expect(rec.ruling.fouls).toEqual(["wrong_ball_first"])
    expect(rec.ruling.spot).toEqual(["9"])
    const nine = g.balls.get("9")!
    expect(nine.r[0]).toBe(g.layout.footSpot[0])
    expect(nine.r[1]).toBe(g.layout.footSpot[1])
  })

  it("from the kitchen, the cue ball must cross the head string before hitting a ball above it (WPA 3.11)", () => {
    const g = setUp("8-ball", { cue: [0.4, 0.3], "2": [0.9, 0.3], "8": [0.6, 1.5], "12": [0.3, 2.0] })
    g.state = { ...g.state, cueBallInHand: "kitchen" }
    const rec = g.shoot({ V0: 1.2, phi: 0, theta: 0, a: 0, b: 0 }, { call: { ball: "2", pocket: "rb" } })
    expect(rec.facts.firstContacts).toEqual(["2"])
    expect(rec.facts.firstContactAboveHeadString).toBe(true)
    expect(rec.facts.cueCrossedHeadStringBeforeContact).toBe(false)
    expect(rec.ruling.fouls).toContain("bad_play_from_kitchen")
  })

  it("breaks are deterministic from the seed and produce a ruling", () => {
    const run = (seed: number) => {
      const g = new Game({ discipline: "9-ball", seed })
      const cue = g.balls.get(CUE)!
      const rec = g.shoot({ V0: 8, phi: aim(cue, g.layout.footSpot) + 0.3, theta: 0, a: 0, b: 0.1 })
      return { facts: rec.facts, notes: rec.ruling.notes, events: rec.result.events.length }
    }
    const a = run(11)
    expect(run(11)).toEqual(a)
    expect(a.facts.firstContacts).toEqual(["1"])
    expect(a.facts.objectBallsToRail.length).toBeGreaterThanOrEqual(4)
    expect(a.notes.length).toBeGreaterThan(0)
  })

  it("plays a whole 9-ball rack to completion with naive shots", () => {
    // Always hit the lowest ball full in the face at medium speed; take ball in hand where it lies.
    const g = new Game({ discipline: "9-ball", seed: 5 })
    for (let i = 0; i < 400 && g.state.winner === null; i++) {
      if (g.state.pending) {
        g.decide(g.state.pending.options[0]!)
        continue
      }
      const cue = g.balls.get(CUE)!
      const target = g.state.isBreak ? g.balls.get("1")! : g.balls.get([...g.objectBalls()].sort((x, y) => +x - +y)[0]!)!
      g.shoot({ V0: g.state.isBreak ? 8 : 2.5, phi: aim(cue, [target.r[0], target.r[1]]), theta: 0, a: 0, b: 0 })
    }
    expect(g.state.winner).not.toBeNull()
    g.nextRack()
    expect(g.score[0] + g.score[1]).toBe(1)
    expect(g.state.breaker).toBe(1)
    expect(g.balls.size).toBe(10)
  })
})
