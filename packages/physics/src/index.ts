export * from "./math/roots/index.ts"
export { simulate, type BallInput, type EventType, type Shot, type ShotResult, type SimEvent } from "./engine.ts"
export { MotionState, evolve, type BallState } from "./motion.ts"
export {
  DEFAULT_BALL_PARAMS,
  DEFAULT_CUE_SPECS,
  DEFAULT_MODEL_CONFIG,
  type BallParams,
  type CueSpecs,
  type ModelConfig,
} from "./params.ts"
export type { CueStrike } from "./resolve/stick-ball.ts"
export { buildPocketTable, POOLTOOL_7FT, WPA_9FT, type TableSpec } from "./table-builder.ts"
export { CushionSide, type CircularCushion, type LinearCushion, type Pocket, type Table } from "./table.ts"
export type { Vec3 } from "./math/vec3.ts"
export { stateAtTime, trajectories, type Segment, type Trajectories } from "./trajectory.ts"
