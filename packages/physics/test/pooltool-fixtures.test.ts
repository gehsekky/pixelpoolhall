/**
 * Checks on the pooltool reference fixtures themselves, before our engine
 * consumes them:
 * - integrity: schema, ordering, coverage of every 2D event type;
 * - pooltool's contact conventions, which our engine must reproduce to match
 *   it event for event (balls and jaws resolved 1 µm apart, rails modeled as a
 *   nose cylinder at cushion height);
 * - physical invariants that any correct simulation satisfies (motion-state
 *   kinematics, no energy gain, no overlaps, balls at rest at the end).
 * The invariants will be reused on our own engine's output.
 */
import { describe, expect, it } from "vitest"
import {
  FIXTURE_SCHEMA,
  loadFixtures,
  MotionState,
  type BallParams,
  type BallState,
  type FixtureEvent,
  type LinearCushion,
  type Vec3,
} from "./support/pooltool-fixtures.ts"

const files = loadFixtures()
const shots = files.flatMap((f) => f.shots.map((shot) => ({ file: f, shot })))
const table = files[0]!.table

/** pooltool's const.MIN_DIST: the gap it leaves between bodies after resolving a contact. */
const MIN_DIST = 1e-6

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const hypot2 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Distance from p to the infinite line through the cushion's p1, p2 (in 3D). */
function distanceToLine(p: Vec3, c: LinearCushion): number {
  const d = sub(c.p2, c.p1)
  return norm(cross(sub(p, c.p1), d)) / norm(d)
}

function kineticEnergy({ rvw: [, v, w] }: BallState, { m, R }: BallParams): number {
  return 0.5 * m * dot(v, v) + 0.5 * (2 / 5) * m * R * R * dot(w, w)
}

/** Collects violations so a failure lists every offending shot, not just the first. */
function violations(check: (shot: (typeof shots)[number], report: (msg: string) => void) => void): string[] {
  const out: string[] = []
  for (const s of shots) check(s, (msg) => out.push(`${s.file.category}/${s.shot.name}: ${msg}`))
  return out
}

describe("pooltool fixtures: integrity", () => {
  it("all files share the schema, generator, engine and table", () => {
    expect(files.length).toBeGreaterThanOrEqual(7)
    for (const f of files) {
      expect(f.schema).toBe(FIXTURE_SCHEMA)
      expect(f.generator).toEqual(files[0]!.generator)
      expect(f.engine).toEqual(files[0]!.engine)
      expect(f.table).toEqual(table)
      expect(f.engine.is_3d).toBe(false)
    }
  })

  it("events start with the strike and are in time order", () => {
    expect(violations(({ shot }, report) => {
      const strike = shot.events.find((e) => e.type !== "none")
      if (strike?.type !== "stick_ball" || strike.time !== 0) report("first event is not a strike at t=0")
      for (let i = 1; i < shot.events.length; i++) {
        if (shot.events[i]!.time < shot.events[i - 1]!.time) report(`event ${i} goes back in time`)
      }
    })).toEqual([])
  })

  it("covers every 2D event type and motion state", () => {
    const types = new Set(shots.flatMap(({ shot }) => shot.events.map((e) => e.type)))
    for (const t of ["stick_ball", "ball_ball", "ball_linear_cushion", "ball_circular_cushion", "ball_pocket",
      "sliding_rolling", "rolling_spinning", "rolling_stationary", "spinning_stationary"] as const) {
      expect(types, t).toContain(t)
    }
    const states = new Set(shots.flatMap(({ shot }) => shot.events.flatMap((e) => Object.values(e.states).map((s) => s.s))))
    for (const s of [0, 1, 2, 3, 4]) expect(states, `state ${s}`).toContain(s)
  })

  it("each ball's final state is its last event state (or its initial one)", () => {
    expect(violations(({ shot }, report) => {
      for (const ball of shot.balls) {
        const last = shot.events.findLast((e) => e.states[ball.id])?.states[ball.id] ?? ball
        if (JSON.stringify(last.rvw[0]) !== JSON.stringify(shot.final[ball.id]!.rvw[0])) report(`${ball.id} final position differs`)
      }
    })).toEqual([])
  })
})

describe("pooltool fixtures: contact conventions", () => {
  const linear = new Map(table.linear.map((c) => [c.id, c]))
  const circular = new Map(table.circular.map((c) => [c.id, c]))
  const pockets = new Map(table.pockets.map((p) => [p.id, p]))
  const tol = 1e-12

  function eachEvent(type: FixtureEvent["type"], fn: (e: FixtureEvent, R: number, report: (m: string) => void) => void) {
    let n = 0
    const v = violations(({ shot }, report) => {
      for (const e of shot.events) {
        if (e.type !== type) continue
        n++
        fn(e, shot.balls[0]!.params.R, (m) => report(`t=${e.time} ${m}`))
      }
    })
    expect(n).toBeGreaterThan(0)
    expect(v).toEqual([])
  }

  it("ball-ball: centers 2R + MIN_DIST apart", () => {
    eachEvent("ball_ball", (e, R, report) => {
      const [a, b] = e.ids.map((id) => e.states[id]!.rvw[0])
      const gap = norm(sub(a!, b!)) - 2 * R
      if (Math.abs(gap - MIN_DIST) > tol) report(`gap ${gap}`)
    })
  })

  it("straight rail: center R + nose radius + MIN_DIST from the nose line, in 3D", () => {
    eachEvent("ball_linear_cushion", (e, R, report) => {
      const c = linear.get(e.ids[1]!)!
      const gap = distanceToLine(e.states[e.ids[0]!]!.rvw[0], c) - R - c.nose_radius
      if (Math.abs(gap - MIN_DIST) > tol) report(`gap ${gap}`)
    })
  })

  it("jaw: center radius + R + MIN_DIST from the jaw axis, in the table plane", () => {
    eachEvent("ball_circular_cushion", (e, R, report) => {
      const c = circular.get(e.ids[1]!)!
      const gap = hypot2(e.states[e.ids[0]!]!.rvw[0], c.center) - c.radius - R
      if (Math.abs(gap - MIN_DIST) > tol) report(`gap ${gap}`)
    })
  })

  it("pocket: ball moved to the pocket center at -depth, at rest, state pocketed", () => {
    eachEvent("ball_pocket", (e, _R, report) => {
      const p = pockets.get(e.ids[1]!)!
      const s = e.states[e.ids[0]!]!
      const [r, v, w] = s.rvw
      if (s.s !== MotionState.pocketed) report(`state ${s.s}`)
      if (r[0] !== p.center[0] || r[1] !== p.center[1] || r[2] !== -p.depth) report(`position ${r}`)
      if (norm(v) !== 0 || norm(w) !== 0) report("still moving")
    })
  })
})

describe("pooltool fixtures: physical invariants", () => {
  it("post-event states satisfy their motion state's kinematics", () => {
    expect(violations(({ shot }, report) => {
      const R = shot.balls[0]!.params.R
      for (const e of shot.events) {
        for (const [id, { rvw: [, v, w], s }] of Object.entries(e.states)) {
          const speed = norm(v)
          // Contact-point velocity relative to the cloth: v + w x (-R z)
          // = (vx - R wy, vy + R wx).
          const slip = Math.hypot(v[0] - R * w[1], v[1] + R * w[0])
          const scale = Math.max(1e-3, speed)
          const bad =
            (s === MotionState.stationary && (speed !== 0 || norm(w) !== 0)) ||
            (s === MotionState.spinning && (speed !== 0 || w[0] !== 0 || w[1] !== 0)) ||
            (s === MotionState.rolling && slip > 1e-9 * scale) ||
            (s === MotionState.sliding && slip === 0)
          if (bad) report(`${e.type} t=${e.time} ${id} state ${s}: |v|=${speed} slip=${slip}`)
        }
      }
    })).toEqual([])
  })

  it("total kinetic energy never increases after the strike", () => {
    // Tracking each ball's last known state overestimates energy between that
    // ball's events (friction only removes energy), so the running total is a
    // valid upper bound and must be non-increasing.
    expect(violations(({ shot }, report) => {
      const params = new Map(shot.balls.map((b) => [b.id, b.params]))
      const energy = new Map<string, number>()
      let total = Infinity
      for (const e of shot.events) {
        for (const [id, st] of Object.entries(e.states)) energy.set(id, kineticEnergy(st, params.get(id)!))
        if (e.type === "stick_ball" || e.type === "none") {
          if (e.type === "stick_ball") total = [...energy.values()].reduce((a, b) => a + b, 0)
          continue
        }
        const now = [...energy.values()].reduce((a, b) => a + b, 0)
        if (now > total * (1 + 1e-12)) report(`${e.type} at t=${e.time}: energy rose ${total} -> ${now}`)
        total = now
      }
    })).toEqual([])
  })

  it("every shot ends at rest with no overlapping balls", () => {
    expect(violations(({ shot }, report) => {
      const R = shot.balls[0]!.params.R
      const onTable = Object.entries(shot.final).filter(([, b]) => b.s !== MotionState.pocketed)
      for (const [id, b] of Object.entries(shot.final)) {
        if (b.s !== MotionState.stationary && b.s !== MotionState.pocketed) report(`${id} ends in state ${b.s}`)
      }
      for (let i = 0; i < onTable.length; i++) {
        for (let j = i + 1; j < onTable.length; j++) {
          const d = norm(sub(onTable[i]![1].rvw[0], onTable[j]![1].rvw[0]))
          if (d < 2 * R) report(`${onTable[i]![0]} and ${onTable[j]![0]} overlap by ${2 * R - d}`)
        }
      }
    })).toEqual([])
  })
})
