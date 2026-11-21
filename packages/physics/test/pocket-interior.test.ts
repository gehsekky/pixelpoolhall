/**
 * Pocket interiors (WPA 9-ft table, 3D): the slate cut and shelf, a ball
 * tipping over the edge, the edge and wall in the air, and the physics
 * invariants over many shots into and across pockets. No reference engine
 * models pocket interiors, so these check the geometry against the WPA
 * specification, the pivot against direct integration, the edge search
 * against dense sampling, and conservation laws.
 */
import { describe, expect, it } from "vitest"
import { pocketInteriorTime, PocketEvent } from "../src/detect.ts"
import { simulate, type ShotResult } from "../src/engine.ts"
import { MotionState, type BallState } from "../src/motion.ts"
import { DEFAULT_BALL_PARAMS as P } from "../src/params.ts"
import { canTip, pivotKinematics, separation, separationCos, tiltAt, tiltTime, type Pivot } from "../src/pivot.ts"
import { buildPocketTable, POOLTOOL_7FT, WPA_9FT } from "../src/table-builder.ts"
import type { LinearCushion, Pocket } from "../src/table.ts"

const INCH = 0.0254
const R = P.R
const table = buildPocketTable(WPA_9FT)
const spec = WPA_9FT
const interior = spec.pocketInterior!
const pocket = (id: string) => table.pockets.find((p) => p.id === id)!
const facing = (id: string) => table.linear.find((c) => c.id === id)!

/** Signed distance from (x, y) to a cushion's nose line in the table plane. */
function lineDistance(c: LinearCushion, x: number, y: number): number {
  const dx = c.p2[0] - c.p1[0]
  const dy = c.p2[1] - c.p1[1]
  return Math.abs((x - c.p1[0]) * dy - (y - c.p1[1]) * dx) / Math.hypot(dx, dy)
}

function shoot(from: [number, number], phi: number, V0: number, dim: "2d" | "3d" = "3d", extra: { theta?: number; b?: number } = {}): ShotResult {
  return simulate({
    table,
    balls: [{ id: "cue", params: P, state: { r: [from[0], from[1], R], v: [0, 0, 0], w: [0, 0, 0], s: MotionState.stationary } }],
    cueBall: "cue",
    strike: { V0, phi, theta: extra.theta ?? 0, a: 0, b: extra.b ?? 0 },
    dim,
  })
}
const types = (r: ShotResult) => r.events.map((e) => e.type)

describe("pocket geometry (WPA 9-ft)", () => {
  const pc = spec.cornerPocketWidth / Math.SQRT2
  const drop = spec.cushionHeight * Math.tan((interior.backDraft * Math.PI) / 180)
  const cases: [string, [number, number], number, [string, string]][] = [
    ["lb", [pc / 2, pc / 2], interior.cornerShelf, ["1", "2"]],
    ["rt", [spec.w - pc / 2, spec.l - pc / 2], interior.cornerShelf, ["10", "11"]],
    ["lc", [0, spec.l / 2], interior.sideShelf, ["4", "5"]],
    ["rc", [spec.w, spec.l / 2], interior.sideShelf, ["13", "14"]],
  ]

  it("the slate cut sits the WPA shelf behind the middle of the mouth (corner 1⅝ in, side 3⁄16 in)", () => {
    for (const [id, mouth, shelf] of cases) {
      const p = pocket(id)
      const near = [p.center[0] + p.radius * p.interior!.open[0], p.center[1] + p.radius * p.interior!.open[1]]
      expect(Math.hypot(near[0]! - mouth[0], near[1]! - mouth[1]), id).toBeCloseTo(shelf, 12)
    }
  })

  it("is tangent to both facings where they meet the slate (back draft 13.5°), and wide enough for a ball", () => {
    for (const [id, , , facings] of cases) {
      const p = pocket(id)
      for (const f of facings) expect(lineDistance(facing(f), p.center[0], p.center[1]) + drop, `${id}/${f}`).toBeCloseTo(p.radius, 12)
      expect(p.radius).toBeGreaterThan(1.8 * R)
    }
    // Corner cut about 4.3 in across, side about 4.5 in.
    expect((2 * pocket("lb").radius) / INCH).toBeCloseTo(4.29, 1)
    expect((2 * pocket("lc").radius) / INCH).toBeCloseTo(4.47, 1)
  })

  it("is open toward the table up to where the circle passes under the facings' noses", () => {
    for (const [id, , , facings] of cases) {
      const p = pocket(id)
      const { open, openCos } = p.interior!
      const s = Math.sqrt(1 - openCos * openCos)
      const ends = [1, -1].map((k) => [p.center[0] + p.radius * (openCos * open[0] - k * s * open[1]), p.center[1] + p.radius * (openCos * open[1] + k * s * open[0])])
      for (const e of ends) expect(Math.min(...facings.map((f) => lineDistance(facing(f), e[0]!, e[1]!))), id).toBeLessThan(1e-12)
    }
  })

  it("pooltool's table keeps its capture circles (the reference fixtures are unchanged)", () => {
    expect(buildPocketTable(POOLTOOL_7FT).pockets.every((p) => !p.interior)).toBe(true)
  })
})

describe("tipping over the edge", () => {
  const pv = (u0: number, along = 0): Pivot => ({ center: [0, 0], rho: 0.055, phi0: 0, phiDot: along / 0.055, u0, wz: 0, tau: 0 })

  it("the time to tilt matches direct integration of dθ/Ω", () => {
    for (const [u0, along] of [[0.05, 0], [0.3, 0], [0.5, 0.3], [0.2, 0.5]] as const) {
      const p = pv(u0, along)
      if (!canTip(p, P)) continue
      const end = separation(p, P).theta
      // Ω from energy, integrated with the composite Simpson rule.
      const a = (along * along) / 0.055
      const beta = Math.atan2(a, P.g)
      const K = ((10 / 7) * Math.hypot(P.g, a)) / R
      const C = (u0 / R) ** 2 - K * (1 - Math.cos(beta))
      const f = (th: number) => 1 / Math.sqrt(C + K * (1 - Math.cos(th - beta)))
      const N = 20000
      const h = end / N
      let sum = f(0) + f(end)
      for (let i = 1; i < N; i++) sum += (i % 2 ? 4 : 2) * f(i * h)
      expect(tiltTime(end, p, P), `${u0}/${along}`).toBeCloseTo((sum * h) / 3, 9)
      // And the inverse.
      for (const frac of [0.1, 0.5, 0.9]) expect(tiltAt(tiltTime(frac * end, p, P), p, P)).toBeCloseTo(frac * end, 10)
    }
  })

  it("without motion along the edge, the ball lets go at cos θ = (10 + 7u²/gR)/17, conserving energy", () => {
    for (const u0 of [0.02, 0.2, 0.4]) {
      const p = pv(u0)
      const { theta, tau } = separation(p, P)
      expect(Math.cos(theta)).toBeCloseTo(separationCos(u0, P), 9)
      const energy = (t: number) => {
        const k = pivotKinematics(p, tiltAt(t, p, P), t, P)
        const v2 = k.v[0] ** 2 + k.v[1] ** 2 + k.v[2] ** 2
        const w2 = k.w[0] ** 2 + k.w[1] ** 2 + k.w[2] ** 2
        return 0.5 * v2 + 0.2 * R * R * w2 + P.g * k.r[2]
      }
      for (const t of [0.3 * tau, 0.7 * tau, tau]) expect(energy(t)).toBeCloseTo(energy(0), 10)
    }
    // Fast enough across the edge (u² ≥ gR), it doesn't tip at all: it flies off.
    expect(separationCos(Math.sqrt(P.g * R), P)).toBeCloseTo(1, 12)
  })

  it("a ball moving mostly along the edge can't tip in: it skims past", () => {
    expect(canTip(pv(0.3, 0), P)).toBe(true)
    expect(canTip(pv(0.05, 1.5), P)).toBe(false)
  })
})

describe("balls into a corner pocket (3D)", () => {
  const into = (V0: number, b = 0) => shoot([0.3, 0.3], 225, V0, "3d", { b })

  it("straight in at any speed: slow balls tip over the edge, fast ones fly to the back and drop", () => {
    for (const V0 of [0.26, 0.35, 0.5, 0.7, 1, 2, 4, 7]) {
      const res = into(V0)
      expect(res.final.cue!.s, `V0=${V0}`).toBe(MotionState.pocketed)
      expect(types(res)).toContain("ball_drop")
      expect(types(res).includes("pivoting_airborne"), `V0=${V0}`).toBe(V0 < 0.6)
    }
  })

  it("too slow, it stops on the shelf, past the mouth but short of the drop", () => {
    let lo = 0.2
    let hi = 0.4
    const drops = (V0: number) => types(into(V0)).includes("ball_drop")
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2
      if (drops(m)) hi = m
      else lo = m
    }
    const f = into(lo * 0.999).final.cue!
    const p = pocket("lb")
    expect(f.s).toBe(MotionState.stationary)
    expect(f.r[2]).toBe(R)
    expect(Math.hypot(f.r[0] - p.center[0], f.r[1] - p.center[1])).toBeGreaterThan(p.radius)
    // Past the mouth line x + y = pc by more than an inch.
    const pc = spec.cornerPocketWidth / Math.SQRT2
    expect((pc - f.r[0] - f.r[1]) / Math.SQRT2).toBeGreaterThan(INCH)
  })

  it("in 2D the cut is the capture circle", () => {
    const res = shoot([0.3, 0.3], 225, 0.5, "2d")
    expect(res.final.cue!.s).toBe(MotionState.pocketed)
    expect(types(res)).not.toContain("ball_drop")
  })
})

describe("across a side pocket (3D)", () => {
  it("a ball moving mostly along the edge skims over it and stays on the table", () => {
    const res = shoot([0.4944432493722523, 1.1536637830515386], 171.45, 0.6)
    expect(types(res)).toContain("ball_drop")
    expect(res.final.cue!.s).toBe(MotionState.stationary)
  })

  it("a fast ball can drop over the edge, hit the far side, and climb back out", () => {
    const res = shoot([0.2511327665716863, 0.8376432797399225], 120.15, 4)
    expect(types(res).slice(0, 4)).toEqual(["none", "stick_ball", "ball_drop", "ball_linear_cushion"])
    expect(types(res)).toContain("ball_pocket_edge")
    expect(res.final.cue!.s).toBe(MotionState.stationary)
  })
})

describe("edge detection in the air", () => {
  // Independent distance from a point to the open edge arc.
  function gapToEdge(p: Pocket, x: number, y: number, z: number): number {
    const { open, openCos } = p.interior!
    const dx = x - p.center[0]
    const dy = y - p.center[1]
    // Nearest point of the arc: the point's own angle, clamped to the arc.
    const half = Math.acos(openCos)
    const a0 = Math.atan2(open[1], open[0])
    let rel = Math.atan2(dy, dx) - a0
    rel = Math.atan2(Math.sin(rel), Math.cos(rel))
    const a = a0 + Math.max(-half, Math.min(half, rel))
    return Math.hypot(dx - p.radius * Math.cos(a), dy - p.radius * Math.sin(a), z) - R
  }

  it("never misses a contact that dense sampling finds, and reports it at the contact", () => {
    const p = pocket("lb")
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    let contacts = 0
    for (let k = 0; k < 400; k++) {
      // A ball over the cut, low, moving any way.
      const ang = rnd() * 2 * Math.PI
      const rad = rnd() * (p.radius - R)
      const b: BallState = {
        r: [p.center[0] + rad * Math.cos(ang), p.center[1] + rad * Math.sin(ang), R * (0.3 + 0.9 * rnd())],
        v: [(rnd() - 0.5) * 3, (rnd() - 0.5) * 3, (rnd() - 0.3) * 1],
        w: [0, 0, 0],
        s: MotionState.airborne,
      }
      if (gapToEdge(p, b.r[0], b.r[1], b.r[2]) < 1e-4) continue
      const ev = pocketInteriorTime(b, P, p)
      const at = (t: number) => [b.r[0] + b.v[0] * t, b.r[1] + b.v[1] * t, b.r[2] + b.v[2] * t - 0.5 * P.g * t * t] as const
      let dense = Infinity
      for (let t = 0; t < Math.min(ev.time, 0.2); t += 1e-5) {
        if (gapToEdge(p, ...at(t)) < -1e-6) {
          dense = t
          break
        }
      }
      expect(dense, `case ${k}`).toBe(Infinity)
      if (ev.kind === PocketEvent.edge) {
        contacts++
        expect(Math.abs(gapToEdge(p, ...at(ev.time)))).toBeLessThan(2e-6)
      }
    }
    expect(contacts).toBeGreaterThan(30)
  })
})

describe("invariants over shots into and across pockets", () => {
  // Shots from all around aimed at points across every pocket mouth, at five speeds, plus breaks.
  const shots: ShotResult[] = []
  for (const p of table.pockets) {
    const mouth: [number, number] = [p.center[0] + (p.radius + 0.03) * p.interior!.open[0], p.center[1] + (p.radius + 0.03) * p.interior!.open[1]]
    const base = Math.atan2(p.interior!.open[1], p.interior!.open[0])
    for (const V0 of [0.4, 0.8, 1.5, 3, 6]) {
      for (let k = -6; k <= 6; k++) {
        const ang = base + (k / 6) * 1.2
        const from: [number, number] = [mouth[0] + 0.5 * Math.cos(ang), mouth[1] + 0.5 * Math.sin(ang)]
        if (from[0] < 0.05 || from[0] > spec.w - 0.05 || from[1] < 0.05 || from[1] > spec.l - 0.05) continue
        const target: [number, number] = [mouth[0] - 0.02 * Math.sin(ang) * (k % 3), mouth[1] + 0.02 * Math.cos(ang) * (k % 3)]
        shots.push(shoot(from, (Math.atan2(target[1] - from[1], target[0] - from[0]) * 180) / Math.PI, V0, "3d", { b: (k % 3) * 0.2 }))
      }
    }
  }

  it("covers drops, pivots, edge hits, skims and captures", () => {
    const all = new Set(shots.flatMap(types))
    for (const t of ["ball_drop", "pivoting_airborne", "ball_pocket_edge", "ball_pocket"]) expect(all).toContain(t)
    console.log(`${shots.length} shots, ${shots.filter((s) => s.final.cue!.s === MotionState.pocketed).length} pocketed`)
  })

  it("mechanical energy never increases; no ball is below the slate outside a cut; all end at rest in few events", () => {
    const bad: string[] = []
    shots.forEach((res, k) => {
      let last = Infinity
      for (const e of res.events) {
        const s = e.states.cue
        if (!s || e.type === "stick_ball") {
          if (s) last = Infinity
          continue
        }
        const energy = s.s === MotionState.pocketed || s.s === MotionState.offTable ? -Infinity
          : 0.5 * (s.v[0] ** 2 + s.v[1] ** 2 + s.v[2] ** 2) + 0.2 * R * R * (s.w[0] ** 2 + s.w[1] ** 2 + s.w[2] ** 2) + P.g * (s.r[2] - R)
        if (energy > last * (1 + 1e-9) + 1e-12) bad.push(`shot ${k} ${e.type}@${e.time}: energy ${last} -> ${energy}`)
        if (last === Infinity || energy !== -Infinity) last = energy
        const overCut = table.pockets.some((p) => Math.hypot(s.r[0] - p.center[0], s.r[1] - p.center[1]) <= p.radius + 1e-9)
        if (s.s !== MotionState.pocketed && s.r[2] < R - 1e-9 && !overCut) bad.push(`shot ${k} ${e.type}@${e.time}: under the slate`)
      }
      const f = res.final.cue!
      if (![MotionState.stationary, MotionState.pocketed, MotionState.offTable].includes(f.s as 0 | 4 | 6)) bad.push(`shot ${k}: ends in state ${f.s}`)
      if (res.truncated || res.events.length > 100) bad.push(`shot ${k}: ${res.events.length} events`)
    })
    expect(bad.slice(0, 10)).toEqual([])
  })
})
