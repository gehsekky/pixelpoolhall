/**
 * Extracts rule-relevant facts from a simulated shot's event list.
 *
 * The physics resolves contact order exactly, so "simultaneous" means
 * numerically simultaneous (within SIMULTANEOUS seconds). WPA 3.2 and 3.3
 * give the shooter the benefit of the doubt when a referee can't tell the
 * order; a simulation always can.
 */
import { MotionState, stateAtTime, type ShotResult, type Trajectories } from "@pixelpoolhall/physics"
import { CUE, type ShotFacts } from "./types.ts"

export const SIMULTANEOUS = 1e-6

type TrajBall = Trajectories["balls"][number]

/**
 * Extreme value of a ball's y coordinate over [ta, tb]. Within a segment the
 * acceleration is constant, so y is a parabola: check both ends and the
 * vertex (where vy changes sign).
 */
export function extremeY(ball: TrajBall, ta: number, tb: number, kind: "min" | "max"): number {
  const pick = kind === "max" ? Math.max : Math.min
  let best = kind === "max" ? -Infinity : Infinity
  const segs = ball.segments
  for (let i = 0; i < segs.length; i++) {
    // Segments starting at tb (e.g. the pocketed state) lie outside the interval.
    if (i > 0 && segs[i]!.t0 >= tb) break
    const a = Math.max(ta, segs[i]!.t0)
    const b = Math.min(tb, i + 1 < segs.length ? segs[i + 1]!.t0 : tb)
    if (b < a) continue
    // Evaluate both ends from this segment (the next one starts after an impulse).
    const seg = { ...ball, segments: [segs[i]!] }
    const sa = stateAtTime(seg, a)
    const sb = stateAtTime(seg, b)
    best = pick(best, sa.r[1], sb.r[1])
    const va = sa.v[1]
    const vb = sb.v[1]
    if (va * vb < 0) best = pick(best, stateAtTime(seg, a + ((b - a) * va) / (va - vb)).r[1])
  }
  return best
}

export function shotFacts(result: ShotResult, traj: Trajectories, headStringY: number): ShotFacts {
  const pocketed: ShotFacts["pocketed"] = []
  const toRail = new Set<string>()
  let firstContactTime = Infinity
  const firstContacts: string[] = []
  let railAfterContact = false

  for (const e of result.events) {
    switch (e.type) {
      case "ball_ball": {
        const [a, b] = e.ids as [string, string]
        if (a !== CUE && b !== CUE) break
        const obj = a === CUE ? b : a
        if (firstContacts.length === 0) {
          firstContactTime = e.time
          firstContacts.push(obj)
        } else if (e.time - firstContactTime <= SIMULTANEOUS && !firstContacts.includes(obj)) {
          firstContacts.push(obj)
        }
        break
      }
      case "ball_linear_cushion":
      case "ball_circular_cushion": {
        const ball = e.ids[0]!
        if (ball !== CUE) toRail.add(ball)
        // WPA 3.3: a cushion hit at the same instant as the first contact counts as after it.
        if (e.time >= firstContactTime - SIMULTANEOUS) railAfterContact = true
        break
      }
      case "ball_pocket":
        pocketed.push({ ball: e.ids[0]!, pocket: e.ids[1]!, time: e.time })
        break
      default:
        break
    }
  }

  const offTable = Object.entries(result.final)
    .filter(([, s]) => s.s === MotionState.offTable)
    .map(([id]) => id)

  // Head string checks use each ball's path while it's on the table.
  const pocketTime = new Map(pocketed.map((p) => [p.ball, p.time]))
  const end = traj.duration
  const byId = new Map(traj.balls.map((b) => [b.id, b]))
  const cue = byId.get(CUE)
  const cueEnd = pocketTime.get(CUE) ?? end
  const cueCrossedHeadString = cue !== undefined && extremeY(cue, 0, cueEnd, "max") >= headStringY
  const cueCrossedHeadStringBeforeContact =
    cue !== undefined && extremeY(cue, 0, Math.min(cueEnd, firstContactTime === Infinity ? end : firstContactTime), "max") >= headStringY
  let firstContactAboveHeadString = false
  if (firstContacts.length > 0) {
    const ball = byId.get(firstContacts[0]!)
    if (ball) firstContactAboveHeadString = stateAtTime(ball, firstContactTime).r[1] < headStringY
  }
  const objectBallsCrossedHeadString = traj.balls
    .filter((b) => b.id !== CUE && stateAtTime(b, 0).r[1] >= headStringY)
    .filter((b) => extremeY(b, 0, pocketTime.get(b.id) ?? end, "min") < headStringY)
    .map((b) => b.id)

  return {
    firstContacts,
    firstContactTime,
    pocketed,
    offTable,
    railAfterContact,
    objectBallsToRail: [...toRail],
    cueCrossedHeadStringBeforeContact,
    cueCrossedHeadString,
    firstContactAboveHeadString,
    objectBallsCrossedHeadString,
  }
}
