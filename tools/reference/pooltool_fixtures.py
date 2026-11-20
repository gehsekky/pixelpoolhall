"""Export pooltool simulations as JSON fixtures for our engine's tests.

    tools/reference/.venv/bin/python -I tools/reference/pooltool_fixtures.py [out_dir]

Writes one file per shot category to packages/physics/test/fixtures/pooltool/
(or out_dir). Each file holds everything needed to replay the shots without
pooltool: the physics models and their parameters, the table geometry as
pooltool builds it, each ball's parameters and starting state, the cue strike,
and every event with the post-event state of each ball involved.

The engine is constructed explicitly from pooltool's built-in defaults, so the
fixtures don't depend on the user's ~/.config/pooltool resolver file.

Fixture schema (version 1), all SI units, angles in degrees as pooltool takes them:
    schema, generator {pooltool, commit, numpy}, category, description,
    engine {is_3d, resolver (pooltool's own serialization)},
    table {type, specs, linear[], circular[], pockets[]},
    shots[] {name, description, balls[] {id, params, rvw, s},
             cue {ball, V0, phi, theta, a, b, specs},
             events[] {type, time, ids[], states {ball_id: {rvw, s}}},
             final {ball_id: {rvw, s}}}
rvw is [[x, y, z], [vx, vy, vz], [wx, wy, wz]]. s is the motion state:
0 stationary, 1 spinning, 2 sliding, 3 rolling, 4 pocketed, 5 airborne,
6 off table.
"""

from __future__ import annotations

import json
import math
import os
import random
import sys
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

import attrs
import numpy as np
import pooltool as pt
from pooltool.evolution.engine import SimulationEngine
from pooltool.objects.ball.datatypes import Ball
from pooltool.objects.table.collection import default_specs_from_table_type
from pooltool.objects.table.specs import TableType
from pooltool.physics.resolve.resolver import default_resolver
from pooltool.serialize import SerializeFormat, conversion

SCHEMA = 1
POOLTOOL_COMMIT = "9e819eb13995b8764226d6da98069b7fd6e14302"
REPO = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO / "packages/physics/test/fixtures/pooltool"
MAX_EVENTS = 2000


def engine() -> SimulationEngine:
    return SimulationEngine(is_3d=False, resolver=default_resolver())


def to_plain(obj: object) -> object:
    """pooltool object -> JSON-ready dict via pooltool's own serializer."""
    return conversion[SerializeFormat.JSON].unstructure(obj)


def floats(a: np.ndarray) -> list:
    return np.asarray(a, dtype=np.float64).tolist()


# ---------------------------------------------------------------- shots


@dataclass
class Strike:
    V0: float
    phi: float
    theta: float = 0.0
    a: float = 0.0
    b: float = 0.0


@dataclass
class Shot:
    name: str
    description: str
    balls: dict[str, tuple[float, float]]
    strike: Strike | Callable[[pt.System], Strike]
    rack: str | None = None  # "9ball" / "8ball": balls come from pooltool's rack


SPECS = default_specs_from_table_type(TableType.POCKET)
TABLE = pt.Table.from_table_specs(SPECS)
R = pt.BallParams.default().R
W, L = TABLE.w, TABLE.l
CENTER = (W / 2, L / 2)

SPINS = {
    "center": (0.0, 0.0),
    "follow": (0.0, 0.5),
    "draw": (0.0, -0.5),
    "left": (-0.5, 0.0),
    "right": (0.5, 0.0),
    "follow-right": (0.35, 0.35),
}


def motion_shots() -> Iterator[Shot]:
    # Lone cue ball: sliding -> rolling -> spinning -> stationary transitions.
    # Aimed along the length from the foot end so most come to rest before a rail.
    for V0 in (0.3, 1.0, 2.0):
        for spin, (a, b) in SPINS.items():
            yield Shot(f"V{V0}-{spin}", f"lone ball, {V0} m/s, {spin}",
                       {"cue": (W / 2, 0.2)}, Strike(V0, 90.0, 0.0, a, b))
    # Elevated cue (masse): curved sliding paths.
    for theta in (15.0, 45.0, 75.0):
        for spin in ("left", "right", "draw"):
            a, b = SPINS[spin]
            yield Shot(f"masse-{theta}-{spin}", f"elevation {theta} deg, {spin}",
                       {"cue": CENTER}, Strike(1.0, 90.0, theta, a, b))


def cushion_shots() -> Iterator[Shot]:
    # Cue ball into the right long rail at a range of incidence angles.
    start = (W / 2, L / 2)
    for incidence in (90.0, 60.0, 45.0, 30.0, 15.0, 5.0):
        phi = 90.0 - incidence  # incidence 90 = perpendicular to the x = W rail
        for V0 in (1.0, 3.0):
            for spin in ("center", "follow", "draw", "left", "right"):
                a, b = SPINS[spin]
                yield Shot(f"inc{incidence}-V{V0}-{spin}",
                           f"right rail at {incidence} deg, {V0} m/s, {spin}",
                           {"cue": start}, Strike(V0, phi, 0.0, a, b))


def jaw_shots() -> Iterator[Shot]:
    # Aim at points around each pocket mouth so balls strike the jaws (circular
    # cushion segments) and sometimes drop.
    rng = random.Random(7)
    for seg_id, seg in sorted(TABLE.cushion_segments.circular.items()):
        cx, cy = float(seg.center[0]), float(seg.center[1])
        for k in range(3):
            sx = min(max(CENTER[0] + rng.uniform(-0.25, 0.25), 2 * R), W - 2 * R)
            sy = min(max(CENTER[1] + rng.uniform(-0.5, 0.5), 2 * R), L - 2 * R)
            off = rng.uniform(-1.2, 1.2) * R
            dx, dy = cx - sx, cy - sy
            n = math.hypot(dx, dy)
            tx, ty = cx - dy / n * off, cy + dx / n * off
            phi = math.degrees(math.atan2(ty - sy, tx - sx)) % 360
            yield Shot(f"{seg_id}-{k}", f"toward jaw {seg_id}",
                       {"cue": (sx, sy)}, Strike(rng.choice((1.0, 2.5)), phi, 0.0,
                                                 *SPINS[rng.choice(list(SPINS))]))


def cut_shots() -> Iterator[Shot]:
    # Cue ball and one object ball, cut angles from full to the thinnest.
    cue, obj = (W / 2, L / 4), (W / 2, L / 2)
    for cut in (0.0, 15.0, 30.0, 45.0, 60.0, 75.0, 85.0, 89.0):
        for V0 in (1.0, 3.0):
            for spin in ("center", "follow", "draw", "left", "right"):
                a, b = SPINS[spin]

                def strike(system: pt.System, V0=V0, a=a, b=b, cut=cut) -> Strike:
                    return Strike(V0, pt.aim.at_ball(system, "1", cut=cut), 0.0, a, b)

                yield Shot(f"cut{cut}-V{V0}-{spin}", f"{cut} deg cut, {V0} m/s, {spin}",
                           {"cue": cue, "1": obj}, strike)


def pocket_shots() -> Iterator[Shot]:
    # Straight-in shots: object ball half way to each pocket, cue ball behind it.
    for pid, pocket in sorted(TABLE.pockets.items()):
        px, py = float(pocket.center[0]), float(pocket.center[1])
        ox, oy = (CENTER[0] + px) / 2, (CENTER[1] + py) / 2
        ux, uy = (px - ox), (py - oy)
        n = math.hypot(ux, uy)
        cue = (ox - ux / n * 0.3, oy - uy / n * 0.3)
        for V0 in (0.8, 2.0, 5.0):
            def strike(system: pt.System, V0=V0) -> Strike:
                return Strike(V0, pt.aim.at_ball(system, "1"))

            yield Shot(f"{pid}-V{V0}", f"straight in to {pid}, {V0} m/s",
                       {"cue": cue, "1": (ox, oy)}, strike)


def frozen_shots() -> Iterator[Shot]:
    # Balls already in contact (separated by pooltool's 1 um MIN_DIST): an
    # object ball frozen to the right rail, and two-ball combinations.
    contact_x = W - math.sqrt((R + 0.001) ** 2 - (SPECS.cushion_height - R) ** 2) - 1e-6
    for k, phi_off in enumerate((0.0, 20.0, 45.0, -30.0)):
        obj = (contact_x, 0.3 * L)  # on rail segment, clear of the side pocket
        cue = (obj[0] - 0.4 * math.cos(math.radians(phi_off)), obj[1] - 0.4 * math.sin(math.radians(phi_off)))

        def strike(system: pt.System) -> Strike:
            return Strike(2.0, pt.aim.at_ball(system, "1"))

        yield Shot(f"rail-{k}", f"object ball frozen to the right rail, hit from {phi_off} deg",
                   {"cue": cue, "1": obj}, strike)
    for cut in (0.0, 15.0, 30.0):
        for V0 in (1.0, 3.0):
            gap = 2 * R + 1e-6
            a = (W / 2, L / 2)
            ang = math.radians(90.0 + cut)
            b = (a[0] + gap * math.cos(ang), a[1] + gap * math.sin(ang))

            def strike(system: pt.System, V0=V0) -> Strike:
                return Strike(V0, pt.aim.at_ball(system, "1"))

            yield Shot(f"combo-{cut}-V{V0}", f"frozen pair, line {cut} deg off the shot, {V0} m/s",
                       {"cue": (W / 2, L / 4), "1": a, "2": b}, strike)


def break_shots() -> Iterator[Shot]:
    for game, rack in (("9ball", pt.GameType.NINEBALL), ("8ball", pt.GameType.EIGHTBALL)):
        for V0 in (4.0, 7.0):
            for dx in (0.0, 0.1):
                def strike(system: pt.System, V0=V0) -> Strike:
                    return Strike(V0, pt.aim.at_ball(system, "1"))

                yield Shot(f"{game}-V{V0}-x{dx}", f"{game} break, {V0} m/s, cue {dx} m off center",
                           {"cue": (W / 2 + dx, L / 4)}, strike, rack=game)


def random_shots() -> Iterator[Shot]:
    rng = random.Random(2026)
    for k in range(40):
        n = rng.randint(2, 6)
        pos: dict[str, tuple[float, float]] = {}
        while len(pos) < n:
            p = (rng.uniform(2 * R, W - 2 * R), rng.uniform(2 * R, L - 2 * R))
            if all(math.hypot(p[0] - q[0], p[1] - q[1]) > 2.2 * R for q in pos.values()):
                pos["cue" if not pos else str(len(pos))] = p
        theta = rng.choice((0.0, 0.0, 0.0, 10.0, 30.0))
        yield Shot(f"random-{k}", f"{n} balls, random strike",
                   pos, Strike(rng.uniform(0.3, 5.0), rng.uniform(0, 360), theta,
                               rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5)))


CATEGORIES: dict[str, tuple[str, Callable[[], Iterator[Shot]]]] = {
    "motion": ("Lone cue ball: motion states and transitions, including masse", motion_shots),
    "cushion": ("Cue ball into a straight rail at many angles, speeds and spins", cushion_shots),
    "jaw": ("Shots at the pocket jaws (circular cushion segments)", jaw_shots),
    "cut": ("Cue ball onto one object ball, full to the thinnest cuts, with spin", cut_shots),
    "pocket": ("Straight-in shots to every pocket at several speeds", pocket_shots),
    "frozen": ("Balls frozen to a rail or to each other", frozen_shots),
    "break": ("9-ball and 8-ball breaks", break_shots),
    "random": ("Seeded random layouts of 2-6 balls with random strikes", random_shots),
}

# ---------------------------------------------------------------- export


RACK_SEEDS = {"9ball": 9, "8ball": 8}


def build_system(shot: Shot) -> pt.System:
    if shot.rack:
        game = pt.GameType.NINEBALL if shot.rack == "9ball" else pt.GameType.EIGHTBALL
        # get_rack jitters positions with np.random and assigns ball numbers with
        # random.choice over a set (whose order depends on the hash seed, pinned
        # in main). Seed both so every export, and every shot on a rack, match.
        random.seed(RACK_SEEDS[shot.rack])
        np.random.seed(RACK_SEEDS[shot.rack])
        balls = pt.get_rack(game, TABLE)
        cue = balls["cue"]
        cue.state.rvw[0, :2] = shot.balls["cue"]
    else:
        balls = {bid: Ball.create(bid, xy=xy) for bid, xy in shot.balls.items()}
    return pt.System(cue=pt.Cue(cue_ball_id="cue"), table=TABLE, balls=balls)


def ball_state(ball: Ball) -> dict:
    return {"rvw": floats(ball.state.rvw), "s": int(ball.state.s)}


def export_shot(shot: Shot) -> dict:
    system = build_system(shot)
    strike = shot.strike(system) if callable(shot.strike) else shot.strike
    system.cue.set_state(V0=strike.V0, phi=strike.phi, theta=strike.theta,
                         a=strike.a, b=strike.b, cue_ball_id="cue")
    initial = [{"id": bid, "params": to_plain(b.params), **ball_state(b)}
               for bid, b in system.balls.items()]  # pooltool order: it sets tie-breaking
    pt.simulate(system, engine=engine(), inplace=True, max_events=MAX_EVENTS)

    events = []
    for ev in system.events:
        states = {}
        for agent in ev.agents:
            if agent.agent_type == "ball" and agent.final is not None:
                states[agent.id] = ball_state(agent.final)
        events.append({"type": str(ev.event_type), "time": float(ev.time),
                       "ids": list(ev.ids), "states": states})
    if len(events) > MAX_EVENTS:
        raise RuntimeError(f"{shot.name}: hit the {MAX_EVENTS}-event cap")

    return {
        "name": shot.name,
        "description": shot.description,
        "balls": initial,
        "cue": {"ball": "cue", "V0": strike.V0, "phi": strike.phi, "theta": strike.theta,
                "a": strike.a, "b": strike.b, "specs": to_plain(system.cue.specs)},
        "events": events,
        "final": {bid: ball_state(b) for bid, b in system.balls.items()},
    }


def table_geometry() -> dict:
    segs = TABLE.cushion_segments
    return {
        "type": str(TABLE.table_type),
        "specs": {k: v for k, v in to_plain(attrs.asdict(SPECS, recurse=False)).items()
                  if k not in ("model_descr",)},
        "linear": [{"id": s.id, "p1": floats(s.p1), "p2": floats(s.p2),
                    "nose_radius": s.nose_radius, "direction": int(s.direction)}
                   for _, s in sorted(segs.linear.items())],
        "circular": [{"id": s.id, "center": floats(s.center), "radius": s.radius}
                     for _, s in sorted(segs.circular.items())],
        "pockets": [{"id": p.id, "center": floats(p.center), "radius": p.radius, "depth": p.depth}
                    for _, p in sorted(TABLE.pockets.items())],
    }


def main() -> None:
    if sys.flags.hash_randomization:
        # Set iteration order (used by pooltool's rack generator) depends on the
        # per-process string hash seed: re-run with it fixed. -P -s keep the
        # isolation of -I, which would ignore PYTHONHASHSEED (-E).
        os.execve(sys.executable, [sys.executable, "-P", "-s", __file__, *sys.argv[1:]],
                  {**os.environ, "PYTHONHASHSEED": "0"})
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out_dir.mkdir(parents=True, exist_ok=True)
    header = {
        "schema": SCHEMA,
        "generator": {"pooltool": version("pooltool-billiards"), "commit": POOLTOOL_COMMIT,
                      "numpy": np.__version__},
    }
    shared = {"engine": {"is_3d": False, "resolver": to_plain(default_resolver())},
              "table": table_geometry()}
    for category, (description, shots) in CATEGORIES.items():
        data = {**header, "category": category, "description": description, **shared,
                "shots": [export_shot(s) for s in shots()]}
        path = out_dir / f"{category}.json"
        path.write_text(json.dumps(data, allow_nan=False, separators=(",", ":")) + "\n")
        n_events = sum(len(s["events"]) for s in data["shots"])
        print(f"{category}: {len(data['shots'])} shots, {n_events} events -> {path}")


if __name__ == "__main__":
    main()
