import { WPA_9FT } from "@pixelpoolhall/physics"
import { describe, expect, it } from "vitest"
import { layoutFor, placementProblem, rackPositions, spotPosition, SPOT_CONTACT_GAP, SPOT_CUE_GAP, type Point } from "../src/layout.ts"
import { createRng } from "../src/rng.ts"
import { groupOf } from "../src/rules/eight-ball.ts"

const R = 0.028575
const layout = layoutFor(WPA_9FT, R, [])

const minGap = (ps: Point[]) => {
  let m = Infinity
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) m = Math.min(m, Math.hypot(ps[i]![0] - ps[j]![0], ps[i]![1] - ps[j]![1]) - 2 * R)
  return m
}

describe("racks", () => {
  for (let seed = 1; seed <= 50; seed++) {
    it(`8-ball rack ${seed}: WPA 4.2 layout, no overlaps`, () => {
      const rack = rackPositions("8-ball", layout, createRng(seed))
      expect(rack.size).toBe(15)
      const ps = [...rack.values()]
      expect(minGap(ps)).toBeGreaterThan(0)
      expect(minGap(ps)).toBeLessThan(2 * R * 1e-3)
      // Apex ball on the foot spot (within the jitter); the 8 directly below it, in row 3.
      const apex = ps.reduce((a, b) => (b[1] < a[1] ? b : a))
      expect(Math.hypot(apex[0] - layout.footSpot[0], apex[1] - layout.footSpot[1])).toBeLessThan(1e-4)
      const eight = rack.get("8")!
      expect(Math.abs(eight[0] - layout.footSpot[0])).toBeLessThan(1e-4)
      expect(eight[1] - layout.footSpot[1]).toBeCloseTo(2 * Math.sqrt(3) * R, 3)
      // One solid and one stripe on the back corners.
      const back = [...rack].filter(([, p]) => p[1] > layout.footSpot[1] + 3.9 * Math.sqrt(3) * R)
      const corners = back.sort((a, b) => a[1][0] - b[1][0])
      const groups = [groupOf(corners[0]![0]), groupOf(corners.at(-1)![0])].sort()
      expect(groups).toEqual(["solids", "stripes"])
    })
  }

  it("9-ball rack: 1 at the apex toward the head, 9 in the middle on the foot spot (WPA 5.2)", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rack = rackPositions("9-ball", layout, createRng(seed))
      expect(rack.size).toBe(9)
      const ps = [...rack.values()]
      expect(minGap(ps)).toBeGreaterThan(0)
      const nine = rack.get("9")!
      expect(Math.hypot(nine[0] - layout.footSpot[0], nine[1] - layout.footSpot[1])).toBeLessThan(1e-4)
      const one = rack.get("1")!
      expect(Math.min(...ps.map((p) => p[1]))).toBe(one[1])
    }
  })

  it("is reproducible from the seed", () => {
    expect([...rackPositions("8-ball", layout, createRng(7))]).toEqual([...rackPositions("8-ball", layout, createRng(7))])
    expect([...rackPositions("8-ball", layout, createRng(7))]).not.toEqual([...rackPositions("8-ball", layout, createRng(8))])
  })
})

describe("spotting (WPA 1.5)", () => {
  const fs = layout.footSpot

  it("uses the foot spot when free", () => {
    expect(spotPosition(layout, new Map())).toEqual(fs)
  })

  it("places the ball against an interfering ball, toward the foot rail", () => {
    const p = spotPosition(layout, new Map([["3", [fs[0], fs[1]] as Point]]))
    expect(p[0]).toBe(fs[0])
    expect(p[1] - fs[1]).toBeCloseTo(2 * R + SPOT_CONTACT_GAP, 12)
  })

  it("keeps a small separation from the cue ball", () => {
    const p = spotPosition(layout, new Map([["cue", [fs[0] + 0.01, fs[1] + 0.01] as Point]]))
    expect(Math.hypot(p[0] - fs[0] - 0.01, p[1] - fs[1] - 0.01)).toBeCloseTo(2 * R + SPOT_CUE_GAP, 9)
  })

  it("goes above the foot spot when the long string below it is blocked", () => {
    const occ = new Map<string, Point>()
    for (let k = 0; fs[1] + k * 2 * R <= layout.l; k++) occ.set(String(k + 1), [fs[0], fs[1] + k * 2 * R])
    const p = spotPosition(layout, occ)
    expect(p[1]).toBeLessThan(fs[1])
    expect(fs[1] - p[1]).toBeCloseTo(2 * R + SPOT_CONTACT_GAP, 12)
  })
})

describe("cue ball placement (WPA 1.6, 3.10)", () => {
  it("restricts the kitchen to above the head string", () => {
    expect(placementProblem(layout, [0.6, layout.headStringY - 0.01], [], "kitchen")).toBeNull()
    expect(placementProblem(layout, [0.6, layout.headStringY], [], "kitchen")).toMatch(/head string/)
    expect(placementProblem(layout, [0.6, layout.headStringY + 0.5], [], "table")).toBeNull()
  })

  it("rejects overlaps and positions off the playing surface", () => {
    expect(placementProblem(layout, [0.6, 1], [[0.6 + 1.9 * R, 1]], "table")).toMatch(/overlaps/)
    expect(placementProblem(layout, [R / 2, 1], [], "table")).toMatch(/surface/)
  })
})
