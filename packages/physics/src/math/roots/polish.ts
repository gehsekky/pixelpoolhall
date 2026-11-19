import type { Roots } from "./roots.ts"

/**
 * Refines root k of a monic polynomial with Newton's method, in complex
 * arithmetic (a real root stays exactly real, since every operation on it is
 * real).
 *
 * A step is kept only if it strictly reduces |p(z)|, so polishing can never
 * make a root worse. That matters near multiple roots, where p'(z) ~ 0 and a
 * raw Newton step can jump far away.
 *
 * @param c  Coefficients of the monic polynomial, highest degree first,
 *           *excluding* the leading 1: c[0]*x^(n-1) + ... + c[n-1].
 * @param n  Degree (length of `c`).
 */
export function polishRoot(
  c: Float64Array,
  n: number,
  out: Roots,
  k: number,
  maxIterations: number,
): void {
  let x = out.re[k]
  let y = out.im[k]

  // Evaluate p(z) and p'(z) at z = x + iy with complex Horner.
  let pr = 1
  let pi = 0
  let dr = 0
  let di = 0
  for (let j = 0; j < n; j++) {
    // d = d*z + p
    const ndr = dr * x - di * y + pr
    const ndi = dr * y + di * x + pi
    dr = ndr
    di = ndi
    // p = p*z + c[j]
    const npr = pr * x - pi * y + c[j]
    const npi = pr * y + pi * x
    pr = npr
    pi = npi
  }
  let err = pr * pr + pi * pi

  for (let it = 0; it < maxIterations && err > 0; it++) {
    const den = dr * dr + di * di
    if (den === 0) break
    // step = p / p'
    const sr = (pr * dr + pi * di) / den
    const si = (pi * dr - pr * di) / den
    const nx = x - sr
    const ny = y === 0 ? 0 : y - si

    let qr = 1
    let qi = 0
    let er = 0
    let ei = 0
    for (let j = 0; j < n; j++) {
      const ner = er * nx - ei * ny + qr
      const nei = er * ny + ei * nx + qi
      er = ner
      ei = nei
      const nqr = qr * nx - qi * ny + c[j]
      const nqi = qr * ny + qi * nx
      qr = nqr
      qi = nqi
    }
    const nerr = qr * qr + qi * qi
    if (!(nerr < err)) break

    x = nx
    y = ny
    pr = qr
    pi = qi
    dr = er
    di = ei
    err = nerr
  }

  out.re[k] = x
  out.im[k] = y
}
