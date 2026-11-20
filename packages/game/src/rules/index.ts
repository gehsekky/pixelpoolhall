/** Rules entry points: initial state, shot judgment, and pending decisions. */
import {
  DEFAULT_RULE_OPTIONS,
  other,
  type Discipline,
  type GameState,
  type Option,
  type Player,
  type Ruling,
  type RuleOptions,
  type ShotInput,
} from "../types.ts"
import { EIGHT, judgeEightBall } from "./eight-ball.ts"
import { judgeNineBall } from "./nine-ball.ts"

/** State at the start of a rack, with `breaker` to break. */
export function newRack(discipline: Discipline, breaker: Player, rules: Partial<RuleOptions> = {}): GameState {
  return {
    discipline,
    rules: { ...DEFAULT_RULE_OPTIONS, ...rules },
    breaker,
    shooter: breaker,
    isBreak: true,
    cueBallInHand: "kitchen",
    groups: null,
    pushOutAvailable: false,
    consecutiveFouls: [0, 0],
    pending: null,
    winner: null,
  }
}

export function judge(s: GameState, shot: ShotInput): Ruling {
  return s.discipline === "8-ball" ? judgeEightBall(s, shot) : judgeNineBall(s, shot)
}

/** Resolve the pending decision with `option`. */
export function decide(s: GameState, option: Option): Ruling {
  const p = s.pending
  if (!p) throw new Error("no decision is pending")
  if (!p.options.includes(option)) throw new Error(`"${option}" isn't an option for ${p.kind}`)
  const chooser = p.player
  const cleared: GameState = { ...s, pending: null }
  const ruling = (state: GameState, extra: Partial<Ruling> = {}): Ruling => ({ state, fouls: [], spot: [], rerack: false, notes: [], ...extra })
  const rerack = (breaker: Player): Ruling =>
    ruling({ ...newRack(s.discipline, breaker, s.rules) }, { rerack: true, notes: [`Re-rack; player ${breaker + 1} breaks.`] })

  switch (option) {
    case "accept_table":
      // Regulation 16(3): accepting after a three-ball-rule failure forfeits the push out.
      return ruling({ ...cleared, shooter: chooser, cueBallInHand: "none", pushOutAvailable: false })
    case "cue_ball_in_kitchen":
      return ruling({ ...cleared, shooter: chooser, cueBallInHand: "kitchen" })
    case "rerack_and_break":
      return rerack(chooser)
    case "rerack_opponent_breaks":
      return rerack(other(chooser))
    case "spot_eight":
      // 4.3(e): the breaker plays on from position; 4.3(f): the opponent shoots from above the head string.
      return ruling(
        { ...cleared, shooter: chooser, cueBallInHand: p.kind === "eight_on_break_foul" ? "kitchen" : "none" },
        { spot: [EIGHT] },
      )
    case "shoot":
      return ruling({ ...cleared, shooter: chooser, cueBallInHand: "none" })
    case "pass":
      // After a push out the pusher must shoot (no second push). After a
      // three-ball-rule failure the breaker shoots and may push out (Reg. 16(4)).
      return ruling({ ...cleared, shooter: other(chooser), cueBallInHand: "none", pushOutAvailable: p.kind === "three_ball_rule" })
  }
}
