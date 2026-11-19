"""Solve polynomials with numpy.roots (companion-matrix eigenvalues, LAPACK).

Reads a JSON array of coefficient lists (highest degree first) on stdin and
writes a JSON array of {"re": [...], "im": [...]} on stdout. Non-finite
values are written as null. JSON numbers round-trip float64 exactly in both
Python and JavaScript, so the inputs are bit-identical to what our solvers see.

Used by packages/physics/test/numpy-comparison.ts.
"""

import json
import math
import sys

import numpy as np


def finite_or_none(x: float) -> float | None:
    return x if math.isfinite(x) else None


def main() -> None:
    cases = json.load(sys.stdin)
    out = []
    for coeffs in cases:
        roots = np.roots(np.array(coeffs, dtype=np.float64))
        out.append(
            {
                "re": [finite_or_none(float(z.real)) for z in roots],
                "im": [finite_or_none(float(z.imag)) for z in roots],
            }
        )
    json.dump(out, sys.stdout, allow_nan=False)


if __name__ == "__main__":
    main()
