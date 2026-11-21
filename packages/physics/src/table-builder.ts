/**
 * Builds pocket-table geometry (rails, jaws, pockets) from a TableSpec.
 *
 * Frame: origin at a corner of the playing surface, x across the table
 * (0..w), y along it (0..l), z up from the slate. Rail ids follow pooltool's
 * numbering so results can be compared with it.
 *
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt).
 * Modified: rewritten in TypeScript; same geometry (pooltool's
 * create_pocket_table_cushion_segments and create_pocket_table_pockets).
 */
import { CushionSide, type CircularCushion, type LinearCushion, type Pocket, type Table } from "./table.ts"

export interface TableSpec {
  /** Playing surface length and width, m (cushion nose to cushion nose). */
  l: number
  w: number
  cushionWidth: number
  /** Height of the cushion nose above the slate, m. */
  cushionHeight: number
  cushionNoseRadius: number
  cornerPocketWidth: number
  /** Corner pocket facing angle, degrees (beyond the 45° diagonal). */
  cornerPocketAngle: number
  cornerPocketDepth: number
  cornerPocketRadius: number
  cornerJawRadius: number
  sidePocketWidth: number
  /** Side pocket facing angle, degrees. */
  sidePocketAngle: number
  sidePocketDepth: number
  sidePocketRadius: number
  sideJawRadius: number
  /** Pocket interiors (shelf, slate cut, back wall). Without it, pockets are capture circles. */
  pocketInterior?: PocketInteriorSpec
}

export interface PocketInteriorSpec {
  /** Shelf: from the middle of the mouth (lip to lip) to the slate cut, m (WPA §9). */
  cornerShelf: number
  sideShelf: number
  /**
   * Back draft (vertical pocket angle), degrees: the facings lean back from
   * the nose, so at the slate they sit cushionHeight·tan(angle) behind it.
   */
  backDraft: number
  /** Top of the rail (and of the pocket's back wall) above the slate, m. */
  railHeight: number
}

/** pooltool 0.6.0's default 7-ft pocket table (used by the reference fixtures). */
export const POOLTOOL_7FT: Readonly<TableSpec> = {
  l: 1.9812,
  w: 1.9812 / 2,
  cushionWidth: (2 * 2.54) / 100,
  cushionHeight: 0.64 * 2 * 0.028575,
  cushionNoseRadius: 0.001,
  cornerPocketWidth: 0.118,
  cornerPocketAngle: 5.3,
  cornerPocketDepth: 0.0417,
  cornerPocketRadius: 0.062,
  cornerJawRadius: 0.02095,
  sidePocketWidth: 0.137,
  sidePocketAngle: 7.14,
  sidePocketDepth: 0.0685,
  sidePocketRadius: 0.0645,
  sideJawRadius: 0.00795,
}

const INCH = 0.0254

/**
 * WPA tournament 9-ft table, from the WPA Recommended Equipment
 * Specifications (effective November 2001), using each range's midpoint:
 * - playing surface 100 × 50 in, measured from cushion nose to nose (§5);
 * - cushion 1⅞–2 in wide (§7); nose height 63.5% of the ball diameter (§7);
 * - corner mouth 4.5–4.625 in and side mouth 5–5.125 in, lip to lip (§9);
 * - facing cut angle 142° at the corners and 104° at the sides (§9). In this
 *   geometry the interior angle between nose and facing is 135° + corner
 *   angle at the corners, so 7°. At the sides it is 90° + side angle, so 14°.
 *   The side facing runs from the jaw to a point a cushion width behind the
 *   nose, not exactly through the lip, so the built side angle is 103.6°. That
 *   is still inside the ±1° tolerance.
 * The WPA doesn't specify the jaw rounding, the nose radius or the
 * pocket capture circles; those keep pooltool's values until the Phase 3
 * pocket model replaces them.
 */
export const WPA_9FT: Readonly<TableSpec> = {
  l: 100 * INCH,
  w: 50 * INCH,
  cushionWidth: 1.9375 * INCH,
  cushionHeight: 0.635 * 2.25 * INCH,
  cushionNoseRadius: POOLTOOL_7FT.cushionNoseRadius,
  cornerPocketWidth: 4.5625 * INCH,
  cornerPocketAngle: 7,
  cornerPocketDepth: POOLTOOL_7FT.cornerPocketDepth,
  cornerPocketRadius: POOLTOOL_7FT.cornerPocketRadius,
  cornerJawRadius: POOLTOOL_7FT.cornerJawRadius,
  sidePocketWidth: 5.0625 * INCH,
  sidePocketAngle: 14,
  sidePocketDepth: POOLTOOL_7FT.sidePocketDepth,
  sidePocketRadius: POOLTOOL_7FT.sidePocketRadius,
  sideJawRadius: POOLTOOL_7FT.sideJawRadius,
  pocketInterior: {
    // WPA §9: corner shelf 1–2¼ in, side 0–⅜ in, back draft 12–15°; midpoints.
    cornerShelf: 1.625 * INCH,
    sideShelf: 0.1875 * INCH,
    backDraft: 13.5,
    // Not specified by the WPA; a typical rail cap height (estimate).
    railHeight: 1.75 * INCH,
  },
}

/** Pocket depth below the slate where captured balls are placed (pooltool's default). */
const POCKET_DEPTH = 0.08

export function buildPocketTable(spec: TableSpec): Table {
  const { l, w } = spec
  const cw = spec.cushionWidth
  const ca = ((spec.cornerPocketAngle + 45) * Math.PI) / 180
  const sa = (spec.sidePocketAngle * Math.PI) / 180
  const pw = spec.cornerPocketWidth
  const sw = spec.sidePocketWidth
  const h = spec.cushionHeight
  const rc = spec.cornerJawRadius
  const rs = spec.sideJawRadius
  // Setback of each jaw's tangent point from the pocket mouth line.
  const dc = rc / Math.tan((Math.PI / 2 + ca) / 2)
  const ds = rs / Math.tan((Math.PI / 2 + sa) / 2)
  const pc = pw * Math.cos(Math.PI / 4)
  const cos = Math.cos
  const sin = Math.sin
  const tan = Math.tan

  const seg = (id: string, p1: [number, number], p2: [number, number], side: CushionSide): LinearCushion => ({
    id,
    p1: [p1[0], p1[1], h],
    p2: [p2[0], p2[1], h],
    noseRadius: spec.cushionNoseRadius,
    side,
  })
  const { side1, side2 } = CushionSide
  const linear: LinearCushion[] = [
    // Long rails.
    seg("3", [0, pc + dc], [0, (l - sw) / 2 - ds], side2),
    seg("6", [0, (l + sw) / 2 + ds], [0, -pc + l - dc], side2),
    seg("15", [w, pc + dc], [w, (l - sw) / 2 - ds], side1),
    seg("12", [w, (l + sw) / 2 + ds], [w, -pc + l - dc], side1),
    // Short rails.
    seg("18", [pc + dc, 0], [-pc + w - dc, 0], side2),
    seg("9", [pc + dc, l], [-pc + w - dc, l], side1),
    // Side pocket facings.
    seg("5", [-cw, (l + sw) / 2 - cw * sin(sa)], [-ds * cos(sa), (l + sw) / 2 - ds * sin(sa)], side1),
    seg("4", [-cw, (l - sw) / 2 + cw * sin(sa)], [-ds * cos(sa), (l - sw) / 2 + ds * sin(sa)], side2),
    seg("13", [w + cw, (l + sw) / 2 - cw * sin(sa)], [w + ds * cos(sa), (l + sw) / 2 - ds * sin(sa)], side1),
    seg("14", [w + cw, (l - sw) / 2 + cw * sin(sa)], [w + ds * cos(sa), (l - sw) / 2 + ds * sin(sa)], side2),
    // Corner pocket facings.
    seg("1", [pc - cw * tan(ca), -cw], [pc - dc * sin(ca), -dc * cos(ca)], side2),
    seg("2", [-cw, pc - cw * tan(ca)], [-dc * cos(ca), pc - dc * sin(ca)], side1),
    seg("8", [pc - cw * tan(ca), cw + l], [pc - dc * sin(ca), l + dc * cos(ca)], side1),
    seg("7", [-cw, -pc + cw * tan(ca) + l], [-dc * cos(ca), -pc + l + dc * sin(ca)], side2),
    seg("11", [cw + w, -pc + cw * tan(ca) + l], [w + dc * cos(ca), -pc + l + dc * sin(ca)], side2),
    seg("10", [-pc + cw * tan(ca) + w, cw + l], [-pc + w + dc * sin(ca), l + dc * cos(ca)], side1),
    seg("16", [cw + w, +pc - cw * tan(ca)], [w + dc * cos(ca), pc - dc * sin(ca)], side1),
    seg("17", [-pc + cw * tan(ca) + w, -cw], [-pc + w + dc * sin(ca), -dc * cos(ca)], side2),
  ]

  const jaw = (id: string, x: number, y: number, radius: number): CircularCushion => ({ id, center: [x, y, h], radius })
  const circular: CircularCushion[] = [
    jaw("1t", pc + dc, -rc, rc),
    jaw("2t", -rc, pc + dc, rc),
    jaw("4t", -rs, l / 2 - sw / 2 - ds, rs),
    jaw("5t", -rs, l / 2 + sw / 2 + ds, rs),
    jaw("7t", -rc, l - (pc + dc), rc),
    jaw("8t", pc + dc, l + rc, rc),
    jaw("10t", w - pc - dc, l + rc, rc),
    jaw("11t", w + rc, l - (pc + dc), rc),
    jaw("13t", w + rs, l / 2 + sw / 2 + ds, rs),
    jaw("14t", w + rs, l / 2 - sw / 2 - ds, rs),
    jaw("16t", w + rc, pc + dc, rc),
    jaw("17t", w - pc - dc, -rc, rc),
  ]

  // Corner pocket centers sit diagonally outward from the rail intersection
  // by the corner depth; side pocket centers sit outward by the side depth.
  const cD = spec.cornerPocketDepth / Math.sqrt(2)
  const sD = spec.sidePocketDepth
  const pocket = (id: string, x: number, y: number, radius: number): Pocket => ({ id, center: [x, y, 0], radius, depth: POCKET_DEPTH })
  const pockets: Pocket[] = [
    pocket("lb", -cD, -cD, spec.cornerPocketRadius),
    pocket("lc", -sD, l / 2, spec.sidePocketRadius),
    pocket("lt", -cD, l + cD, spec.cornerPocketRadius),
    pocket("rb", w + cD, -cD, spec.cornerPocketRadius),
    pocket("rc", w + sD, l / 2, spec.sidePocketRadius),
    pocket("rt", w + cD, l + cD, spec.cornerPocketRadius),
  ]

  if (spec.pocketInterior) {
    const byId = new Map(linear.map((c) => [c.id, c]))
    const cornerMouth = pc / Math.SQRT2
    // Per pocket: where its mouth is, the direction into it, its facings.
    const layout: [string, [number, number], [number, number], number, [string, string], number][] = [
      ["lb", [0, 0], [-1, -1], cornerMouth, ["1", "2"], spec.pocketInterior.cornerShelf],
      ["lt", [0, l], [-1, 1], cornerMouth, ["7", "8"], spec.pocketInterior.cornerShelf],
      ["rb", [w, 0], [1, -1], cornerMouth, ["16", "17"], spec.pocketInterior.cornerShelf],
      ["rt", [w, l], [1, 1], cornerMouth, ["10", "11"], spec.pocketInterior.cornerShelf],
      ["lc", [0, l / 2], [-1, 0], 0, ["4", "5"], spec.pocketInterior.sideShelf],
      ["rc", [w, l / 2], [1, 0], 0, ["13", "14"], spec.pocketInterior.sideShelf],
    ]
    const drop = spec.cushionHeight * Math.tan((spec.pocketInterior.backDraft * Math.PI) / 180)
    for (const [id, corner, dir, back, facings, shelf] of layout) {
      const pocket = pockets.find((p) => p.id === id)!
      const cut = slateCut(corner, dir, back, facings.map((f) => byId.get(f)!) as [LinearCushion, LinearCushion], shelf, drop)
      pocket.center = [cut.center[0], cut.center[1], 0]
      pocket.radius = cut.radius
      pocket.interior = { open: cut.open, openCos: cut.openCos, wallTop: spec.pocketInterior.railHeight }
    }
  }

  return { linear, circular, pockets, size: { w, l } }
}

/**
 * The pocket cut in the slate: the circle whose nearest point to the table is
 * the shelf depth behind the middle of the mouth, and which is tangent to both
 * facings where they meet the slate (each nose line moved back by `drop`).
 * `corner` and `back` place the mouth's middle at corner − back·dir̂.
 */
function slateCut(
  corner: [number, number], dir: [number, number], back: number, facings: [LinearCushion, LinearCushion], shelf: number, drop: number,
): { center: [number, number]; radius: number; open: [number, number]; openCos: number } {
  const len = Math.hypot(dir[0], dir[1])
  const a: [number, number] = [dir[0] / len, dir[1] / len]
  const m: [number, number] = [corner[0] - back * a[0], corner[1] - back * a[1]]
  let radius = Infinity
  let openCos = 0
  for (const f of facings) {
    const dx = f.p2[0] - f.p1[0]
    const dy = f.p2[1] - f.p1[1]
    const fl = Math.hypot(dx, dy)
    // Unit normal of the facing line, toward the mouth's middle.
    let nx = -dy / fl
    let ny = dx / fl
    let d0 = (m[0] - f.p1[0]) * nx + (m[1] - f.p1[1]) * ny
    if (d0 < 0) {
      nx = -nx
      ny = -ny
      d0 = -d0
    }
    // Center m + (shelf + ρ) â at distance ρ from the moved-back line: d0 + drop + (shelf + ρ) k = ρ.
    const k = a[0] * nx + a[1] * ny
    const rho = (d0 + drop + shelf * k) / (1 - k)
    radius = Math.min(radius, rho)
    // From the center, the tangent point lies along −n̂, at angle acos(k) from
    // the direction to the table (−â). The edge is open (nothing above it)
    // only up to where the circle passes under the facing's nose line, at
    // distance ρ − drop from the center: acos((ρ − drop)/ρ) short of that.
    openCos = Math.cos(Math.acos(k) - Math.acos((rho - drop) / rho))
  }
  const s = shelf + radius
  return { center: [m[0] + s * a[0], m[1] + s * a[1]], radius, open: [-a[0], -a[1]], openCos }
}
