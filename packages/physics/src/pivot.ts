/**
 * A ball tipping over the edge of the pocket cut in the slate.
 *
 * Once its center passes over the edge, the ball is supported by the edge
 * alone and rotates about it, rolling without slipping (moment of inertia
 * about the edge (7/5)mR²). θ is its tilt from vertical, toward the pocket.
 *
 * Motion along the edge: the contact point moves around the edge circle
 * (radius ρ) at the arrival's speed along it, v∥, so the ball follows the
 * curved edge and never sinks into it. Following the curve pulls the ball
 * outward, away from the pocket, with a = v∥²/ρ (taken as constant). In the
 * plane of the tilt the ball is then an inverted pendulum under g down and a
 * outward:
 *   (7/5) R θ̈ = g sin θ − a cos θ = G sin(θ − β),  G = √(g² + a²), tan β = a/g.
 * Energy: Ω² = C + K (1 − cos(θ − β)),  K = (10/7) G / R,
 *   C = Ω0² − K (1 − cos β),  Ω0 = u0 / R,
 * with u0 the center's speed across the edge as it arrives. If C ≤ 0 the
 * ball can't get past θ = β: it rolls back out over the edge (it skims the
 * pocket; see canTip). Otherwise the time to tilt to θ is an elliptic integral:
 *   τ(θ) = T(θ − β) + T(β),  T(φ) = (2/√C) F(φ/2 | −m),  m = 2K / C,
 * with F(ψ | k²) = sin ψ · R_F(cos²ψ, 1 − k² sin²ψ, 1) (Carlson).
 *
 * The edge's push along the ball's radius, per unit mass, is
 *   g cos θ + a sin θ − R Ω²,
 * and the ball leaves the edge where it reaches zero: with no motion along
 * the edge, at cos θs = (10 + 7 u0²/(g R)) / 17, at once if u0² ≥ g R.
 *
 * The pivot is a rigid-body rotation, so an arriving ball rolls (about the
 * edge and along it, plus its spin about the vertical).
 */
import { carlsonRF } from "./math/elliptic.ts"
import type { Vec3 } from "./math/vec3.ts"
import type { BallParams } from "./params.ts"

export interface Pivot {
  /** Center of the edge circle (z = 0) and its radius. */
  center: [number, number]
  rho: number
  /** Angle of the contact point on the circle when it started tipping. */
  phi0: number
  /** Rate the contact point moves around the circle, rad/s. */
  phiDot: number
  /** Center's speed across the edge when it started tipping, m/s. */
  u0: number
  /** Spin about the vertical (constant). */
  wz: number
  /** Time since it started tipping, s. */
  tau: number
  /** Where and when it lets go (see `separation`), cached. */
  release?: { theta: number; tau: number }
}

/** Outward pull of the motion along the curved edge, a = v∥² / ρ. */
const pull = (pv: Pivot) => pv.rho * pv.phiDot * pv.phiDot

/** β, K and C of the pendulum (see above). */
function pendulum(pv: Pivot, p: BallParams): { beta: number; K: number; C: number } {
  const a = pull(pv)
  const beta = Math.atan2(a, p.g)
  const K = ((10 / 7) * Math.hypot(p.g, a)) / p.R
  return { beta, K, C: (pv.u0 / p.R) ** 2 - K * (1 - Math.cos(beta)) }
}

/**
 * Whether a ball arriving at the edge with speed u0 across it and v∥ along
 * it tips over (else it rolls back out over the edge).
 */
export function canTip(pv: Pivot, p: BallParams): boolean {
  return pendulum(pv, p).C > 0
}

/**
 * Cosine of the tilt at which a ball with no motion along the edge leaves it
 * (≥ 1: it doesn't tip at all, it flies off).
 */
export const separationCos = (u0: number, p: BallParams): number => (10 + (7 * u0 * u0) / (p.g * p.R)) / 17

/** Angular speed about the edge at tilt θ. */
function omega(theta: number, pv: Pivot, p: BallParams): number {
  const { beta, K, C } = pendulum(pv, p)
  return Math.sqrt(Math.max(0, C + K * (1 - Math.cos(theta - beta))))
}

/** T(φ) = ∫₀^φ dψ / Ω (odd in φ). */
function T(phi: number, K: number, C: number): number {
  const m = (2 * K) / C
  const psi = phi / 2
  const s = Math.sin(psi)
  return (2 / Math.sqrt(C)) * s * carlsonRF(Math.cos(psi) ** 2, 1 + m * s * s, 1)
}

/** Time to tilt from 0 to θ (needs canTip). */
export function tiltTime(theta: number, pv: Pivot, p: BallParams): number {
  const { beta, K, C } = pendulum(pv, p)
  return T(theta - beta, K, C) + T(beta, K, C)
}

/**
 * Tilt at which the ball leaves the edge, and how long it takes to get
 * there. If the push doesn't reach zero before θ = π/2, the ball slides down
 * the cut's wall (and is caught there).
 */
export function separation(pv: Pivot, p: BallParams): { theta: number; tau: number } {
  if (!pv.release) pv.release = computeSeparation(pv, p)
  return pv.release
}

function computeSeparation(pv: Pivot, p: BallParams): { theta: number; tau: number } {
  const a = pull(pv)
  const push = (theta: number) => p.g * Math.cos(theta) + a * Math.sin(theta) - p.R * omega(theta, pv, p) ** 2
  let theta: number
  if (push(0) <= 0) theta = 0
  else {
    // First zero: scan, then bisect.
    const N = 64
    let lo = 0
    let hi = Math.PI / 2
    for (let i = 1; i <= N; i++) {
      const th = (i / N) * (Math.PI / 2)
      if (push(th) <= 0) {
        hi = th
        break
      }
      lo = th
    }
    if (lo < Math.PI / 2) {
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2
        if (push(mid) > 0) lo = mid
        else hi = mid
      }
    }
    theta = (lo + hi) / 2
  }
  return { theta, tau: tiltTime(theta, pv, p) }
}

/** Tilt after time τ (τ within the pivot), by safeguarded Newton on τ(θ). */
export function tiltAt(tau: number, pv: Pivot, p: BallParams): number {
  const end = separation(pv, p)
  if (tau >= end.tau) return end.theta
  let lo = 0
  let hi = end.theta
  let theta = hi * (tau / end.tau)
  for (let i = 0; i < 60; i++) {
    const f = tiltTime(theta, pv, p) - tau
    if (f > 0) hi = theta
    else lo = theta
    let next = theta - f * omega(theta, pv, p)
    if (!(next > lo && next < hi)) next = (lo + hi) / 2
    if (Math.abs(next - theta) <= 1e-15 * Math.max(1, theta)) return next
    theta = next
  }
  return theta
}

/** Center position, velocity and angular velocity at tilt θ, time τ into the pivot. */
export function pivotKinematics(pv: Pivot, theta: number, tau: number, p: BallParams): { r: Vec3; v: Vec3; w: Vec3 } {
  const phi = pv.phi0 + pv.phiDot * tau
  const cp = Math.cos(phi)
  const sp = Math.sin(phi)
  // Across the edge (into the pocket) n̂ = −(cos φ, sin φ); along it ê = (−sin φ, cos φ).
  const nx = -cp
  const ny = -sp
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  const W = omega(theta, pv, p)
  const R = p.R
  const ex = pv.center[0] + pv.rho * cp
  const ey = pv.center[1] + pv.rho * sp
  const r: Vec3 = [ex + R * s * nx, ey + R * s * ny, R * c]
  // Along the edge the center, R sin θ inside it, moves at (ρ − R sin θ) φ̇.
  const along = (pv.rho - R * s) * pv.phiDot
  const v: Vec3 = [-sp * along + R * W * c * nx, cp * along + R * W * c * ny, -R * W * s]
  // Rolling about the edge (axis ẑ × n̂), rolling along it, and the spin about the vertical.
  const vt = pv.rho * pv.phiDot
  const w: Vec3 = [-W * ny - (cp * vt) / R, W * nx - (sp * vt) / R, pv.wz]
  return { r, v, w }
}
