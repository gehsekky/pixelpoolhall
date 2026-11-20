/**
 * 8-ball, WPA Rules of Play section 4 (effective 2026-10-21).
 * Not modeled: fouls that need a human at the table (3.4 foot on floor, 3.6
 * touched ball, 3.7 double hit, 3.8 push shot, 3.9 balls still moving, 3.12
 * playing out of turn, 3.14 slow play, 3.15 rack template), the 1.6 request
 * to spot a ball above the head string, and stalemate (4.11).
 */
import { other, type Call, type Foul, type GameState, type Group, type Player, type Ruling, type ShotInput } from "../types.ts"
import { contactFouls, cueBallFouls, FOUL_TEXT, kitchenFouls, objectOffTable, objectPocketed } from "./common.ts"

export const SOLIDS = ["1", "2", "3", "4", "5", "6", "7"] as const
export const STRIPES = ["9", "10", "11", "12", "13", "14", "15"] as const
export const EIGHT = "8"

export function groupOf(ball: string): Group | null {
  const n = Number(ball)
  if (n >= 1 && n <= 7) return "solids"
  if (n >= 9 && n <= 15) return "stripes"
  return null
}

const groupBalls = (g: Group): readonly string[] => (g === "solids" ? SOLIDS : STRIPES)

/** Balls the shooter may legally contact first (and call), given the balls on the table. */
export function legalTargets(s: GameState, player: Player, onTable: ReadonlySet<string>): Set<string> {
  if (s.groups) {
    const mine = groupBalls(s.groups[player]).filter((b) => onTable.has(b))
    return new Set(mine.length > 0 ? mine : [EIGHT])
  }
  // Open table (4.4): any ball but the 8, unless a group is already cleared,
  // in which case the shooter may claim it and play the 8.
  const out = new Set([...onTable].filter((b) => b !== EIGHT))
  const cleared = (g: Group) => groupBalls(g).every((b) => !onTable.has(b))
  if (onTable.has(EIGHT) && (cleared("solids") || cleared("stripes"))) out.add(EIGHT)
  return out
}

function judgeBreak(s: GameState, shot: ShotInput): Ruling {
  const f = shot.facts
  const breaker = s.shooter
  const opp = other(breaker)
  const pocketed = objectPocketed(f)
  const offTable = objectOffTable(f)
  const eightDown = pocketed.includes(EIGHT)
  const fouls: Foul[] = [...cueBallFouls(f)]
  if (offTable.length > 0) fouls.push("ball_off_table")
  const base: GameState = { ...s, isBreak: false, groups: null, cueBallInHand: "none", pending: null }
  const notes = fouls.map((x) => FOUL_TEXT[x])
  const spot: string[] = []
  const scratched = fouls.includes("cue_ball_scratch") || fouls.includes("cue_ball_off_table")

  if (eightDown && fouls.length > 0) {
    notes.push("8-ball pocketed on a foul break: the opponent may spot the 8 and take cue ball in hand above the head string, or re-break (WPA 4.3(f)).")
    return {
      state: { ...base, shooter: opp, pending: { kind: "eight_on_break_foul", player: opp, options: ["spot_eight", "rerack_and_break"] } },
      fouls, spot, rerack: false, notes,
    }
  }
  if (fouls.length > 0) {
    // 4.3(g)/(h). The 8 driven off the table is spotted (4.3(g), 4.7). With
    // the cue ball gone, "accept the table" isn't possible; only ball in hand remains.
    if (offTable.includes(EIGHT)) spot.push(EIGHT)
    if (scratched) {
      notes.push("Break foul: the opponent has cue ball in hand above the head string (WPA 4.3(h)).")
      return { state: { ...base, shooter: opp, cueBallInHand: "kitchen" }, fouls, spot, rerack: false, notes }
    }
    notes.push("Break foul: the opponent may accept the table or take cue ball in hand above the head string (WPA 4.3(g)).")
    return {
      state: { ...base, shooter: opp, pending: { kind: "break_foul", player: opp, options: ["accept_table", "cue_ball_in_kitchen"] } },
      fouls, spot, rerack: false, notes,
    }
  }
  if (eightDown) {
    notes.push("8-ball pocketed on a legal break: the breaker may spot the 8 and continue, or re-break (WPA 4.3(e)).")
    return {
      state: { ...base, shooter: breaker, pending: { kind: "eight_on_break", player: breaker, options: ["spot_eight", "rerack_and_break"] } },
      fouls, spot, rerack: false, notes,
    }
  }
  if (pocketed.length === 0 && f.objectBallsToRail.length < 4) {
    notes.push(
      `Illegal break: nothing pocketed and only ${f.objectBallsToRail.length} ball(s) driven to a rail. ` +
        "The opponent may accept the table, re-rack and break, or have the breaker break again (WPA 4.3(d)).",
    )
    return {
      state: {
        ...base,
        shooter: opp,
        pending: { kind: "illegal_break", player: opp, options: ["accept_table", "rerack_and_break", "rerack_opponent_breaks"] },
      },
      fouls, spot, rerack: false, notes,
    }
  }
  if (pocketed.length > 0) {
    notes.push("Legal break with a ball pocketed: the breaker continues, and the table is open (WPA 4.3(c)).")
    return { state: { ...base, shooter: breaker }, fouls, spot, rerack: false, notes }
  }
  notes.push("Legal break. The table is open.")
  return { state: { ...base, shooter: opp }, fouls, spot, rerack: false, notes }
}

const isCalled = (call: Call | null | undefined, ball: string, pocket: string): boolean =>
  !!call && call !== "safety" && call.ball === ball && call.pocket === pocket

export function judgeEightBall(s: GameState, shot: ShotInput): Ruling {
  if (s.winner !== null) throw new Error("the rack is over")
  if (s.pending) throw new Error("a decision is pending")
  if (s.isBreak) return judgeBreak(s, shot)

  const f = shot.facts
  const call = shot.call ?? null
  const shooter = s.shooter
  const opp = other(shooter)
  const legal = legalTargets(s, shooter, shot.onTable)
  const pocketed = objectPocketed(f)
  const offTable = objectOffTable(f)

  const fouls: Foul[] = [...cueBallFouls(f), ...contactFouls(f, legal), ...kitchenFouls(s, f)]
  if (offTable.length > 0) fouls.push("ball_off_table")
  const notes = fouls.map((x) => FOUL_TEXT[x])
  const foul = fouls.length > 0

  const end = (winner: Player, why: string): Ruling => {
    notes.push(why)
    return { state: { ...s, winner, cueBallInHand: "none", pending: null }, fouls, spot: [], rerack: false, notes }
  }

  // 4.8 Losing the rack (and winning it).
  if (offTable.includes(EIGHT)) return end(opp, "8-ball driven off the table: loss of the rack (WPA 4.8(d)).")
  const eightPocket = f.pocketed.find((p) => p.ball === EIGHT)
  if (eightPocket) {
    if (foul) return end(opp, "8-ball pocketed on a foul: loss of the rack (WPA 4.8(a)).")
    if (!legal.has(EIGHT)) return end(opp, "8-ball pocketed before the group was cleared: loss of the rack (WPA 4.8(b)).")
    if (!isCalled(call, EIGHT, eightPocket.pocket)) return end(opp, "8-ball pocketed in an uncalled pocket: loss of the rack (WPA 4.8(c)).")
    return end(shooter, "8-ball legally pocketed in the called pocket: rack won.")
  }

  if (foul) {
    notes.push("Foul: the opponent has cue ball in hand anywhere on the table (WPA 4.9).")
    return { state: { ...s, shooter: opp, cueBallInHand: "table" }, fouls, spot: [], rerack: false, notes }
  }

  // A called ball counts only if it was a legal target and went in the called pocket (1.7, 4.6).
  const called = call !== null && call !== "safety" ? call : null
  const made = called !== null && legal.has(called.ball) && f.pocketed.some((p) => isCalled(called, p.ball, p.pocket))
  let groups = s.groups
  if (made && !groups) {
    const g = groupOf(called.ball)!
    const og: Group = g === "solids" ? "stripes" : "solids"
    groups = shooter === 0 ? [g, og] : [og, g]
    notes.push(`Called ball pocketed on the open table: the shooter takes the ${g} (WPA 4.4).`)
  }
  if (call === "safety") notes.push("Safety called: play passes to the opponent; pocketed balls stay down (WPA 4.6).")
  else if (made) notes.push("Called ball pocketed: the shooter continues (WPA 4.5).")
  else if (pocketed.length > 0) notes.push("The called ball wasn't pocketed as called; the turn passes (WPA 4.5).")
  return {
    state: { ...s, groups, shooter: made ? shooter : opp, cueBallInHand: "none" },
    fouls, spot: [], rerack: false, notes,
  }
}
