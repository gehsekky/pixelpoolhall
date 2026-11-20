import { describe, expect, it } from "vitest"
import { decide, judge, newRack } from "../src/rules/index.ts"
import type { GameState, ShotFacts, ShotInput } from "../src/types.ts"

const ALL15 = Array.from({ length: 15 }, (_, i) => String(i + 1))
const ALL9 = Array.from({ length: 9 }, (_, i) => String(i + 1))

/** Facts for a plain shot; override what matters. */
function facts(o: Partial<ShotFacts> & { pockets?: [string, string][] } = {}): ShotFacts {
  const { pockets = [], ...rest } = o
  return {
    firstContacts: [],
    firstContactTime: Infinity,
    pocketed: pockets.map(([ball, pocket], i) => ({ ball, pocket, time: i + 1 })),
    offTable: [],
    railAfterContact: false,
    objectBallsToRail: [],
    cueCrossedHeadStringBeforeContact: true,
    cueCrossedHeadString: true,
    firstContactAboveHeadString: false,
    objectBallsCrossedHeadString: [],
    ...rest,
  }
}

const hit = (ball: string, o: Partial<ShotFacts> & { pockets?: [string, string][] } = {}) =>
  facts({ firstContacts: [ball], firstContactTime: 0.5, railAfterContact: true, ...o })

const shot = (f: ShotFacts, onTable: string[], extra: Partial<ShotInput> = {}): ShotInput => ({
  facts: f,
  onTable: new Set(onTable),
  ...extra,
})

/** An 8-ball state after a legal break, open table, player 0 to shoot. */
const open8 = (): GameState => ({ ...newRack("8-ball", 0), isBreak: false, cueBallInHand: "none" })
const assigned8 = (): GameState => ({ ...open8(), groups: ["solids", "stripes"] })

describe("8-ball break (WPA 4.3)", () => {
  const s = newRack("8-ball", 0)

  it("pocketing a ball keeps the breaker at the table with the table open", () => {
    const r = judge(s, shot(hit("1", { pockets: [["3", "lt"]] }), ALL15))
    expect(r.fouls).toEqual([])
    expect(r.state.shooter).toBe(0)
    expect(r.state.groups).toBeNull()
    expect(r.state.isBreak).toBe(false)
  })

  it("four balls to a rail with nothing pocketed is legal; the turn passes", () => {
    const r = judge(s, shot(hit("1", { objectBallsToRail: ["1", "2", "3", "4"] }), ALL15))
    expect(r.state.shooter).toBe(1)
    expect(r.state.pending).toBeNull()
  })

  it("fewer than four to a rail with nothing pocketed is an illegal break with three options (4.3(d))", () => {
    const r = judge(s, shot(hit("1", { objectBallsToRail: ["1", "2", "3"] }), ALL15))
    expect(r.fouls).toEqual([])
    expect(r.state.pending).toEqual({ kind: "illegal_break", player: 1, options: ["accept_table", "rerack_and_break", "rerack_opponent_breaks"] })
    const a = decide(r.state, "accept_table")
    expect(a.state.shooter).toBe(1)
    expect(a.state.cueBallInHand).toBe("none")
    const b = decide(r.state, "rerack_and_break")
    expect(b.rerack).toBe(true)
    expect(b.state.breaker).toBe(1)
    expect(b.state.isBreak).toBe(true)
    const c = decide(r.state, "rerack_opponent_breaks")
    expect(c.state.breaker).toBe(0)
  })

  it("the 8 on a legal break lets the breaker spot it and continue, or re-break (4.3(e))", () => {
    const r = judge(s, shot(hit("1", { pockets: [["8", "rt"]] }), ALL15))
    expect(r.state.winner).toBeNull()
    expect(r.state.pending?.kind).toBe("eight_on_break")
    expect(r.state.pending?.player).toBe(0)
    const sp = decide(r.state, "spot_eight")
    expect(sp.spot).toEqual(["8"])
    expect(sp.state.shooter).toBe(0)
    expect(sp.state.cueBallInHand).toBe("none")
    expect(decide(r.state, "rerack_and_break").state.breaker).toBe(0)
  })

  it("the 8 on a foul break: the opponent spots it and shoots from the kitchen, or re-breaks (4.3(f))", () => {
    const r = judge(s, shot(hit("1", { pockets: [["8", "rt"], ["cue", "lb"]] }), ALL15))
    expect(r.fouls).toEqual(["cue_ball_scratch"])
    expect(r.state.pending?.kind).toBe("eight_on_break_foul")
    expect(r.state.pending?.player).toBe(1)
    const sp = decide(r.state, "spot_eight")
    expect(sp.spot).toEqual(["8"])
    expect(sp.state.shooter).toBe(1)
    expect(sp.state.cueBallInHand).toBe("kitchen")
    expect(decide(r.state, "rerack_and_break").state.breaker).toBe(1)
  })

  it("a scratch on the break gives cue ball in hand above the head string (4.3(h))", () => {
    const r = judge(s, shot(hit("1", { pockets: [["2", "lt"], ["cue", "lb"]] }), ALL15))
    expect(r.state.shooter).toBe(1)
    expect(r.state.cueBallInHand).toBe("kitchen")
    expect(r.state.groups).toBeNull()
  })

  it("an object ball off the table on the break: accept or kitchen; the 8 is spotted (4.3(g))", () => {
    const r = judge(s, shot(hit("1", { offTable: ["8"], objectBallsToRail: ["1", "2", "3", "4"] }), ALL15))
    expect(r.fouls).toEqual(["ball_off_table"])
    expect(r.spot).toEqual(["8"])
    expect(r.state.pending).toEqual({ kind: "break_foul", player: 1, options: ["accept_table", "cue_ball_in_kitchen"] })
    expect(decide(r.state, "cue_ball_in_kitchen").state.cueBallInHand).toBe("kitchen")
  })
})

describe("8-ball play (WPA 4.4–4.9)", () => {
  it("open table: the 8 may not be hit first (4.4)", () => {
    const r = judge(open8(), shot(hit("8"), ALL15, { call: { ball: "3", pocket: "lt" } }))
    expect(r.fouls).toEqual(["wrong_ball_first"])
    expect(r.state.cueBallInHand).toBe("table")
    expect(r.state.shooter).toBe(1)
  })

  it("open table: any ball may be hit first, and a legally pocketed called ball sets the groups (4.4)", () => {
    const r = judge(open8(), shot(hit("12", { pockets: [["3", "lt"]] }), ALL15, { call: { ball: "3", pocket: "lt" } }))
    expect(r.fouls).toEqual([])
    expect(r.state.groups).toEqual(["solids", "stripes"])
    expect(r.state.shooter).toBe(0)
  })

  it("player 1 pocketing a stripe on an open table takes stripes", () => {
    const s: GameState = { ...open8(), shooter: 1 }
    const r = judge(s, shot(hit("10", { pockets: [["10", "lc"]] }), ALL15, { call: { ball: "10", pocket: "lc" } }))
    expect(r.state.groups).toEqual(["solids", "stripes"])
    expect(r.state.shooter).toBe(1)
  })

  it("a called ball in the wrong pocket doesn't assign groups or continue the turn", () => {
    const r = judge(open8(), shot(hit("3", { pockets: [["3", "rt"]] }), ALL15, { call: { ball: "3", pocket: "lt" } }))
    expect(r.fouls).toEqual([])
    expect(r.state.groups).toBeNull()
    expect(r.state.shooter).toBe(1)
  })

  it("hitting the opponent's group first is a foul (3.2)", () => {
    const r = judge(assigned8(), shot(hit("11"), ALL15, { call: { ball: "2", pocket: "lt" } }))
    expect(r.fouls).toEqual(["wrong_ball_first"])
  })

  it("a legal ball hit simultaneously with an illegal one counts as first (3.2)", () => {
    const r = judge(assigned8(), shot(hit("11", { firstContacts: ["11", "2"] }), ALL15, { call: { ball: "2", pocket: "lt" } }))
    expect(r.fouls).toEqual([])
  })

  it("no rail after contact and nothing pocketed is a foul (3.3)", () => {
    const r = judge(assigned8(), shot(hit("2", { railAfterContact: false }), ALL15, { call: { ball: "2", pocket: "lt" } }))
    expect(r.fouls).toEqual(["no_rail"])
  })

  it("missing everything is a foul", () => {
    expect(judge(assigned8(), shot(facts(), ALL15)).fouls).toEqual(["no_contact"])
  })

  it("a safety passes the turn and keeps pocketed balls down (4.6)", () => {
    const r = judge(assigned8(), shot(hit("2", { pockets: [["2", "lt"]] }), ALL15, { call: "safety" }))
    expect(r.fouls).toEqual([])
    expect(r.state.shooter).toBe(1)
    expect(r.spot).toEqual([])
  })

  it("pocketing the 8 before the group is cleared loses (4.8(b))", () => {
    const r = judge(assigned8(), shot(hit("2", { pockets: [["8", "lt"]] }), ALL15, { call: { ball: "2", pocket: "lt" } }))
    expect(r.state.winner).toBe(1)
  })

  it("pocketing the 8 together with the last group ball still loses: the group wasn't cleared first", () => {
    const onTable = ["7", "8", "9"]
    const r = judge(assigned8(), shot(hit("7", { pockets: [["7", "lt"], ["8", "rt"]] }), onTable, { call: { ball: "7", pocket: "lt" } }))
    expect(r.state.winner).toBe(1)
  })

  it("the 8 in the called pocket after clearing the group wins", () => {
    const r = judge(assigned8(), shot(hit("8", { pockets: [["8", "rt"]] }), ["8", "9"], { call: { ball: "8", pocket: "rt" } }))
    expect(r.state.winner).toBe(0)
  })

  it("the 8 in an uncalled pocket loses (4.8(c))", () => {
    const r = judge(assigned8(), shot(hit("8", { pockets: [["8", "lt"]] }), ["8", "9"], { call: { ball: "8", pocket: "rt" } }))
    expect(r.state.winner).toBe(1)
  })

  it("the 8 pocketed on a foul loses (4.8(a))", () => {
    const r = judge(assigned8(), shot(hit("8", { pockets: [["8", "rt"], ["cue", "lb"]] }), ["8", "9"], { call: { ball: "8", pocket: "rt" } }))
    expect(r.state.winner).toBe(1)
  })

  it("open table with a group cleared: the 8 may be played (4.4)", () => {
    const r = judge(open8(), shot(hit("8", { pockets: [["8", "rt"]] }), ["8", "9", "10"], { call: { ball: "8", pocket: "rt" } }))
    expect(r.fouls).toEqual([])
    expect(r.state.winner).toBe(0)
  })

  it("from the kitchen, a first contact above the head string is a foul unless the cue ball crossed first (3.11)", () => {
    const s: GameState = { ...assigned8(), cueBallInHand: "kitchen" }
    const bad = hit("2", { firstContactAboveHeadString: true, cueCrossedHeadStringBeforeContact: false })
    expect(judge(s, shot(bad, ALL15, { call: { ball: "2", pocket: "lt" } })).fouls).toContain("bad_play_from_kitchen")
    const ok = hit("2", { firstContactAboveHeadString: true, cueCrossedHeadStringBeforeContact: true })
    expect(judge(s, shot(ok, ALL15, { call: { ball: "2", pocket: "lt" } })).fouls).toEqual([])
  })
})

describe("9-ball (WPA 5, Regulation 16)", () => {
  const s = newRack("9-ball", 0)
  const crossed = ["2", "3", "4"]

  it("a break with nothing pocketed and fewer than four balls to a rail is a foul (5.3(b))", () => {
    const r = judge(s, shot(hit("1", { objectBallsToRail: ["1", "2"] }), ALL9))
    expect(r.fouls).toEqual(["illegal_break"])
    expect(r.state.cueBallInHand).toBe("table")
    expect(r.state.pushOutAvailable).toBe(false)
  })

  it("the 9 on a legal break wins", () => {
    const r = judge(s, shot(hit("1", { pockets: [["9", "lc"]], objectBallsCrossedHeadString: crossed }), ALL9))
    expect(r.state.winner).toBe(0)
  })

  it("the 9 on a foul break is spotted (5.6)", () => {
    const r = judge(s, shot(hit("1", { pockets: [["9", "lc"], ["cue", "rb"]] }), ALL9))
    expect(r.spot).toEqual(["9"])
    expect(r.state.winner).toBeNull()
  })

  it("three-ball rule: the incoming player may accept (no push out) or pass back (breaker may push) (Reg. 16)", () => {
    const r = judge(s, shot(hit("1", { pockets: [["5", "lt"]], objectBallsCrossedHeadString: ["2"] }), ALL9))
    expect(r.state.pending).toEqual({ kind: "three_ball_rule", player: 1, options: ["accept_table", "pass"] })
    const a = decide(r.state, "accept_table")
    expect(a.state.shooter).toBe(1)
    expect(a.state.pushOutAvailable).toBe(false)
    const p = decide(r.state, "pass")
    expect(p.state.shooter).toBe(0)
    expect(p.state.pushOutAvailable).toBe(true)
  })

  it("three-ball rule: a 9 pocketed on such a break is spotted, not a win (Reg. 16(5))", () => {
    const r = judge(s, shot(hit("1", { pockets: [["9", "lt"]] }), ALL9))
    expect(r.state.winner).toBeNull()
    expect(r.spot).toEqual(["9"])
  })

  it("the three-ball rule can be turned off", () => {
    const r = judge(newRack("9-ball", 0, { threeBallRule: false }), shot(hit("1", { pockets: [["5", "lt"]] }), ALL9))
    expect(r.state.pending).toBeNull()
    expect(r.state.shooter).toBe(0)
    expect(r.state.pushOutAvailable).toBe(true)
  })

  const after: GameState = { ...newRack("9-ball", 0), isBreak: false, cueBallInHand: "none", shooter: 1, pushOutAvailable: true }

  it("push out: wrong ball first and no rail are suspended; the opponent chooses (5.4)", () => {
    const r = judge(after, shot(facts(), ["1", "2", "9"], { pushOut: true }))
    expect(r.fouls).toEqual([])
    expect(r.state.pending).toEqual({ kind: "after_push_out", player: 0, options: ["shoot", "pass"] })
    expect(decide(r.state, "shoot").state.shooter).toBe(0)
    const back = decide(r.state, "pass")
    expect(back.state.shooter).toBe(1)
    expect(back.state.pushOutAvailable).toBe(false)
  })

  it("a scratch on a push out is still a foul", () => {
    const r = judge(after, shot(facts({ pockets: [["cue", "lt"]] }), ["1", "2", "9"], { pushOut: true }))
    expect(r.fouls).toEqual(["cue_ball_scratch"])
  })

  it("the 9 pocketed on a push out is spotted", () => {
    const r = judge(after, shot(hit("9", { pockets: [["9", "lt"]] }), ["1", "9"], { pushOut: true }))
    expect(r.state.winner).toBeNull()
    expect(r.spot).toEqual(["9"])
  })

  it("a push out is only allowed right after the break", () => {
    expect(() => judge({ ...after, pushOutAvailable: false }, shot(facts(), ["1"], { pushOut: true }))).toThrow()
  })

  const play: GameState = { ...after, pushOutAvailable: false }

  it("the lowest ball must be hit first (3.2)", () => {
    expect(judge(play, shot(hit("2"), ["1", "2", "9"])).fouls).toEqual(["wrong_ball_first"])
  })

  it("a combination on the 9 wins", () => {
    const r = judge(play, shot(hit("1", { pockets: [["9", "rc"]] }), ["1", "2", "9"]))
    expect(r.state.winner).toBe(1)
  })

  it("the 9 pocketed on a foul is spotted; others stay down (5.6)", () => {
    const r = judge(play, shot(hit("2", { pockets: [["9", "rc"], ["3", "lt"]] }), ["1", "2", "3", "9"]))
    expect(r.spot).toEqual(["9"])
  })

  it("any ball legally pocketed continues the turn (5.5)", () => {
    const r = judge(play, shot(hit("1", { pockets: [["4", "lt"]] }), ["1", "4", "9"]))
    expect(r.state.shooter).toBe(1)
  })

  it("three consecutive fouls lose the rack; a legal shot resets the count (3.13)", () => {
    let st: GameState = play
    const foul = () => shot(facts(), ["1", "9"])
    st = judge(st, foul()).state // player 1 foul 1
    st = { ...judge({ ...st, shooter: 1 }, foul()).state } // foul 2
    expect(st.consecutiveFouls[1]).toBe(2)
    const third = judge({ ...st, shooter: 1 }, foul())
    expect(third.state.winner).toBe(0)
    const legal = judge({ ...st, shooter: 1 }, shot(hit("1"), ["1", "9"]))
    expect(legal.state.consecutiveFouls[1]).toBe(0)
  })
})
