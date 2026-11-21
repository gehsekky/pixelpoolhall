/**
 * Carlson's symmetric elliptic integral of the first kind,
 *   R_F(x, y, z) = ½ ∫₀^∞ dt / √((t + x)(t + y)(t + z)),
 * by the duplication theorem with a fifth-order series to finish.
 *
 * Reference (mathematics, no code used): B. C. Carlson, "Numerical
 * computation of real or complex elliptic integrals", Numerical Algorithms 10
 * (1995) 13–26, Section 2 (algorithm for R_F and its error bound).
 */

/** With every |1 − x/A| below this, the truncation error is under ~1e-17 (Carlson's bound r⁶/(4(1−r))). */
const TOLERANCE = 1e-3

/** R_F(x, y, z) for x, y, z ≥ 0, at most one of them zero. */
export function carlsonRF(x: number, y: number, z: number): number {
  for (let i = 0; i < 100; i++) {
    const A = (x + y + z) / 3
    const X = 1 - x / A
    const Y = 1 - y / A
    const Z = -(X + Y)
    if (Math.max(Math.abs(X), Math.abs(Y), Math.abs(Z)) < TOLERANCE) {
      const E2 = X * Y - Z * Z
      const E3 = X * Y * Z
      return (1 - E2 / 10 + E3 / 14 + (E2 * E2) / 24 - (3 * E2 * E3) / 44) / Math.sqrt(A)
    }
    const sx = Math.sqrt(x)
    const sy = Math.sqrt(y)
    const sz = Math.sqrt(z)
    const lambda = sx * sy + sy * sz + sz * sx
    x = (x + lambda) / 4
    y = (y + lambda) / 4
    z = (z + lambda) / 4
  }
  throw new Error("carlsonRF did not converge")
}
