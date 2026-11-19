/**
 * Error-free transformations for float64 arithmetic.
 *
 * JavaScript has no fused multiply-add, so exact products are recovered with
 * Veltkamp splitting and Dekker's two-product. These let us evaluate
 * expressions like `b*b - 4*a*c` without catastrophic cancellation, which is
 * exactly where grazing (near-tangent) contacts live.
 *
 * Valid while operands are well inside the float64 range (|x| < ~1e150), which
 * the root solvers guarantee by scaling their inputs first.
 */

/** 2^27 + 1: splits a float64 mantissa into two 26-bit halves. */
const SPLITTER = 134217729

/**
 * Exact product: returns p = fl(a*b) and writes the rounding error to
 * `out[0]`, so that a*b = p + out[0] exactly.
 */
export function twoProduct(a: number, b: number, out: Float64Array): number {
  const p = a * b

  let t = SPLITTER * a
  const ah = t - (t - a)
  const al = a - ah

  t = SPLITTER * b
  const bh = t - (t - b)
  const bl = b - bh

  out[0] = al * bl - (((p - ah * bh) - al * bh) - ah * bl)
  return p
}

const errA = new Float64Array(1)
const errB = new Float64Array(1)

/**
 * a*b - c*d, accurate to about one ulp even when the two products nearly
 * cancel (where the naive expression can lose every significant digit).
 */
export function diffOfProducts(a: number, b: number, c: number, d: number): number {
  const p = twoProduct(a, b, errA)
  const q = twoProduct(c, d, errB)
  // When p and q are close, p - q is exact (Sterbenz); the error terms carry
  // the low-order bits that the plain products rounded away.
  return (p - q) + (errA[0] - errB[0])
}
