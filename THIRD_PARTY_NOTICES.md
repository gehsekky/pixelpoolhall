# Third-Party Notices

This project is MIT licensed (see `LICENSE`). Code adapted from other projects
keeps its original license; each such source is listed here with its license
text or a link to it, and every adapted file carries a header naming its origin
and stating that it was modified.

Before adding anything here, check the licensing policy in
`docs/billiards-game-plan.md`. GPL code and code under restrictive terms
(e.g. Algorithm 1010's) must not be added.

## Adapted code

### pooltool

- Source: https://github.com/ekiefl/pooltool (commit 9e819eb), Copyright Evan Kiefl.
- License: Apache License 2.0. Full text: `LICENSES/pooltool-Apache-2.0.txt`.
- **Adapted files.** Each carries a header naming pooltool, its license, and how it was modified. All are rewritten in TypeScript; none is a line-for-line copy.
  - `packages/physics/src/detect.ts`: contact-time equations and acceptance rules from pooltool's 2D detectors.
  - `packages/physics/src/engine.ts`: event caching, invalidation and tie-breaking. Restructured around per-ball trajectory segments.
  - `packages/physics/src/resolve/stick-ball.ts`: cue strike and squirt (model from Alciatore TP A-30/A-31).
  - `packages/physics/src/resolve/ball-ball.ts`: frictional inelastic collision, `make_kiss` placement, and the continually-touching guard. Rewritten frame-free.
  - `packages/physics/src/resolve/stronge.ts`: Stronge compliant collision. Uses our own root finder, with a corrected bracket for the slip-resume time.
  - `packages/physics/src/resolve/cushion.ts`: applying the Stronge model to rails and jaws, plus `make_kiss` placement.
  - `packages/physics/src/table-builder.ts`: pocket-table geometry (rails, jaws, pockets) and the default 7-ft table specs.
- pooltool has no NOTICE file. Its default parameter values appear in `packages/physics/src/params.ts`.

## Reference data

- `packages/physics/test/fixtures/pooltool/*.json`: simulation output generated
  by running pooltool (https://github.com/ekiefl/pooltool, Apache-2.0, Copyright
  Evan Kiefl) through `tools/reference/pooltool_fixtures.py`. Test data only. It
  contains no pooltool code and is not shipped.

## Published works implemented from their mathematics (cited, no code copied)

- Ferrari's method and Descartes' factorization for quartic equations, and
  Cardano's/Viète's method for cubic equations: classical mathematics.
- Kahan's accurate `a*b - c*d` and Veltkamp/Dekker error-free product: classical
  floating-point techniques.
- Brent's root-finding method (R. P. Brent, "Algorithms for Minimization without
  Derivatives", 1973): `packages/physics/src/math/brent.ts`.
- W. J. Stronge, "Impact Mechanics" (2nd ed., 2018): compliant contact model.
- D. Alciatore, technical proofs A-5, A-6, A-14, A-30, A-31: ball–ball
  friction/throw, cue strike, squirt.
