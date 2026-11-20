/**
 * Table landmarks (WPA 2.1), racks (4.2, 5.2), spotting (1.5) and cue-ball
 * placement (1.6, 3.10).
 *
 * Frame: the physics frame, with the head rail at y = 0 and the foot rail at
 * y = l. The head string is the quarter of the length nearest the head rail;
 * the foot spot is where the foot string meets the long string.
 */
import type { TableSpec } from "@pixelpoolhall/physics"
import { shuffle, type Rng } from "./rng.ts"
import { SOLIDS, STRIPES } from "./rules/eight-ball.ts"
import type { Discipline } from "./types.ts"

export type Point = [number, number]

export interface Layout {
  l: number
  w: number
  /** Ball radius. */
  R: number
  headStringY: number
  footSpot: Point
  headSpot: Point
  /** Pocket capture circles (centers and radii), to keep placed balls out of them. */
  pockets: { center: Point; radius: number }[]
}

export function layoutFor(spec: TableSpec, R: number, pockets: Layout["pockets"]): Layout {
  return {
    l: spec.l,
    w: spec.w,
    R,
    headStringY: spec.l / 4,
    footSpot: [spec.w / 2, (3 * spec.l) / 4],
    headSpot: [spec.w / 2, spec.l / 4],
    pockets,
  }
}

export interface RackOptions {
  /** Nominal gap between neighboring balls, m. Default 2R·10⁻³ (as pooltool's racks). */
  gap?: number
  /** Each ball is displaced randomly by up to this distance, m. Default gap/4, which can't create overlaps. */
  jitter?: number
}

/** Rack positions for the object balls (WPA 4.2 for 8-ball, 5.2 for 9-ball). */
export function rackPositions(discipline: Discipline, layout: Layout, rng: Rng, opts: RackOptions = {}): Map<string, Point> {
  const { R, footSpot } = layout
  const gap = opts.gap ?? 2 * R * 1e-3
  const jitter = opts.jitter ?? gap / 4
  const d = 2 * R + gap
  const rowStep = (d * Math.sqrt(3)) / 2
  /** Center of slot `col` in row `row`, rows running toward the foot rail from `apexY`. */
  const slot = (row: number, col: number, rowLen: number, apexY: number): Point => [
    footSpot[0] + (col - (rowLen - 1) / 2) * d,
    apexY + row * rowStep,
  ]

  const out = new Map<string, Point>()
  if (discipline === "8-ball") {
    // Apex on the foot spot, the 8 in the middle of the third row, one ball
    // of each group on the back corners, the rest without pattern.
    const slots: Point[][] = []
    for (let row = 0; row < 5; row++) slots.push(Array.from({ length: row + 1 }, (_, c) => slot(row, c, row + 1, footSpot[1])))
    const solids = shuffle(SOLIDS, rng)
    const stripes = shuffle(STRIPES, rng)
    const [left, right] = rng.next() < 0.5 ? [solids.pop()!, stripes.pop()!] : [stripes.pop()!, solids.pop()!]
    out.set("8", slots[2]![1]!)
    out.set(left, slots[4]![0]!)
    out.set(right, slots[4]![4]!)
    const rest = shuffle([...solids, ...stripes], rng)
    for (let row = 0; row < 5; row++) {
      for (let c = 0; c <= row; c++) {
        if ((row === 2 && c === 1) || (row === 4 && (c === 0 || c === 4))) continue
        out.set(rest.pop()!, slots[row]![c]!)
      }
    }
  } else {
    // Diamond 1-2-3-2-1 with the 1 at the apex toward the head and the 9 in
    // the middle, on the foot spot.
    const rowLens = [1, 2, 3, 2, 1]
    const apexY = footSpot[1] - 2 * rowStep
    const rest = shuffle(["2", "3", "4", "5", "6", "7", "8"], rng)
    rowLens.forEach((n, row) => {
      for (let c = 0; c < n; c++) {
        const id = row === 0 ? "1" : row === 2 && c === 1 ? "9" : rest.pop()!
        out.set(id, slot(row, c, n, apexY))
      }
    })
  }
  for (const [id, [x, y]] of out) {
    const a = 2 * Math.PI * rng.next()
    const r = jitter * Math.sqrt(rng.next())
    out.set(id, [x + r * Math.cos(a), y + r * Math.sin(a)])
  }
  return out
}

/** Gap kept between a spotted ball and the ball it rests against (1.5: "in contact"). */
export const SPOT_CONTACT_GAP = 1e-6
/** Separation kept between a spotted ball and the cue ball (1.5). */
export const SPOT_CUE_GAP = 1e-3

/**
 * Spot position for a ball (WPA 1.5): on the long string, as close as
 * possible to the foot spot between it and the foot rail, against any
 * interfering ball; if that whole stretch is blocked, as close as possible
 * to the foot spot toward the head rail.
 * `occupied` maps ball ids to positions of balls on the table.
 */
export function spotPosition(layout: Layout, occupied: ReadonlyMap<string, Point>, cueBall = "cue"): Point {
  const { R, footSpot, l } = layout
  const x = footSpot[0]
  // Each ball blocks an interval of y along the long string.
  const blocked: [number, number][] = []
  for (const [id, [bx, by]] of occupied) {
    const minDist = 2 * R + (id === cueBall ? SPOT_CUE_GAP : SPOT_CONTACT_GAP)
    const dx = bx - x
    if (Math.abs(dx) >= minDist) continue
    const half = Math.sqrt(minDist * minDist - dx * dx)
    blocked.push([by - half, by + half])
  }
  const free = (y: number) => blocked.every(([a, b]) => y <= a || y >= b)
  // Candidates: the foot spot and each interval end, nearest first, on the requested side.
  const ends = blocked.flatMap(([a, b]) => [a, b])
  const below = [footSpot[1], ...ends.filter((y) => y > footSpot[1])].filter((y) => y <= l - R).sort((a, b) => a - b)
  for (const y of below) if (free(y)) return [x, y]
  const above = ends.filter((y) => y < footSpot[1] && y >= R).sort((a, b) => b - a)
  for (const y of above) if (free(y)) return [x, y]
  throw new Error("no room on the long string to spot a ball")
}

/** Why a cue-ball placement is illegal, or null if it's fine. */
export function placementProblem(
  layout: Layout,
  p: Point,
  others: Iterable<Point>,
  restriction: "kitchen" | "table",
): string | null {
  const { R, w, l } = layout
  const [x, y] = p
  if (x < R || x > w - R || y < R || y > l - R) return "off the playing surface"
  if (restriction === "kitchen" && !(y < layout.headStringY)) return "must be above the head string (WPA 3.10)"
  for (const pk of layout.pockets) if (Math.hypot(x - pk.center[0], y - pk.center[1]) < pk.radius) return "inside a pocket"
  for (const [ox, oy] of others) if (Math.hypot(x - ox, y - oy) < 2 * R) return "overlaps another ball"
  return null
}
