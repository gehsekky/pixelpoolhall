/**
 * The table builder must reproduce pooltool's geometry exactly from the same
 * specs (recorded in the fixtures), and an engine run on the built table must
 * match the fixtures.
 */
import { describe, expect, it } from "vitest"
import { buildPocketTable, POOLTOOL_7FT, WPA_9FT, type TableSpec } from "../src/table-builder.ts"
import { toTable } from "./support/fixture-convert.ts"
import { loadFixtures } from "./support/pooltool-fixtures.ts"

const file = loadFixtures()[0]!
const s = file.table.specs as Record<string, number>
const specFromFixture: TableSpec = {
  l: s.l!,
  w: s.w!,
  cushionWidth: s.cushion_width!,
  cushionHeight: s.cushion_height!,
  cushionNoseRadius: s.cushion_nose_radius!,
  cornerPocketWidth: s.corner_pocket_width!,
  cornerPocketAngle: s.corner_pocket_angle!,
  cornerPocketDepth: s.corner_pocket_depth!,
  cornerPocketRadius: s.corner_pocket_radius!,
  cornerJawRadius: s.corner_jaw_radius!,
  sidePocketWidth: s.side_pocket_width!,
  sidePocketAngle: s.side_pocket_angle!,
  sidePocketDepth: s.side_pocket_depth!,
  sidePocketRadius: s.side_pocket_radius!,
  sideJawRadius: s.side_jaw_radius!,
}

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id))

describe("table builder", () => {
  it("POOLTOOL_7FT equals the specs recorded in the fixtures", () => {
    expect(POOLTOOL_7FT).toEqual(specFromFixture)
  })

  it("reproduces pooltool's rails, jaws and pockets bit for bit", () => {
    const built = buildPocketTable(specFromFixture)
    const ref = toTable(file)
    expect(byId(built.linear)).toEqual(byId(ref.linear))
    expect(byId(built.circular)).toEqual(byId(ref.circular))
    expect(byId(built.pockets)).toEqual(byId(ref.pockets))
  })
})

describe("WPA 9-ft preset", () => {
  const t = buildPocketTable(WPA_9FT)
  const get = (id: string) => t.linear.find((c) => c.id === id)!
  /** Interior angle (degrees) at the lip between a rail's nose and a facing. */
  const lipAngle = (railDir: [number, number], facingId: string) => {
    const f = get(facingId)
    // Facing direction pointing away from the playing surface (from its jaw end to its far end).
    const d: [number, number] = [f.p1[0] - f.p2[0], f.p1[1] - f.p2[1]]
    const cos = (railDir[0] * d[0] + railDir[1] * d[1]) / Math.hypot(...railDir) / Math.hypot(...d)
    return (Math.acos(cos) * 180) / Math.PI
  }

  it("has the WPA playing surface and pocket mouths", () => {
    expect(WPA_9FT.l).toBeCloseTo(2.54, 12)
    expect(WPA_9FT.w).toBeCloseTo(1.27, 12)
    expect(WPA_9FT.cornerPocketWidth / 0.0254).toBeGreaterThanOrEqual(4.5)
    expect(WPA_9FT.cornerPocketWidth / 0.0254).toBeLessThanOrEqual(4.625)
    expect(WPA_9FT.sidePocketWidth / 0.0254).toBeGreaterThanOrEqual(5)
    expect(WPA_9FT.sidePocketWidth / 0.0254).toBeLessThanOrEqual(5.125)
  })

  it("builds facing cut angles within the WPA tolerance (142° corner, 104° side, ±1°)", () => {
    // Corner facing 1 meets the head rail (18, along +x) at the lip.
    expect(Math.abs(lipAngle([1, 0], "1") - 142)).toBeLessThan(1e-9)
    // Side facing 4 meets long rail 3 (running toward −y from the lip).
    expect(Math.abs(lipAngle([0, -1], "4") - 104)).toBeLessThan(1)
  })
})
