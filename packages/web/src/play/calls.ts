/** Called-shot helpers (WPA 1.7): pocket names and the obvious call for an aim. */
import type { Table } from "@pixelpoolhall/physics"

/** Pocket ids from the table builder; the head rail is at y = 0, "left" is x = 0 seen from the head. */
export const POCKET_NAMES: Record<string, string> = {
  lb: "head-left corner",
  lc: "left side",
  lt: "foot-left corner",
  rb: "head-right corner",
  rc: "right side",
  rt: "foot-right corner",
}

/** Largest angle (degrees) between an object ball's path and a pocket for the pocket to count as obvious. */
const OBVIOUS_ANGLE = 20

/**
 * The pocket an object ball at (ox, oy) heads for when sent along (ux, uy), or
 * null if no pocket lies within OBVIOUS_ANGLE of that direction.
 */
export function pocketToward(table: Table, ox: number, oy: number, ux: number, uy: number): string | null {
  const n = Math.hypot(ux, uy)
  let best: string | null = null
  let bestAngle = OBVIOUS_ANGLE
  for (const p of table.pockets) {
    const vx = p.center[0] - ox
    const vy = p.center[1] - oy
    const cos = (ux * vx + uy * vy) / (n * Math.hypot(vx, vy))
    const angle = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
    if (angle < bestAngle) {
      bestAngle = angle
      best = p.id
    }
  }
  return best
}
