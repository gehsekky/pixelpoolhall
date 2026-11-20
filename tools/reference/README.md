# Reference harness

Python tools that run established libraries on the same inputs as our engine,
so we can compare results. Nothing here ships to players.

| Tool | Compares against | License of the reference |
|---|---|---|
| `numpy_roots.py` | `numpy.roots` (LAPACK eigenvalues via OpenBLAS) | NumPy: BSD-3-Clause; OpenBLAS: BSD-3-Clause |
| `pooltool_fixtures.py` | pooltool shot simulations, exported as JSON fixtures | pooltool: Apache-2.0 |

Every package the venv installs is permissively licensed (MIT, BSD, Apache-2.0,
PSF, MIT-CMU; checked 2026-11-19).

## Setup

pooltool needs Python 3.10–3.13 and a panda3d dev build that is only on the
panda3d archive index. [uv](https://docs.astral.sh/uv/) (MIT/Apache-2.0)
provides both the interpreter and the install:

```sh
uv venv --python 3.13 tools/reference/.venv
uv pip sync --python tools/reference/.venv/bin/python \
  --index-strategy unsafe-best-match --extra-index-url https://archive.panda3d.org/simple/ \
  tools/reference/requirements.txt
```

`requirements.txt` is a full lock compiled from `requirements.in` (the command
to regenerate it is in that file). pooltool is pinned to a commit. Its numba
dependency caps NumPy below 2.4.

## Root-solver comparison

```sh
cd packages/physics
node test/numpy-comparison.ts 300            # quartic, 300 cases per family
DEGREE=3 node test/numpy-comparison.ts 300   # cubic
```

## pooltool fixtures

```sh
tools/reference/.venv/bin/python -I tools/reference/pooltool_fixtures.py
```

This writes one JSON file per shot category to
`packages/physics/test/fixtures/pooltool/`:

| Category | Shots |
|---|---|
| motion | lone cue ball: speeds × spins, masse |
| cushion | straight rail at 5°–90° incidence, two speeds, five spins |
| jaw | shots at every pocket jaw |
| cut | full to 89° cuts, two speeds, five spins |
| pocket | straight in to every pocket at three speeds |
| frozen | ball frozen to a rail; frozen two-ball combinations |
| break | 9-ball and 8-ball breaks |
| random | seeded random layouts of 2–6 balls |

The schema is documented at the top of `pooltool_fixtures.py`, and
`packages/physics/test/support/pooltool-fixtures.ts` has the matching types.

- **Deterministic:** byte-identical across runs. pooltool's rack generator uses
  `random`, `np.random` and set iteration order, so the script seeds the first
  two and re-runs itself with `PYTHONHASHSEED=0`.
- **Independent of local config:** the physics engine is built from
  pooltool's built-in defaults, never from the user's
  `~/.config/pooltool/physics/resolver.yaml`.
- **Checked:** `test/pooltool-fixtures.test.ts` checks the fixtures for
  integrity, pooltool's contact conventions and physical invariants.

### pooltool conventions our engine must match (or account for)

- **Resolved contacts sit `MIN_DIST` = 1 µm apart.** After resolving a contact,
  pooltool leaves balls, and a ball and a jaw, 1 µm apart.
- **Rails have a nose.** A rail is a cylinder of radius `nose_radius` (1 mm)
  whose axis runs along the rail at cushion height. A ball touches it in 3D, so
  in the table plane the ball's center ends up 0.1 mm closer to the rail line
  than R.
- **A pocketed ball is moved to the pocket center at `-depth` and stopped.**
- **Frozen or following balls "chatter".** When a cue ball follows an object
  ball it has just hit, pooltool resolves hundreds of tiny repeated collisions:
  `frozen/combo-0.0-V1.0` has 1,218 events. Compare such shots by outcome, not
  event by event.
