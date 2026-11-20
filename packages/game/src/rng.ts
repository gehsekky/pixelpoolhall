/**
 * Small seeded PRNG (SplitMix32-style integer hash of a counter), so racks
 * and AI choices are reproducible from a seed.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Current internal state (to save and restore). */
  readonly state: number
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0
  return {
    next() {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
      z = (z ^ (z >>> 15)) >>> 0
      return z / 2 ** 32
    },
    get state() {
      return s
    },
  }
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
