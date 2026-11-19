/**
 * Exact rational arithmetic (BigInt) used as ground truth for the root
 * solvers.
 *
 * Every float64 is an exact dyadic rational, so a polynomial whose
 * coefficients are float64s has exactly defined roots. Using Sturm sequences
 * and bisection in exact arithmetic, we isolate and refine those real roots to
 * any precision, then measure the solvers' error against them. No floating
 * point is involved in computing the reference.
 *
 * Test-only code: correctness matters here, not speed.
 */

export interface Rat {
  readonly n: bigint
  readonly d: bigint // always > 0
}

const ZERO: Rat = { n: 0n, d: 1n }

function babs(x: bigint): bigint {
  return x < 0n ? -x : x
}

function gcd(a: bigint, b: bigint): bigint {
  a = babs(a)
  b = babs(b)
  while (b !== 0n) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

export function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new Error("division by zero")
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = gcd(n, d)
  return g > 1n ? { n: n / g, d: d / g } : { n, d }
}

/** The exact value of a finite float64. */
export function fromNumber(x: number): Rat {
  if (!Number.isFinite(x)) throw new Error(`not finite: ${x}`)
  if (x === 0) return ZERO
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const hi = view.getUint32(0)
  const lo = view.getUint32(4)
  const sign = hi >>> 31 ? -1n : 1n
  const exp = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let e: number
  if (exp === 0) {
    e = -1074
  } else {
    mant |= 1n << 52n
    e = exp - 1075
  }
  return e >= 0 ? rat(sign * mant * (1n << BigInt(e))) : rat(sign * mant, 1n << BigInt(-e))
}

export const add = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d)
export const sub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d)
export const mul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d)
export const div = (a: Rat, b: Rat): Rat => rat(a.n * b.d, a.d * b.n)
export const neg = (a: Rat): Rat => ({ n: -a.n, d: a.d })
export const abs = (a: Rat): Rat => (a.n < 0n ? neg(a) : a)
export const sign = (a: Rat): number => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0)
export const cmp = (a: Rat, b: Rat): number => sign(sub(a, b))
export const isZero = (a: Rat): boolean => a.n === 0n

function bitLength(x: bigint): number {
  return babs(x).toString(2).length
}

/** Nearest float64 (to within an ulp; only used for reporting). */
export function toNumber(a: Rat): number {
  if (a.n === 0n) return 0
  const shift = 80 - (bitLength(a.n) - bitLength(a.d))
  const q = shift >= 0 ? (a.n << BigInt(shift)) / a.d : a.n / (a.d << BigInt(-shift))
  return Number(q) * 2 ** -shift
}

// ---------------------------------------------------------------------------
// Polynomials: coefficient arrays, highest degree first, leading coeff != 0.

export type Poly = Rat[]

function trim(p: Poly): Poly {
  let i = 0
  while (i < p.length - 1 && isZero(p[i]!)) i++
  return p.slice(i)
}

export function evaluate(p: Poly, x: Rat): Rat {
  let acc = ZERO
  for (const c of p) acc = add(mul(acc, x), c)
  return acc
}

export function derivative(p: Poly): Poly {
  const n = p.length - 1
  if (n === 0) return [ZERO]
  return p.slice(0, n).map((c, i) => mul(c, rat(BigInt(n - i))))
}

/** Remainder of a / b (b nonzero). */
function remainder(a: Poly, b: Poly): Poly {
  let r = a.slice()
  const db = b.length - 1
  while (r.length - 1 >= db && !(r.length === 1 && isZero(r[0]!))) {
    const f = div(r[0]!, b[0]!)
    for (let i = 0; i <= db; i++) r[i] = sub(r[i]!, mul(f, b[i]!))
    r = r.slice(1)
    if (r.length === 0) return [ZERO]
    r = trim(r)
  }
  return r
}

/** Sturm sequence p, p', -rem(...), ... */
export function sturmSequence(p: Poly): Poly[] {
  const seq: Poly[] = [trim(p), trim(derivative(p))]
  for (;;) {
    const a = seq[seq.length - 2]!
    const b = seq[seq.length - 1]!
    if (b.length === 1) break // constant
    const r = remainder(a, b)
    if (r.length === 1 && isZero(r[0]!)) break
    seq.push(r.map(neg))
  }
  return seq
}

function signChangesAt(seq: Poly[], x: Rat): number {
  let changes = 0
  let last = 0
  for (const q of seq) {
    const s = sign(evaluate(q, x))
    if (s === 0) continue
    if (last !== 0 && s !== last) changes++
    last = s
  }
  return changes
}

/** Number of distinct real roots in (lo, hi]. */
export function countRoots(seq: Poly[], lo: Rat, hi: Rat): number {
  return signChangesAt(seq, lo) - signChangesAt(seq, hi)
}

/** Cauchy bound: every root satisfies |x| < bound. */
function rootBound(p: Poly): Rat {
  let m = ZERO
  for (let i = 1; i < p.length; i++) {
    const v = abs(div(p[i]!, p[0]!))
    if (cmp(v, m) > 0) m = v
  }
  return add(m, rat(1n))
}

export interface ExactRoot {
  /** Isolating interval (lo, hi] containing exactly this one distinct root. */
  lo: Rat
  hi: Rat
}

/**
 * Isolates every distinct real root of p and refines each to an interval of
 * relative width < 2^-bits (or exactly, if a bisection point hits the root).
 * 72 bits resolves errors 2^20 times smaller than float64 rounding, ample for
 * measuring solver error in units of eps.
 */
export function realRoots(p: Poly, bits = 72): ExactRoot[] {
  p = trim(p)
  if (p.length <= 1) return []
  const seq = sturmSequence(p)
  const bound = rootBound(p)
  const out: ExactRoot[] = []
  const pending: [Rat, Rat, number][] = [[neg(bound), bound, countRoots(seq, neg(bound), bound)]]
  while (pending.length > 0) {
    const [lo, hi, count] = pending.pop()!
    if (count === 0) continue
    if (count === 1) {
      out.push(refine(p, seq, lo, hi, bits))
      continue
    }
    const mid = div(add(lo, hi), rat(2n))
    const left = countRoots(seq, lo, mid)
    pending.push([lo, mid, left], [mid, hi, count - left])
  }
  out.sort((a, b) => cmp(a.hi, b.hi))
  return out
}

function refine(p: Poly, seq: Poly[], lo: Rat, hi: Rat, bits: number): ExactRoot {
  const two = rat(2n)
  const tol = rat(1n, 1n << BigInt(bits))
  // Simple roots change sign, so plain bisection on p suffices; even
  // multiplicity roots need Sturm counts.
  const simple = sign(evaluate(p, lo)) * sign(evaluate(p, hi)) < 0
  for (;;) {
    if (isZero(evaluate(p, hi))) return { lo: hi, hi }
    const width = sub(hi, lo)
    const scale = cmp(abs(lo), abs(hi)) > 0 ? abs(lo) : abs(hi)
    // Stop on relative width, and never refine an interval containing 0
    // forever (only possible if 0 is a root, caught by the exact check above).
    if (cmp(width, mul(tol, scale)) <= 0) return { lo, hi }
    const mid = div(add(lo, hi), two)
    if (isZero(evaluate(p, mid))) return { lo: mid, hi: mid }
    const inLeft = simple
      ? sign(evaluate(p, lo)) * sign(evaluate(p, mid)) < 0
      : countRoots(seq, lo, mid) === 1
    if (inLeft) hi = mid
    else lo = mid
  }
}

/**
 * Coefficients (highest first) of lead * prod (x - z_k) for float roots given
 * as (re, im) with conjugate pairs adjacent. Exact.
 */
export function polyFromRoots(lead: Rat, re: number[], im: number[]): Poly {
  let p: Poly = [lead]
  const mulBy = (q: Poly) => {
    const r: Poly = new Array(p.length + q.length - 1).fill(ZERO)
    for (let i = 0; i < p.length; i++)
      for (let j = 0; j < q.length; j++) r[i + j] = add(r[i + j]!, mul(p[i]!, q[j]!))
    p = r
  }
  for (let k = 0; k < re.length; k++) {
    const x = fromNumber(re[k]!)
    if (im[k] === 0) {
      mulBy([rat(1n), neg(x)])
    } else {
      // (x - z)(x - conj z) = x^2 - 2 Re z x + |z|^2
      const y = fromNumber(im[k]!)
      mulBy([rat(1n), neg(mul(rat(2n), x)), add(mul(x, x), mul(y, y))])
      k++ // skip the conjugate
    }
  }
  return p
}
