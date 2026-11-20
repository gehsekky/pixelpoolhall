/**
 * Shared game types. Rule references (e.g. "WPA 4.3(d)") are to the WPA
 * Rules of Play effective 2026-10-21 and the WPA Regulations of the same date.
 */

export type Player = 0 | 1
export const other = (p: Player): Player => (p === 0 ? 1 : 0)

export type Discipline = "8-ball" | "9-ball"
export type Group = "solids" | "stripes"

export const CUE = "cue"

/** A called shot (WPA 1.7): one ball and one pocket, or a safety. */
export type Call = { ball: string; pocket: string } | "safety"

export type Foul =
  /** WPA 3.1: cue ball pocketed. */
  | "cue_ball_scratch"
  /** WPA 3.1: cue ball driven off the table. */
  | "cue_ball_off_table"
  /** WPA 3.3: the cue ball contacted no object ball. */
  | "no_contact"
  /** WPA 3.2: the first ball contacted was not a legal object ball. */
  | "wrong_ball_first"
  /** WPA 3.3: nothing pocketed and no ball driven to a rail after contact. */
  | "no_rail"
  /** WPA 3.5: an object ball driven off the table. */
  | "ball_off_table"
  /** WPA 3.11: cue ball in hand above the head string not played legally across it. */
  | "bad_play_from_kitchen"
  /** WPA 5.3(b): 9-ball break with nothing pocketed and fewer than four balls to a rail. */
  | "illegal_break"

export type Option =
  /** Play the table as it lies. */
  | "accept_table"
  /** Take the cue ball in hand above the head string. */
  | "cue_ball_in_kitchen"
  /** Re-rack, and the chooser breaks. */
  | "rerack_and_break"
  /** Re-rack, and the other player breaks. */
  | "rerack_opponent_breaks"
  /** Spot the 8-ball and play on. */
  | "spot_eight"
  /** Take the next shot. */
  | "shoot"
  /** Hand the next shot to the other player. */
  | "pass"

/** A choice one player must make before play continues. */
export type Pending =
  /** 8-ball 4.3(d): illegal break; the incoming player chooses. */
  | { kind: "illegal_break"; player: Player; options: Option[] }
  /** 8-ball 4.3(e): 8 pocketed on a legal break; the breaker chooses. */
  | { kind: "eight_on_break"; player: Player; options: Option[] }
  /** 8-ball 4.3(f): 8 pocketed on a foul break; the opponent chooses. */
  | { kind: "eight_on_break_foul"; player: Player; options: Option[] }
  /** 8-ball 4.3(g)/(h): other break fouls; the opponent chooses. */
  | { kind: "break_foul"; player: Player; options: Option[] }
  /** 9-ball 5.4: after a legal push out, the other player chooses who shoots. */
  | { kind: "after_push_out"; player: Player; options: Option[] }
  /** 9-ball, WPA Regulation 16: the three-ball break rule was not met. */
  | { kind: "three_ball_rule"; player: Player; options: Option[] }

export interface RuleOptions {
  /** WPA Regulation 16 (three-ball break rule) at 9-ball. Default on. */
  threeBallRule: boolean
  /**
   * 8-ball: shots must be called (WPA 1.7, 4.6). Default on. When off (not a
   * WPA rule), the first legal ball pocketed counts as called in the pocket it
   * went in. That includes the 8.
   */
  callShots: boolean
}

export const DEFAULT_RULE_OPTIONS: Readonly<RuleOptions> = { threeBallRule: true, callShots: true }

export type CueBallInHand = "none" | "kitchen" | "table"

export interface GameState {
  discipline: Discipline
  rules: RuleOptions
  /** Breaker of the current rack. */
  breaker: Player
  /** Player to shoot (or to choose, while a decision is pending). */
  shooter: Player
  /** The next shot is the break. */
  isBreak: boolean
  cueBallInHand: CueBallInHand
  /** 8-ball groups by player; null while the table is open. */
  groups: [Group, Group] | null
  /** 9-ball: the next shot may be a push out (5.4). */
  pushOutAvailable: boolean
  /** 9-ball: consecutive fouls by each player in this rack (3.13). */
  consecutiveFouls: [number, number]
  pending: Pending | null
  winner: Player | null
}

/** What happened on a shot, extracted from the simulation (see facts.ts). */
export interface ShotFacts {
  /** Object balls the cue ball contacted first (more than one only if simultaneous). */
  firstContacts: string[]
  firstContactTime: number
  /** Balls pocketed during the shot, in order, including the cue ball. */
  pocketed: { ball: string; pocket: string; time: number }[]
  /** Balls driven off the table. */
  offTable: string[]
  /** After the first contact, some ball was driven to a rail (WPA 2.7, 3.3). */
  railAfterContact: boolean
  /** Distinct object balls driven to a rail during the shot. */
  objectBallsToRail: string[]
  /** WPA 3.11: the cue ball crossed the head string before its first contact. */
  cueCrossedHeadStringBeforeContact: boolean
  /** WPA 3.11: the cue ball crossed the head string at any time. */
  cueCrossedHeadString: boolean
  /** WPA 3.11: the first ball contacted was above the head string. */
  firstContactAboveHeadString: boolean
  /** WPA Regulation 16: object balls whose center went beyond the head string. */
  objectBallsCrossedHeadString: string[]
}

export interface ShotInput {
  facts: ShotFacts
  /** Object balls on the table when the shot began. */
  onTable: ReadonlySet<string>
  /** 8-ball: the shooter's call (ignored on the break). */
  call?: Call | null
  /** 9-ball: the shooter declared a push out. */
  pushOut?: boolean
}

export interface Ruling {
  state: GameState
  fouls: Foul[]
  /** Object balls to spot before the next shot (WPA 1.5), in order. */
  spot: string[]
  /** Re-rack before the next shot (the new state's breaker breaks). */
  rerack: boolean
  /** Plain-language explanation, with rule numbers. */
  notes: string[]
}
