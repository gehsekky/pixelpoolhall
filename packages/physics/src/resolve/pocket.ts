/**
 * Phase 1 pocket model (pooltool's "canonical"): a captured ball is moved to
 * the pocket center at -depth and stopped. Phase 3 replaces this with real
 * pocket geometry (docs/physics-design.md, "Pockets").
 */
import { MotionState, type BallState } from "../motion.ts"
import type { Pocket } from "../table.ts"

export function resolvePocket(pocket: Pocket): BallState {
  return { r: [pocket.center[0], pocket.center[1], -pocket.depth], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.pocketed }
}
