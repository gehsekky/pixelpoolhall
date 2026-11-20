/**
 * Stronge's compliant, frictional, inelastic collision for a sphere against a
 * half-space (W. J. Stronge, "Impact Mechanics", 2nd ed., 2018). The contact
 * is a pair of springs (normal and tangential) whose frequency ratio sets how
 * the tangential velocity evolves through stick and slip phases; the normal
 * phase energy loss is set by the restitution coefficient.
 *
 * Portions adapted from pooltool (https://github.com/ekiefl/pooltool),
 * Copyright Evan Kiefl, Apache License 2.0 (see LICENSES/pooltool-Apache-2.0.txt).
 * Modified: rewritten in TypeScript; slip times found with our Brent solver
 * (pooltool uses SciPy's TOMS 748) to a tighter tolerance.
 */
import { brent } from "../math/brent.ts"

/** numpy.isclose with its default tolerances (rtol 1e-5, atol 1e-8). */
const isClose = (a: number, b: number) => Math.abs(a - b) <= 1e-8 + 1e-5 * Math.abs(b)

const tcShift = (e: number) => (Math.PI / 2) * (1 - 1 / e)
const phaseRestitution = (t: number, wn: number, e: number) => (wn * t) / e + tcShift(e)

/** Tangential spring displacement rate (per unit of v_n0) during initial slip. */
function utInitialSlip(t: number, tc: number, vn0: number, mu: number, eta2: number, wn: number, e: number): number {
  const phase = t <= tc ? wn * t : phaseRestitution(t, wn, e)
  return ((-mu * vn0 * eta2) / wn) * Math.sin(phase)
}

function vtInitialSlip(t: number, tc: number, vt0: number, vn0: number, mu: number, btn: number, wn: number, e: number): number {
  if (t <= tc) return vt0 - mu * btn * vn0 * (1 - Math.cos(wn * t))
  return vt0 - mu * btn * vn0 * (1 - e * Math.cos(phaseRestitution(t, wn, e)))
}

function vtStick(t: number, wt: number, vtStick0: number, utStick0 = 0, tStick = 0): number {
  return wt * utStick0 * Math.sin(wt * (t - tStick)) + vtStick0 * Math.cos(wt * (t - tStick))
}

function stickTimeForInitialSlip(ratio: number, btn: number, mu: number, e: number, eta2: number, tc: number): number {
  let x: number
  let tau: number
  if (ratio <= mu * btn) {
    x = (ratio / mu - btn) / (eta2 - btn)
    tau = (2 / Math.PI) * Math.acos(clamp(x))
  } else {
    x = (ratio / mu - btn) / (eta2 / e - e * btn)
    tau = (2 / Math.PI) * (Math.acos(clamp(x)) - tcShift(e)) * e
  }
  return tc * tau
}

const clamp = (x: number) => Math.min(1, Math.max(-1, x))

/**
 * The time slip resumes: the first upward crossing of f (friction needed to
 * stick, minus friction available) after `from`.
 *
 * f is zero at the instant sticking begins (friction is exactly saturated)
 * and non-positive while the contact sticks, so a bracket starting there can
 * converge to the start of the stick phase instead of its end. pooltool
 * brackets [t_c, t_f] and relies on the solver's path; on 3 of 766 fixture
 * rail hits that path differs between solvers. We sample for the first
 * negative-to-positive sign change and refine it, which always gives the end
 * of the stick phase.
 */
function slipResumes(f: (t: number) => number, from: number, to: number, tol: number): number {
  const steps = 256
  let a = from
  let fa = f(a)
  for (let i = 1; i <= steps; i++) {
    const b = from + ((to - from) * i) / steps
    const fb = i === steps ? f(to) : f(b)
    if (fa < 0 && fb >= 0) return brent(f, a, b, tol)
    a = b
    fa = fb
  }
  return to
}

/**
 * Post-collision tangential and normal contact velocities for an initial
 * contact velocity (v_t0 ≤ 0, v_n0 < 0).
 *
 * @param beta_t, beta_n mass-matrix coefficients (3.5 and 1 for a sphere on a half-space)
 * @param k_n normal stiffness: arbitrary, only the frequency ratio matters
 * @param eta2 normal/tangential stiffness ratio; sets ω_t/ω_n, which must be in (1, 2)
 */
export function resolveCompliantCollision(
  vt0: number, vn0: number, m: number, beta_t: number, beta_n: number, mu: number, e: number, k_n: number, eta2: number,
): { vt: number; vn: number } {
  if (!(vt0 <= 0 && vn0 < 0)) throw new RangeError(`stronge: need v_t0 <= 0 and v_n0 < 0 (got ${vt0}, ${vn0})`)
  const btn = beta_t / beta_n
  const ratio = vt0 / vn0
  const wn = Math.sqrt((beta_n * k_n) / m)
  const wt = wn * Math.sqrt(btn / eta2)
  if (!(wt / wn > 1 && wt / wn < 2)) throw new RangeError("stronge: frequency ratio must be in (1, 2)")
  const tc = Math.PI / (2 * wn)
  const tf = (1 + e) * tc
  // Root-finder tolerance: far below anything that affects the result.
  const tol = 1e-15 * tf

  let vt: number
  if (ratio > mu * ((1 + e) * btn - eta2 / e)) {
    // Gross slip: the contact slips throughout.
    vt = vt0 - mu * vn0 * btn * (1 + e)
  } else if (ratio < mu * eta2) {
    // Stick, then slip.
    let tSlip: number
    if (isClose(ratio, 0)) tSlip = tf
    else if (isClose(ratio, mu * eta2)) tSlip = tc
    else {
      const f = (t: number) =>
        Math.abs(-ratio * Math.sin(wt * t)) - ((mu * eta2 * wt) / wn) * Math.sin(phaseRestitution(t, wn, e))
      tSlip = slipResumes(f, tc, tf, tol)
    }
    vt = vtStick(tSlip, wt, vt0) + mu * vn0 * btn * e * (1 + Math.cos((wn * tSlip) / e + tcShift(e)))
  } else {
    // Slip, stick, then slip.
    const tStick = stickTimeForInitialSlip(ratio, btn, mu, e, eta2, tc)
    const ut = utInitialSlip(tStick, tc, vn0, mu, eta2, wn, e)
    const vtS = vtInitialSlip(tStick, tc, vt0, vn0, mu, btn, wn, e)
    let tSlip: number
    if (isClose(ratio, mu * eta2)) tSlip = tc
    else if (isClose(ratio, mu * ((1 + e) * btn - eta2 / e))) tSlip = tf
    else {
      const f = (t: number) =>
        Math.abs((wn / (mu * vn0)) * (ut * Math.cos(wt * (t - tStick)) - (vtS / wt) * Math.sin(wt * (t - tStick)))) -
        eta2 * Math.sin(phaseRestitution(t, wn, e))
      tSlip = slipResumes(f, Math.max(tc, tStick), tf, tol)
    }
    vt = vtStick(tSlip, wt, vtS, ut, tStick) + btn * mu * vn0 * e * (1 + Math.cos(phaseRestitution(tSlip, wn, e)))
  }
  const vn = e * vn0 * Math.cos(phaseRestitution(tf, wn, e))
  return { vt, vn }
}
