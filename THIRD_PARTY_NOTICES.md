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
  - `packages/physics/src/detect.ts`: contact-time equations and acceptance rules from pooltool's 2D and 3D detectors (3D ball–ball and rail contact, landing, leaving the table, airborne pocket capture).
  - `packages/physics/src/engine.ts`: event caching, invalidation and tie-breaking. Restructured around per-ball trajectory segments.
  - `packages/physics/src/resolve/stick-ball.ts`: cue strike and squirt (model from Alciatore TP A-30/A-31).
  - `packages/physics/src/resolve/ball-ball.ts`: frictional inelastic collision, `make_kiss` placement (including the 3D table constraint), and the continually-touching guard. Rewritten frame-free.
  - `packages/physics/src/resolve/ball-table.ts`: frictional inelastic ball–table landing (Alciatore TP A-14) and the off-table freeze.
  - `packages/physics/src/resolve/stronge.ts`: Stronge compliant collision. Uses our own root finder, with a corrected bracket for the slip-resume time.
  - `packages/physics/src/resolve/cushion.ts`: applying the Stronge model to rails and jaws, plus `make_kiss` placement.
  - `packages/physics/src/resolve/mathavan.ts`: Mathavan's ball–ball (2014) and ball–cushion (2010) impulse integration, from pooltool's `frictional_mathavan` and `mathavan_2010`. Changed where the result depended on rounding noise: no friction at zero slip, a partial last restitution step, and friction capped so a contact can stick.
  - `packages/physics/src/table-builder.ts`: pocket-table geometry (rails, jaws, pockets) and the default 7-ft table specs.
- **Copied file (reference tooling, not shipped).** `tools/reference/mathavan_patched.py` copies pooltool's Mathavan ball–ball and ball–cushion solvers (Python) with the same three changes, each marked `PATCH`. It is used only to generate test fixtures.
- pooltool has no NOTICE file. Its default parameter values appear in `packages/physics/src/params.ts`.

## Reference data

- `packages/physics/test/fixtures/pooltool/*.json`, `pooltool3d/*.json`, `pooltool-mathavan/*.json` and `mathavan-core.json`: simulation output generated
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

## Rules and specifications (implemented from their substance, no text copied)

- World Pool-Billiard Association, "Rules of Play" and "Regulations", effective
  2026-10-21 (https://wpapool.com/rules-of-play/): the 8-ball and 9-ball rules in
  `packages/game`. The rules are paraphrased and cited by rule number; the WPA
  text is not reproduced.
- WPA "Recommended Equipment Specifications" (effective November 2001): the
  `WPA_9FT` table preset in `packages/physics/src/table-builder.ts`.

## Bundled runtime dependencies

- three.js 0.187.0 (https://threejs.org), Copyright 2010–2026 three.js authors,
  MIT License (see `LICENSES/three-MIT.txt`). Bundled into the web client,
  including the OrbitControls and RoomEnvironment add-ons.
