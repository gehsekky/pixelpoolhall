# Reference harness

Python tools that run established libraries on the same inputs as our engine,
so we can compare results. Nothing here ships to players.

| Tool | Compares against | License of the reference |
|---|---|---|
| `numpy_roots.py` | `numpy.roots` (LAPACK eigenvalues via OpenBLAS) | NumPy: BSD-3-Clause; OpenBLAS: BSD-3-Clause |
| *(planned)* pooltool fixtures | pooltool shot simulations | Apache-2.0 |

## Setup

The venv is created without pip (the system Python lacks `ensurepip`), and
packages are installed into it with the system pip:

```sh
python3 -m venv --without-pip tools/reference/.venv
pip3 --python tools/reference/.venv/bin/python install -r tools/reference/requirements.txt
```

If your Python has `ensurepip`, a normal `python3 -m venv` works too. Set
`REFERENCE_PYTHON` to use a different interpreter.

## Root-solver comparison

```sh
cd packages/physics
node test/numpy-comparison.ts 300            # quartic, 300 cases per family
DEGREE=3 node test/numpy-comparison.ts 300   # cubic
```
