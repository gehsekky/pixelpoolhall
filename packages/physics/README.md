# @pixelpoolhall/physics

Event-based billiards physics engine. See
[docs/physics-design.md](../../docs/physics-design.md) for the design.

## Status

| Component | State |
|---|---|
| Polynomial root solvers (quadratic, cubic, quartic) | Done, verified against exact roots |
| Everything else in the design | Not started |

## Root solvers

`solveQuadratic`, `solveCubic` and `solveQuartic` write roots into a reusable
`Roots` buffer (`createRoots()`), so the event loop allocates nothing. They are
written clean-room from classical mathematics:
- closed forms (stable quadratic, Cardano/Viète, Ferrari) on exactly
  power-of-two-scaled polynomials;
- Newton refinement of the real factorization;
- an a posteriori backward-error certificate;
- an Aberth–Ehrlich fallback with Newton-polygon starting points when the
  certificate fails (roots spread over many orders of magnitude, or close
  clusters).

### How accuracy is verified

Every float64 coefficient is an exact rational, so a polynomial's real roots
are exactly defined. `test/support/exact.ts` isolates and refines them with
Sturm sequences in BigInt arithmetic, with no floating point involved. Each
computed root is then scored by:
- **stability:** forward error / (eps × condition number). 1 means as
  accurate as float64 allows for that root.
- **backward error:** how far each coefficient must move to make the
  computed roots exact, relative to the size of that coefficient's terms,
  in eps.

```sh
pnpm test                          # suite: hand-built hard cases + seeded random families
node test/accuracy-report.ts 300   # full report, quartic (slow: exact arithmetic)
DEGREE=3 node test/accuracy-report.ts 300   # cubic
node test/speed-report.ts          # throughput and fallback rate per family
```
