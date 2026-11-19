/**
 * Generators for quartic test families. All are seeded and deterministic.
 */
import { coeffsFromRoots, rng } from "./metrics.ts"

export interface Case {
  name: string
  coeffs: number[] // highest degree first
}

type Gen = (rand: () => number) => number[]

/** Log-uniform magnitude in [10^lo, 10^hi] with random sign. */
function logUniform(rand: () => number, lo: number, hi: number): number {
  const mag = 10 ** (lo + (hi - lo) * rand())
  return rand() < 0.5 ? -mag : mag
}

const real = (re: number) => ({ re, im: 0 })
const pair = (re: number, im: number) => [
  { re, im },
  { re, im: -im },
]

export const families: Record<string, Gen> = {
  /** Four real roots spread over six orders of magnitude. */
  "4 real, spread": (r) =>
    coeffsFromRoots([0, 0, 0, 0].map(() => real(logUniform(r, -3, 3)))),

  /** Two real roots and a complex pair. */
  "2 real + pair": (r) =>
    coeffsFromRoots([
      real(logUniform(r, -3, 3)),
      real(logUniform(r, -3, 3)),
      ...pair(logUniform(r, -3, 3), Math.abs(logUniform(r, -3, 3))),
    ]),

  /** Two complex pairs. */
  "2 pairs": (r) =>
    coeffsFromRoots([
      ...pair(logUniform(r, -3, 3), Math.abs(logUniform(r, -3, 3))),
      ...pair(logUniform(r, -3, 3), Math.abs(logUniform(r, -3, 3))),
    ]),

  /** Coefficients uniform in [-1, 1], leading coefficient included. */
  "uniform coefficients": (r) => [0, 0, 0, 0, 0].map(() => 2 * r() - 1),

  /** Coefficients log-uniform over 20 orders of magnitude. */
  "wild coefficients": (r) => [0, 0, 0, 0, 0].map(() => logUniform(r, -10, 10)),

  /** Two real roots separated by a relative gap of 1e-3 to 1e-7. */
  "close real pair": (r) => {
    const x = logUniform(r, -2, 2)
    const gap = Math.abs(x) * 10 ** (-3 - 4 * r())
    return coeffsFromRoots([real(x), real(x + gap), real(logUniform(r, -2, 2)), real(logUniform(r, -2, 2))])
  },

  /** Roots near 1e+60 and 1e-60 scales (coefficients reach 1e±240; tests scaling). */
  "extreme scale": (r) => {
    const s = 10 ** (r() < 0.5 ? 60 : -60)
    return coeffsFromRoots([0, 0, 0, 0].map(() => real(s * logUniform(r, -1, 1))))
  },

  /**
   * Ball-ball collision quartics: two balls with parabolic trajectories
   * (sliding/rolling deceleration), distance equal to 2R.
   */
  "ball-ball collision": (r) => {
    const R = 0.028575
    const g = 9.81
    const mu = r() < 0.5 ? 0.2 : 0.01
    const traj = () => {
      const angle = 2 * Math.PI * r()
      const speed = 0.05 + 5 * r()
      const decel = mu * g
      const accAngle = angle + Math.PI + (r() - 0.5) // roughly opposing motion
      return {
        p0: [2.5 * r(), 1.25 * r()],
        v: [speed * Math.cos(angle), speed * Math.sin(angle)],
        a: [0.5 * decel * Math.cos(accAngle), 0.5 * decel * Math.sin(accAngle)],
      }
    }
    const A = traj()
    const B = traj()
    // relative polynomial r(t) = C + B t + A t^2 per axis
    const Cx = A.p0[0]! - B.p0[0]!, Cy = A.p0[1]! - B.p0[1]!
    const Bx = A.v[0]! - B.v[0]!, By = A.v[1]! - B.v[1]!
    const Ax = A.a[0]! - B.a[0]!, Ay = A.a[1]! - B.a[1]!
    return [
      Ax * Ax + Ay * Ay,
      2 * (Ax * Bx + Ay * By),
      Bx * Bx + By * By + 2 * (Ax * Cx + Ay * Cy),
      2 * (Bx * Cx + By * Cy),
      Cx * Cx + Cy * Cy - 4 * R * R,
    ]
  },
}

export function generate(family: string, count: number, seed: number): Case[] {
  const gen = families[family]!
  const rand = rng(seed)
  const out: Case[] = []
  for (let i = 0; i < count; i++) out.push({ name: `${family} #${i}`, coeffs: gen(rand) })
  return out
}

export const cubicFamilies: Record<string, Gen> = {
  "3 real, spread": (r) => coeffsFromRoots([0, 0, 0].map(() => real(logUniform(r, -3, 3)))),
  "1 real + pair": (r) =>
    coeffsFromRoots([real(logUniform(r, -3, 3)), ...pair(logUniform(r, -3, 3), Math.abs(logUniform(r, -3, 3)))]),
  "uniform coefficients": (r) => [0, 0, 0, 0].map(() => 2 * r() - 1),
  "wild coefficients": (r) => [0, 0, 0, 0].map(() => logUniform(r, -10, 10)),
  "close real pair": (r) => {
    const x = logUniform(r, -2, 2)
    const gap = Math.abs(x) * 10 ** (-3 - 4 * r())
    return coeffsFromRoots([real(x), real(x + gap), real(logUniform(r, -2, 2))])
  },
  "extreme scale": (r) => {
    const s = 10 ** (r() < 0.5 ? 80 : -80)
    return coeffsFromRoots([0, 0, 0].map(() => real(s * logUniform(r, -1, 1))))
  },
}

export function generateFrom(set: Record<string, Gen>, family: string, count: number, seed: number): Case[] {
  const gen = set[family]!
  const rand = rng(seed)
  const out: Case[] = []
  for (let i = 0; i < count; i++) out.push({ name: `${family} #${i}`, coeffs: gen(rand) })
  return out
}
