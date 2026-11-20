# Third-Party Notices

This project is MIT licensed (see `LICENSE`). Code adapted from other projects
keeps its original license; each such source is listed here with its license
text or a link to it, and every adapted file carries a header naming its origin
and stating that it was modified.

Before adding anything here, check the licensing policy in
`docs/billiards-game-plan.md`. GPL code and code under restrictive terms
(e.g. Algorithm 1010's) must not be added.

## Adapted code

None yet.

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
