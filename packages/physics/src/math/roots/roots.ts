/**
 * Output buffer shared by the polynomial solvers.
 *
 * Solvers write roots into a caller-owned buffer rather than allocating, so
 * the event loop can reuse one buffer for every collision check.
 *
 * Root k is `re[k] + i*im[k]`, for k < count. Real roots have `im[k] === 0`
 * exactly. Complex roots come in conjugate pairs. Roots are not sorted.
 */
export interface Roots {
  readonly re: Float64Array
  readonly im: Float64Array
  /** Number of roots written: the polynomial's degree after dropping zero leading coefficients. */
  count: number
}

/** Allocates a buffer large enough for any polynomial up to degree 4. */
export function createRoots(): Roots {
  return { re: new Float64Array(4), im: new Float64Array(4), count: 0 }
}

const bits = new Float64Array(1)
const words = new Uint32Array(bits.buffer)
/** Index of the word holding sign and exponent (1 on little-endian hosts). */
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0

/**
 * Smallest power of two that is >= x, for x > 0.
 *
 * Scaling by a power of two is exact in binary floating point, so the solvers
 * can normalize coefficient magnitudes without adding rounding error. Reads
 * the exponent bits directly; subnormal and near-overflow inputs take the
 * slow path.
 */
export function powerOfTwoAtLeast(x: number): number {
  bits[0] = x
  const hi = words[HI]
  const exp = (hi >>> 20) & 0x7ff
  if (exp === 0 || exp >= 0x7fe) return 2 ** Math.ceil(Math.log2(x))
  const isPowerOfTwo = (hi & 0xfffff) === 0 && words[1 - HI] === 0
  words[HI] = (isPowerOfTwo ? exp : exp + 1) << 20
  words[1 - HI] = 0
  return bits[0]
}
