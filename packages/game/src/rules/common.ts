import { CUE, type Foul, type GameState, type ShotFacts } from "../types.ts"

export const objectPocketed = (f: ShotFacts): string[] => f.pocketed.filter((p) => p.ball !== CUE).map((p) => p.ball)
export const objectOffTable = (f: ShotFacts): string[] => f.offTable.filter((b) => b !== CUE)

/** WPA 3.1. */
export function cueBallFouls(f: ShotFacts): Foul[] {
  const out: Foul[] = []
  if (f.pocketed.some((p) => p.ball === CUE)) out.push("cue_ball_scratch")
  if (f.offTable.includes(CUE)) out.push("cue_ball_off_table")
  return out
}

/** WPA 3.2 and 3.3 for a shot whose legal first targets are `legal`. */
export function contactFouls(f: ShotFacts, legal: ReadonlySet<string>): Foul[] {
  if (f.firstContacts.length === 0) return ["no_contact"]
  const out: Foul[] = []
  // 3.2: a legal ball hit at the same instant as an illegal one counts as first.
  if (!f.firstContacts.some((b) => legal.has(b))) out.push("wrong_ball_first")
  if (objectPocketed(f).length === 0 && !f.railAfterContact) out.push("no_rail")
  return out
}

/**
 * WPA 3.11, when the cue ball is in hand above the head string: a first
 * contact above the head string is a foul unless the cue ball crossed it
 * first, and the cue ball must either cross the head string or contact a
 * ball on or below it.
 */
export function kitchenFouls(s: GameState, f: ShotFacts): Foul[] {
  if (s.cueBallInHand !== "kitchen") return []
  if (f.firstContacts.length > 0 && f.firstContactAboveHeadString && !f.cueCrossedHeadStringBeforeContact) return ["bad_play_from_kitchen"]
  if (!f.cueCrossedHeadString && (f.firstContacts.length === 0 || f.firstContactAboveHeadString)) return ["bad_play_from_kitchen"]
  return []
}

export const FOUL_TEXT: Record<Foul, string> = {
  cue_ball_scratch: "Scratch: cue ball pocketed (WPA 3.1).",
  cue_ball_off_table: "Cue ball off the table (WPA 3.1).",
  no_contact: "The cue ball missed every object ball (WPA 3.3).",
  wrong_ball_first: "Wrong ball hit first (WPA 3.2).",
  no_rail: "No ball reached a rail after contact (WPA 3.3).",
  ball_off_table: "Object ball driven off the table (WPA 3.5).",
  bad_play_from_kitchen: "Cue ball in hand above the head string was not played across it (WPA 3.11).",
  illegal_break: "Illegal break: nothing pocketed and fewer than four balls to a rail (WPA 5.3).",
}
