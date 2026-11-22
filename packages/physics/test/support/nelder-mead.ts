/**
 * Nelder–Mead simplex minimization (standard coefficients: reflection 1,
 * expansion 2, contraction ½, shrink ½). Written from the textbook
 * description (Nelder & Mead, Computer Journal 7, 1965); no code used.
 */
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], opts: { maxIter?: number; tol?: number } = {}): { x: number[]; fx: number } {
  const n = x0.length
  const maxIter = opts.maxIter ?? 400
  const tol = opts.tol ?? 1e-10
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i]! : v)))]
  let values = simplex.map(f)
  const combine = (a: number[], b: number[], t: number) => a.map((v, i) => v + t * (b[i]! - v))
  for (let iter = 0; iter < maxIter; iter++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!)
    simplex = order.map((i) => simplex[i]!)
    values = order.map((i) => values[i]!)
    if (values[n]! - values[0]! <= tol * (Math.abs(values[0]!) + tol)) break
    const centroid = simplex.slice(0, n).reduce((acc, x) => acc.map((v, i) => v + x[i]! / n), new Array<number>(n).fill(0))
    const worst = simplex[n]!
    const reflected = combine(centroid, worst, -1)
    const fr = f(reflected)
    if (fr < values[0]!) {
      const expanded = combine(centroid, worst, -2)
      const fe = f(expanded)
      ;[simplex[n], values[n]] = fe < fr ? [expanded, fe] : [reflected, fr]
    } else if (fr < values[n - 1]!) {
      ;[simplex[n], values[n]] = [reflected, fr]
    } else {
      const contracted = fr < values[n]! ? combine(centroid, reflected, 0.5) : combine(centroid, worst, 0.5)
      const fc = f(contracted)
      if (fc < Math.min(fr, values[n]!)) {
        ;[simplex[n], values[n]] = [contracted, fc]
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = combine(simplex[0]!, simplex[i]!, 0.5)
          values[i] = f(simplex[i]!)
        }
      }
    }
  }
  const best = values.indexOf(Math.min(...values))
  return { x: simplex[best]!, fx: values[best]! }
}
