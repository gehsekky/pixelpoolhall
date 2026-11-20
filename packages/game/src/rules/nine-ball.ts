/**
 * 9-ball, WPA Rules of Play section 5 (effective 2026-10-21), with the
 * three-ball break rule of WPA Regulation 16 (on by default).
 * The referee always warns a shooter on two fouls (3.13), so a third
 * consecutive foul always loses the rack. Fouls that need a human at the
 * table aren't modeled (see eight-ball.ts).
 */
import { other, type Foul, type GameState, type Player, type Ruling, type ShotInput } from "../types.ts"
import { contactFouls, cueBallFouls, FOUL_TEXT, kitchenFouls, objectOffTable, objectPocketed } from "./common.ts"

export const NINE = "9"
export const NINE_BALLS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

export const lowestBall = (onTable: ReadonlySet<string>): string | undefined =>
  [...onTable].sort((a, b) => Number(a) - Number(b))[0]

function bumpFouls(s: GameState, p: Player): [number, number] {
  const c: [number, number] = [...s.consecutiveFouls]
  c[p] += 1
  return c
}

function clearFouls(s: GameState, p: Player): [number, number] {
  const c: [number, number] = [...s.consecutiveFouls]
  c[p] = 0
  return c
}

/** Apply a standard foul: ball in hand for the opponent, the 9 spotted if it went down, three fouls lose. */
function standardFoul(s: GameState, fouls: Foul[], nineDown: boolean, notes: string[]): Ruling {
  const shooter = s.shooter
  const opp = other(shooter)
  const consecutiveFouls = bumpFouls(s, shooter)
  const base: GameState = { ...s, isBreak: false, pushOutAvailable: false, consecutiveFouls, pending: null }
  if (consecutiveFouls[shooter] >= 3) {
    notes.push("Third consecutive foul: loss of the rack (WPA 3.13, 5.8).")
    return { state: { ...base, winner: opp, cueBallInHand: "none" }, fouls, spot: [], rerack: false, notes }
  }
  if (consecutiveFouls[shooter] === 2) notes.push("Warning: the shooter is on two fouls (WPA 3.13).")
  const spot = nineDown ? [NINE] : []
  if (nineDown) notes.push("The 9-ball is spotted (WPA 5.6).")
  notes.push("Foul: the opponent has cue ball in hand anywhere on the table (WPA 5.7).")
  return { state: { ...base, shooter: opp, cueBallInHand: "table" }, fouls, spot, rerack: false, notes }
}

function judgeBreak(s: GameState, shot: ShotInput): Ruling {
  const f = shot.facts
  const breaker = s.shooter
  const pocketed = objectPocketed(f)
  const offTable = objectOffTable(f)
  const nineDown = pocketed.includes(NINE) || offTable.includes(NINE)
  const fouls: Foul[] = [...cueBallFouls(f)]
  if (offTable.length > 0) fouls.push("ball_off_table")
  if (pocketed.length === 0 && f.objectBallsToRail.length < 4) fouls.push("illegal_break")
  const notes = fouls.map((x) => FOUL_TEXT[x])
  if (fouls.length > 0) return standardFoul(s, fouls, nineDown, notes)

  const base: GameState = {
    ...s,
    isBreak: false,
    cueBallInHand: "none",
    pending: null,
    consecutiveFouls: clearFouls(s, breaker),
  }
  if (s.rules.threeBallRule) {
    const counted = new Set([...pocketed, ...f.objectBallsCrossedHeadString])
    if (counted.size < 3) {
      const opp = other(breaker)
      notes.push(
        `Three-ball rule not met (${counted.size} ball(s) pocketed or past the head string): the opponent may ` +
          "accept the table without a push out, or hand the shot back to the breaker, who may push out (WPA Regulation 16).",
      )
      const spot = pocketed.includes(NINE) ? [NINE] : []
      if (spot.length) notes.push("The 9-ball is spotted (WPA Regulation 16(5)).")
      return {
        state: { ...base, shooter: opp, pushOutAvailable: false, pending: { kind: "three_ball_rule", player: opp, options: ["accept_table", "pass"] } },
        fouls, spot, rerack: false, notes,
      }
    }
  }
  if (pocketed.includes(NINE)) {
    notes.push("9-ball pocketed on a legal break: rack won (WPA 5.5).")
    return { state: { ...base, winner: breaker }, fouls, spot: [], rerack: false, notes }
  }
  // 5.4: after a legal break, the next shot may be a push out.
  if (pocketed.length > 0) {
    notes.push("Legal break with a ball pocketed: the breaker continues and may push out (WPA 5.4, 5.5).")
    return { state: { ...base, shooter: breaker, pushOutAvailable: true }, fouls, spot: [], rerack: false, notes }
  }
  notes.push("Legal break. The incoming player may push out (WPA 5.4).")
  return { state: { ...base, shooter: other(breaker), pushOutAvailable: true }, fouls, spot: [], rerack: false, notes }
}

export function judgeNineBall(s: GameState, shot: ShotInput): Ruling {
  if (s.winner !== null) throw new Error("the rack is over")
  if (s.pending) throw new Error("a decision is pending")
  if (s.isBreak) return judgeBreak(s, shot)
  const pushOut = shot.pushOut === true
  if (pushOut && !s.pushOutAvailable) throw new Error("a push out isn't allowed on this shot")

  const f = shot.facts
  const shooter = s.shooter
  const opp = other(shooter)
  const lowest = lowestBall(shot.onTable)
  const pocketed = objectPocketed(f)
  const offTable = objectOffTable(f)
  const nineDown = pocketed.includes(NINE) || offTable.includes(NINE)

  const fouls: Foul[] = [...cueBallFouls(f), ...kitchenFouls(s, f)]
  // 5.4: a push out suspends 3.2 and 3.3.
  if (!pushOut) fouls.push(...contactFouls(f, new Set(lowest ? [lowest] : [])))
  if (offTable.length > 0) fouls.push("ball_off_table")
  const notes = fouls.map((x) => FOUL_TEXT[x])
  if (fouls.length > 0) return standardFoul(s, fouls, nineDown, notes)

  const base: GameState = { ...s, pushOutAvailable: false, cueBallInHand: "none", consecutiveFouls: clearFouls(s, shooter) }
  if (pushOut) {
    const spot = pocketed.includes(NINE) ? [NINE] : []
    if (spot.length) notes.push("The 9-ball pocketed on a push out is spotted (WPA 5.6).")
    notes.push("Push out: the opponent chooses who shoots next (WPA 5.4).")
    return {
      state: { ...base, shooter: opp, pending: { kind: "after_push_out", player: opp, options: ["shoot", "pass"] } },
      fouls, spot, rerack: false, notes,
    }
  }
  if (pocketed.includes(NINE)) {
    notes.push("9-ball legally pocketed: rack won (WPA 5.5).")
    return { state: { ...base, winner: shooter }, fouls, spot: [], rerack: false, notes }
  }
  if (pocketed.length > 0) {
    notes.push("Ball legally pocketed: the shooter continues (WPA 5.5).")
    return { state: { ...base, shooter }, fouls, spot: [], rerack: false, notes }
  }
  return { state: { ...base, shooter: opp }, fouls, spot: [], rerack: false, notes }
}
