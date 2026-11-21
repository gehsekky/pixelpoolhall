/**
 * Table geometry consumed by the engine. The engine is frame-agnostic: it uses
 * whatever coordinates the geometry is given in (the pooltool fixtures use
 * pooltool's frame, with y along the table's length).
 */
import { norm, scale, sub, type Vec3 } from "./math/vec3.ts"

/** Which side(s) of a straight cushion a ball can hit (pooltool's CushionDirection). */
export const CushionSide = { side1: 0, side2: 1, both: 2 } as const
export type CushionSide = (typeof CushionSide)[keyof typeof CushionSide]

/**
 * A straight cushion: a nose cylinder of radius `noseRadius` whose axis runs
 * from p1 to p2 at height p1[2] above the slate.
 */
export interface LinearCushion {
  id: string
  p1: Vec3
  p2: Vec3
  noseRadius: number
  side: CushionSide
}

/** A pocket jaw: a vertical cylinder of radius `radius` about `center` (z = cushion height). */
export interface CircularCushion {
  id: string
  center: Vec3
  radius: number
}

/**
 * A pocket. Without `interior`, a ball is captured when its center enters the
 * circle (pooltool's model). With it, the circle is the pocket cut in the
 * slate (see PocketInterior).
 */
export interface Pocket {
  id: string
  center: Vec3
  radius: number
  /** Depth below the slate where a captured ball is placed. */
  depth: number
  interior?: PocketInterior
}

/**
 * The inside of a pocket (3D mode; in 2D a ball is captured when its center
 * crosses the cut). The pocket's circle is the cut in the slate, with its
 * edge at z = 0. Toward the table, between the facings' noses, the edge is
 * open: a ball rolls over it and drops. Elsewhere, above the slate, the cut
 * continues up as a wall (the facings, then the liner at the back), to
 * `wallTop`.
 */
export interface PocketInterior {
  /** Unit vector in the table plane from the circle's center toward the table. */
  open: [number, number]
  /** Edge points whose direction from the center is within this cosine of `open` are open (no wall). */
  openCos: number
  /** Height of the top of the back wall above the slate, m. */
  wallTop: number
}

export interface Table {
  linear: LinearCushion[]
  circular: CircularCushion[]
  pockets: Pocket[]
  /**
   * Playing surface, nose to nose ([0, w] × [0, l]). In 3D, an airborne ball
   * whose center crosses its edge (outside a pocket) leaves the table.
   * Without it, balls never leave the table.
   */
  size?: { w: number; l: number }
}

export const cushionHeight = (c: LinearCushion): number => c.p1[2]

export function unitAxis(c: LinearCushion): Vec3 {
  const d = sub(c.p2, c.p1)
  return scale(d, 1 / norm(d))
}

/**
 * The cushion line in the table plane as lx·x + ly·y + l0 = 0, normalized the
 * way pooltool does (ly = 1, or lx = 1 for a line parallel to y).
 */
export function lineCoefficients(c: LinearCushion): { lx: number; ly: number; l0: number } {
  const [x1, y1] = c.p1
  const [x2, y2] = c.p2
  if (x2 - x1 === 0) return { lx: 1, ly: 0, l0: -x1 }
  const slope = (y2 - y1) / (x2 - x1)
  return { lx: -slope, ly: 1, l0: slope * x1 - y1 }
}
