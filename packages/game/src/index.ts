export * from "./types.ts"
export { extremeY, shotFacts, SIMULTANEOUS } from "./facts.ts"
export {
  layoutFor,
  placementProblem,
  rackPositions,
  spotPosition,
  SPOT_CONTACT_GAP,
  SPOT_CUE_GAP,
  type Layout,
  type Point,
  type RackOptions,
} from "./layout.ts"
export { createRng, shuffle, type Rng } from "./rng.ts"
export { decide, judge, newRack } from "./rules/index.ts"
export { EIGHT, groupOf, legalTargets, SOLIDS, STRIPES } from "./rules/eight-ball.ts"
export { lowestBall, NINE, NINE_BALLS } from "./rules/nine-ball.ts"
export { FOUL_TEXT } from "./rules/common.ts"
export { Game, type GameOptions, type Preview, type ShotOptions, type ShotRecord } from "./session.ts"
export { AI_LEVELS, bestEase, chooseOption, executionNoise, planShot, shotGeometry, type AiLevel, type AiPlan } from "./ai.ts"
