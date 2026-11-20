# @pixelpoolhall/physics

Event-based billiards physics engine. See
[docs/physics-design.md](../../docs/physics-design.md) for the design.

## Status

| Component | State |
|---|---|
| Polynomial root solvers (quadratic, cubic, quartic) | Done, verified against exact roots |
| 2D engine: motion, detection, cue strike, ball–ball, rails, jaws, pockets | Done, matches all 279 pooltool fixture shots (see `test/engine.test.ts`) |
| Performance work (first pass), table builder (pooltool 7-ft, WPA 9-ft) | Done |
| 3D engine (`dim: "3d"`): jump shots, hops, collisions in the air, balls leaving the table | Done, matches all 340 pooltool 3D fixture shots (see `test/engine3d.test.ts`) |
| Pocket interior, fitting to measured data, Mathavan models | Not started |

```ts
import { simulate } from "@pixelpoolhall/physics"
const result = simulate({ table, balls, cueBall: "cue", strike: { V0: 2, phi: 90, theta: 0, a: 0, b: 0.2 } })
result.events // ordered events, each with the post-event state of the balls involved
result.final  // every ball's final state
```

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
node test/numpy-comparison.ts 300  # side by side with numpy.roots (needs tools/reference venv)
node test/engine-bench.ts          # engine throughput on the fixture shots
```

## Reference fixtures

`test/fixtures/pooltool/` holds pooltool simulations exported by
`tools/reference/pooltool_fixtures.py` (see `tools/reference/README.md`).
`test/pooltool-fixtures.test.ts` checks them now. Phase 1 will replay them
through our engine.

```sh
# regenerate (from the repo root)
tools/reference/.venv/bin/python -I tools/reference/pooltool_fixtures.py
```
