/**
 * The table builder must reproduce pooltool's geometry exactly from the same
 * specs (recorded in the fixtures), and an engine run on the built table must
 * match the fixtures.
 */
import { describe, expect, it } from "vitest"
import { buildPocketTable, POOLTOOL_7FT, type TableSpec } from "../src/table-builder.ts"
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
