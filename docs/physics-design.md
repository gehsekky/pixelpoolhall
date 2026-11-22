# Physics Engine — Design

*Draft, November 19, 2026. See also: [billiards-game-plan.md](billiards-game-plan.md), [pooltool-analysis.md](pooltool-analysis.md), [tailuge-analysis.md](tailuge-analysis.md).*

## Goals

1. **Accuracy first.**
   - Simulate analytically between events, so no time steps are involved and no error builds up.
   - Every model and constant cites a paper or a measurement.
2. **Verifiable.** Automated tests against pooltool fixtures, and later against real measured shots.
3. **Fast enough for AI search.** Target: under 1 ms for a typical shot, and at least 1,000 shots per second in a web worker.
4. **Headless and portable.** Pure TypeScript with zero runtime dependencies; runs in a browser, a worker or Node.
5. **Swappable models.** Every interaction (ball–ball, cushion, pocket, and so on) sits behind an interface, so models can be compared with each other.

**Not goals (for now):**
- Bit-for-bit identical results across browsers.
- Snooker or carom tables. The geometry supports them, but they're out of scope.

---

## Conventions

| Item | Convention |
|---|---|
| Units | SI throughout: meters, kilograms, seconds, radians |
| Frame | Table frame: origin at a corner of the playing surface, `x` **across** the table (0..w), `y` **along** it (0..l), `z` up. The playing surface is `z = 0`, so a ball at rest has `z = R`. This is pooltool's frame (changed from the first draft's x-along-length on 2026-11-19), so geometry and fixtures compare directly; the renderer rotates as needed |
| Number type | IEEE float64 only. **Never** `Math.fround`, and no rounding mid-shot |
| Ball state | `r` (position), `v` (velocity), `ω` (angular velocity), each a 3-vector; `s` is the motion state; `t0` is the time the current segment starts |
| Slip velocity | `u = v + R·(ẑ × ω)`, the velocity of the contact point with the cloth (horizontal part) |

---

## Module layout

```
packages/physics/src/
  math/        vec3 helpers (no allocation), polynomial roots (quadratic, cubic, quartic + polish)
  params/      BallParams, TableSpec, CueSpec, ModelConfig — all defaults with citations
  table/       geometry builder: linear segments, jaw arcs, pockets (from TableSpec)
  motion/      motion states, trajectory coefficients, transition times, evaluate(t)
  detect/      next-event finders per event type
  resolve/     collision models per interaction (interfaces + implementations)
  engine/      event loop, caches, simultaneity, result assembly
  result/      ShotResult: event log + trajectory segments + sampling API
  index.ts     public API
```

**Public API (sketch):**

```ts
simulate(table: TableState, shot: CueShot, config?: EngineConfig): ShotResult

interface ShotResult {
  events: Event[]                 // ordered: time, type, involved ids, pre/post states
  segments: TrajectorySegment[][] // per ball: piecewise-analytic motion
  final: TableState
  positionAt(ballId: number, t: number): Vec3   // exact evaluation for rendering
}
```

---

## Motion states and equations

Each ball is always in exactly one state. Within a state, the acceleration is constant, so **position is a polynomial of degree ≤ 2 in time**.

`g` is gravity; `μs`, `μr` and `μsp` are the sliding, rolling and spin coefficients.

| State | Condition | Equations of motion (τ = t − t0) | Ends when |
|---|---|---|---|
| **Sliding** | `|u| > 0` | `û` (the slip direction) is constant. `v(τ) = v0 − μs·g·τ·û`, `r(τ) = r0 + v0·τ − ½μs·g·τ²·û`, `ω⊥(τ) = ω⊥0 + (5μs·g/2R)·τ·(ẑ × û)` (friction `−μs·m·g·û` acts at the contact point `−R·ẑ`; this sign was wrong in the first draft and was caught when checking against pooltool) | `τ = 2|u0| / (7μs·g)` → **rolling** |
| **Rolling** | `u = 0`, `|v| > 0` | `v(τ) = v0 − μr·g·τ·v̂0`, `r(τ) = r0 + v0·τ − ½μr·g·τ²·v̂0`, `ω⊥ = (ẑ × v)/R` | `τ = |v0| / (μr·g)` → **spinning** or **stationary** |
| **Spinning** | `v = 0`, `ωz ≠ 0` | `ωz(τ) = ωz0 − sign(ωz0)·(5μsp·g/2R)·τ` | `τ = |ωz0|·2R / (5μsp·g)` → **stationary** |
| **Stationary** | — | — | Only a collision ends it |
| **Airborne** | `z > R` or `vz > 0` | `r(τ) = r0 + v0·τ − ½g·τ²·ẑ`; ω constant | Lands on the table (`z = R`, a quadratic) |
| **Pocketed / off table** | — | Out of play | — |

In all states that touch the table, `ωz` decays independently at the spin-decay rate: `ωz(τ) = ωz0 − sign(ωz0)·(5μsp·g/2R)·τ`, clamped at zero.

**Stored per segment:** `t0`, `tEnd`, the state, and coefficients `c0`, `c1`, `c2` (each a 3-vector) such that `r(t) = c0 + c1·τ + c2·τ²`, plus the data needed to evaluate `ω(τ)`.

Detection and rendering both read these coefficients. Balls are **not** moved forward at every event, unlike pooltool's `evolve`. A ball gets a new segment only when an event involves it.

---

## Events

| Event | Detection equation | Notes |
|---|---|---|
| Transition (slide→roll, roll→spin, roll→stop, spin→stop) | Closed form (table above) | Stored per ball in the transition cache |
| Ball–ball | `|p1(τ) − p2(τ)|² = (2R)²` → **quartic** in τ | Keep the smallest real root `≥ 0` where the balls are approaching: `(p1 − p2)·(ṗ1 − ṗ2) < 0` |
| Ball–straight cushion | The ball center reaches distance `R + r_nose` from the cushion-nose cylinder. Projected onto the plane perpendicular to the cushion axis, this gives a **quartic** | Contact must lie within the segment; ball must be approaching |
| Ball–jaw (arc) | Distance to the arc center equals `R + r_jaw` → **quartic** | Contact must lie within the arc's angle range |
| Ball–pocket | The ball center crosses the pocket's capture boundary → **quartic** (Phase 1); the pocket interior model (Phase 3) | See *Pockets* below |
| Ball–table (landing) | `z(τ) = R` → **quadratic** | Airborne only |
| Ball leaves the table | Crosses the rail-top boundary while airborne | Phase 3 |
| Cue–ball | `t = 0` | Always the first event |

### Root solving

- **Quadratics:** use the numerically stable form (no cancellation when `b² ≫ 4ac`).
- **Quartics: our own solver** (decided 2026-11-19), written clean-room: no reference to Algorithm 1010's code or pooltool's translation of it.
  - **Approach:**
    1. Scale the polynomial so its coefficients are well conditioned.
    2. Solve the depressed form with Ferrari's or Descartes' method, picking the resolvent-cubic root that is most numerically stable.
    3. Polish each root with Newton's method on the original polynomial.
    4. Handle the cases where the polynomial drops to a lower degree, and near-double roots, explicitly.
  - **Testing:** check it against a high-precision reference (roots computed with BigInt or arbitrary-precision arithmetic, inside the tests only) over a large randomized set plus hand-picked hard cases: near-double roots, the "Newton's cradle" equal-velocity case, tangent (grazing) contacts, and very large or very small coefficients.
  - **Benchmark target:** at least 2 million solves per second in V8 (the JavaScript engine in Chrome and Node).
  - **As built (2026-11-19, `packages/physics/src/math/roots/`):**
    - Ferrari plus refinement of the factorization (the cubic uses Cardano/Viète plus refinement).
    - A whole-set backward-error certificate: certified when it's ≤ 4 eps.
    - If the certificate fails, an **Aberth–Ehrlich fallback** started from Newton-polygon estimates (Aberth 1973, Bini 1996), so roots spread over many orders of magnitude are handled.
    - Newton polishing is kept only when it doesn't worsen the whole root set. Polishing each root on its own pulled the two members of a close pair together.
  - **Measured accuracy** (300 cases per family, against exact BigInt reference roots):
    - Worst forward error: ≤ 2.3 × (eps × condition number) for every family: four real roots spread over 6 orders of magnitude, mixed real and complex, coefficients spanning 20 orders of magnitude, close pairs, roots near 1e±60/80, and ball–ball collision quartics.
    - Worst backward error: ≤ 4 eps.
    - No genuine real-root count errors. One cubic close pair can't be decided in float64: its computed roots are exact for a polynomial within 4 eps of the input.
  - **Measured speed:** 2.0–2.5 M solves/s on realistic families (Node 26). The fallback runs on < 1% of cases, except pathological coefficients spanning 20 orders of magnitude (24%, 1.0 M solves/s).
  - **Metric note:** backward error is measured relative to the size of each coefficient's terms. Measuring against the coefficient's own value isn't attainable: even correctly rounded exact roots score 85+ eps on it when a coefficient is small through cancellation (verified).
  - **Consequence for collision detection:** near-tangent contacts can legitimately come back as a complex pair with a tiny imaginary part. The detector must treat near-real roots as candidate contacts (`ε_contact` above).
  - **Compared with NumPy `roots`** (2.5.5; 2.3.5 noted where it differs) (LAPACK companion-matrix eigenvalues via OpenBLAS), on the same 300 cases per family against the same exact roots (`packages/physics/test/numpy-comparison.ts`):

    | Quartic family | Worst forward error, ours / NumPy (× eps·cond) | Worst backward error, ours / NumPy (eps) |
    |---|---|---|
    | 4 real, spread | 1.2 / 69 | 2.1 / 117 |
    | 2 real + pair | 1.9 / 64 | 1.9 / 152 |
    | 2 pairs | n/a | 3.0 / 290 |
    | uniform coefficients | 1.4 / 9.7 | 2.6 / 24 |
    | wild coefficients | 1.6 / **5.6e13** | 2.1 / **1.1e14** |
    | close real pair | 2.0 / 14 | 4.0 / 46 |
    | extreme scale | 2.2 / 11 (2.3.5: **4.5e15**) | 2.9 / 23 (2.3.5: **∞**) |
    | ball–ball collision | 0.5 / 2.4 | 2.3 / 29 |

    - Ours is more accurate on every family, by 4–5× at the median and by 10–100× in the worst case.
    - On wild coefficients NumPy loses all accuracy on 129 roots (43% of cases; the companion matrix can't represent roots spread over many orders of magnitude). It also gets one close-pair real-root count wrong. Ours has neither failure.
    - Cubic results are similar: our worst is ≤ 2.3 / ≤ 3.6 eps; NumPy's is 38 / 43 eps, and it loses 15 roots on wild coefficients.
    - **NumPy version matters.** The reference venv now pins NumPy 2.3.5, because pooltool's numba caps it below 2.4. Rerun on 2.3.5, every family gives identical numbers, except extreme scale (roots near 1e±60): 2.3.5 fails completely there, losing 576 of 900 quartic roots and 468 cubic roots, with infinite backward error. 2.5.5 handles those cases, so `np.roots` or its bundled LAPACK/OpenBLAS changed in between.
  - **Still to do:** **polish every candidate root** with 1–3 Newton iterations on the original distance function.
- **Reducing the degree:** when the leading coefficients are zero (two balls with the same acceleration, or a stationary ball against a rolling one), drop to the cubic or quadratic exactly rather than passing near-zero values to the quartic solver.
- **Near-tangent (thin) contacts:** if the polished root's minimum distance is within `ε_contact` of `2R`, accept it as a contact even when the discriminant is slightly negative. This makes the thinnest cuts register reliably, which tailuge can miss entirely.
- **Tolerances:**
  - `ε_contact = 1e-9 m` (about 1/30,000 of a ball radius);
  - `ε_time = 1e-12 s` for deciding two events are simultaneous.

  Both are named constants with tests.

### Caching and invalidation

- **Pair cache:** `nextTime[i][j]` for every ball pair, plus `nextCushion[i]`, `nextPocket[i]` and `nextTransition[i]` for each ball.
- **After an event involving a set of balls:**
  - recompute only the entries that involve those balls;
  - everything else stays valid, because the other balls' trajectories haven't changed.
- **Finding the next event:** a min-heap keyed by time, with lazy deletion (stale entries are tagged with a version number and skipped).
- **Quick rejection:** before solving a pair's quartic, check whether the two balls' reachable regions (a bounding radius over the remaining segment) can overlap at all. If not, skip the solve.

### Simultaneous events

Events whose times fall within `ε_time` of each other are simultaneous.

- **Priority:** cue strike → transitions → pockets → leaving the table → collisions (pooltool's tiers).
- **Within the collisions tier:**
  - resolve in order of decreasing relative kinetic energy;
  - after each resolution, invalidate and recompute the affected entries before taking the next event.
- **Frozen balls (touching at rest):** contacts with zero gap are detected explicitly. They produce zero-time collision events, guarded by an "approaching" test so the same contact can't loop forever.
- **Hard cap:** a maximum event count per shot (for example 10,000). If it's exceeded, the engine stops all balls and reports a diagnostic **instead of throwing**.
- **Future (Phase 3+):** a simultaneous multi-contact solver for the break, run as an alternative model and compared against video.

### Overlap guard

Before resolving a contact, move the ball back to exactly `contact distance + MIN_GAP` (`MIN_GAP = 1e-9 m`), using pooltool's `make_kiss` approach. This prevents tunneling and repeat collisions caused by rounding.

---

## Interaction models

Each interaction is an interface with selectable implementations. The defaults are in **bold**.

| Interaction | Models | Source |
|---|---|---|
| Cue → ball | **Instantaneous point contact** (cue mass, tip radius, elevation, tip offset) + **squirt** | Alciatore TP A-30, TP A-31; pooltool |
| Ball–ball | **Frictional inelastic impulse with speed-dependent throw friction** `μ = a + b·e^(−c·v_rel)` (a=0.00995, b=0.108, c=1.088); Mathavan 2014 (numerical, built: `ballBall.model: "mathavan"`) | Alciatore TP A-14; Mathavan et al. 2014 |
| Ball–cushion (straight and jaw) | **Stronge compliant** (closed form); Mathavan 2010 (numerical, built: `cushion.model: "mathavan"`); Han 2005 | Stronge 2018; Mathavan et al. 2010; Han 2005 |
| Ball–table landing | **Frictional inelastic** | Alciatore TP A-14 |
| Ball–pocket | Phase 1: **capture circle** (as in pooltool). Phase 3: **interior model** (see below) | — |

**The interface has two parts:**
- `resolve(state, params) → newState`: a pure function with no allocation.
- `validRange`: the input ranges where the model is trusted, which feed into testing.

---

## Table geometry

The table is generated from a `TableSpec` (all values in meters):
- **Playing surface:** default is a **9-ft table, 2.54 × 1.27 m** (WPA). 7-ft and 8-ft are presets.
- **Cushions:** nose height (≈ 0.635·2R, per WPA, about 63–64% of ball diameter) and nose radius.
- **Pockets, per type (corner and side):** mouth width, facing angle, jaw radius, setback (how far the pocket sits behind the cushion line), shelf depth, drop-edge radius.

The geometry builder outputs:
- straight cushion segments;
- circular jaw arcs;
- pocket definitions.

This follows pooltool's layout approach, re-implemented in TypeScript with Apache-2.0 attribution if any code is ported.

**As built (2026-11-19, `packages/physics/src/table-builder.ts`):**
- `buildPocketTable(spec)` is a port of pooltool's pocket-table layout: 18 rail segments, 12 jaws and 6 pockets, with pooltool's ids.
- From pooltool's default specs (`POOLTOOL_7FT`), it reproduces pooltool's geometry **bit for bit**.
- The engine comparison now runs on the built table, with identical results.
- **WPA 9-ft preset (`WPA_9FT`, the game's default table).** It's taken from the WPA Recommended Equipment Specifications (Nov 2001), using each range's midpoint:
  - 100 × 50 in playing surface;
  - corner mouth 4.5625 in, side mouth 5.0625 in (lip to lip);
  - cushion 1.9375 in wide, nose at 63.5% of the ball diameter;
  - facing cut angles 142° (corner) and 104° (side).

  In this geometry the corner cut angle is 135° + `cornerPocketAngle` exactly, so 7°. The side angle is 90° + `sidePocketAngle`, so 14°. pooltool's side facing ends a cushion width behind the nose rather than on the facing line, so the built side angle is 103.6°, inside WPA's ±1°. A test checks both.

  The WPA doesn't specify the jaw rounding, nose radius or pocket capture circles. Those keep pooltool's values until the Phase 3 pocket model, which also brings the shelf (corner 1–2¼ in, side 0–⅜ in) and the 12–15° back draft.

### 3D mode (Phase 3, as built 2026-11-20)

`simulate({ ..., dim: "3d" })` lets balls leave the slate. It follows pooltool's `is_3d` engine at the pinned commit:

- **Cue strike:** the elevated cue's downward velocity is kept (vz = −v·sin θ). The ball is airborne at t = 0 and lands at once: a jump.
- **Airborne motion:** a parabola under gravity, with ω constant. No transitions; the segment ends at landing.
- **Detection:**
  - ball–ball as a full 3D quartic;
  - rails as the nose cylinder: in the plane perpendicular to the rail axis, a parabola meeting a circle;
  - landing, the later root of z(τ) = R;
  - leaving the table: the center crosses the edge of the playing surface, or the far side of a pocket circle the ball flies through;
  - airborne pocket capture: the ball lands in the circle, or crosses it without dipping below the slate and leaves it below 7/5 R.
  - As in pooltool, jaws don't see airborne balls.
- **Resolution:**
  - the 2D models keep their vertical velocity;
  - landing is a frictional inelastic impulse (Alciatore TP A-14, `e_t`, `μs`), and bounces under 5 mm are killed;
  - a ball that leaves the table freezes where it crossed.
  - Ball–ball contact placement keeps balls on or above the slate by sliding them around the contact sphere (pooltool's `_constrain_to_table`).
- **Event ties:** leaving the table ranks after pockets (tier 3), and landing with the collisions (tier 4).
- **Not closing at contact.** pooltool's jaw normal tilts (it's taken from a point at cushion height), while jaws are detected in the plane. So in 3D a hopping ball can reach a jaw approaching in the plane yet separating along the normal, and pooltool raises an assertion error. It does so on 1 of the 342 3D fixture shots, on a rail. We resolve those contacts with the horizontal normal (jaws) or no impulse (rails). Every fixture pooltool completes is unaffected.

**Results** (`test/engine3d.test.ts`):
- **Coverage:** every 2D category re-run in 3D, plus jump shots, jumps at a blocker, and hard jumps at a rail: 340 shots, 7,068 events, with 2,173 landings, 38 balls leaving the table, and collisions in the air.
- **Sequence:** the same event sequence as pooltool for every shot.
- **Times:** within 2.1e-9 s, with states within 3e-8.
- **Final positions:** within 1.9 nm, including breaks.
- **Invariants:** mechanical energy, kinetic plus potential, never increases; no ball ends up below the slate; every ball ends at rest, pocketed or off the table.
- **pooltool's own 3D failures:** it couldn't complete 2 of the 342 shots, both recorded in the fixtures. One is the assertion above; the other is a frozen combination that chatters past 2,000 events.
- **Speed:** 0.05–0.17 ms for typical shots and 3.7 ms for a break, about 1.5–2× the 2D cost. Hops add events.

The game plays in 3D by default (`GameOptions.dim`).

### Mathavan collision models (Phase 3, as built 2026-11-20)

Selectable with `config.ballBall.model = "mathavan"` and `config.cushion.model = "mathavan"` (`GameOptions.models` in the game); `src/resolve/mathavan.ts`. Both integrate the impact in small steps of normal impulse, so friction at every contact acts throughout it:

- **Ball–ball** (Mathavan, Jackson & Parkin 2014): the contact between the balls, and each ball's contact with the cloth, which the ball–ball friction presses down or lifts. About 1,000 steps. Restitution applies to the normal work (Stronge's energetic coefficient). Throw friction is Alciatore's speed-dependent `μ`, as in the default model.
- **Ball–cushion** (Mathavan, Jackson & Parkin 2010): contact with the cushion above the equator, at the nose height, and with the cloth below. Both slip and rub. Steps of 0.001 N·s.
- Both assume the balls are on the cloth. In 3D, a ball in the air falls back to the closed-form models.

**Port, and three fixes to pooltool's implementations.** pooltool's code (Apache-2.0) is the reference; ours follows it step for step, with three changes. Each one replaces a step whose result pooltool leaves to rounding noise:

1. **Zero slip.** Friction needs a slip direction. For a rolling ball, the slip on the cloth is zero, and pooltool takes its direction from `atan2` of noise. A 1-ulp change in a rolling ball's speed then moved its rebound off a rail by 3e-4 m/s. Ours applies no friction for that step when the slip is below 1e-9 m/s.
2. **Restitution end (ball–ball).** pooltool's step size makes a frictionless collision land exactly on the stopping threshold. Rounding then decides whether it takes one more step, which gives 0.2% more rebound, in about half of all collisions. Ours ends with a partial step that delivers about the remaining work, as pooltool's cushion model already does.
3. **Sticking.** Once a contact's slip reaches zero, full-size friction steps chatter across zero, each in a direction set by noise. In a straight draw shot that sent the object ball sideways at ±1e-4 m/s. Ours caps each step's friction at what brings that slip to zero: 7/M per unit impulse between balls, 3.5/M at the cushion and at the cloth. The surfaces stick instead.

All three are O(step size), the model's own discretization error, and they make the result a continuous function of the input. That matters for reproducibility across machines and for the AI's aim solver. The reference fixtures come from pooltool with the same three patches (`tools/reference/mathavan_patched.py`, each change marked).

**Results:**
- **Core solvers** (`test/mathavan.test.ts`): 300 random cushion impacts and 300 random ball–ball collisions, a third of them rolling, all within 1e-12 of the reference.
  - **Conditioning:** a 1-ulp input change moves the output by about 1 ulp.
  - **Restitution:** head-on without friction, it is exactly `e`.
  - **Convergence:** halving the step halves the error. At 1,000 steps, ball–ball is within 0.5% of the converged result.
- **Whole shots** (`test/engine.test.ts`, `test/resolve.test.ts`): all 279 2D fixture shots re-run with both models, 6,256 events.
  - Every event sequence matches pooltool's.
  - Times are within 9.7e-10 s and states within 3.1e-9. Breaks are within 1.0e-7 s.
  - Final positions are within 35 nm.
  - Each collision resolved alone matches within 1.5e-12.
- **Speed:** 2–3× the default models: 0.15–0.3 ms for typical shots, 4.1 ms for a break. A hard AI plan takes about 100 ms on average.

### Pockets: interior model (Phase 3, as built 2026-11-21)

Opt-in per table (`TableSpec.pocketInterior`; the WPA 9-ft preset, and so the game, has it; pooltool's 7-ft table keeps its capture circles, so the reference fixtures are unchanged). In 2D a ball is captured when its center crosses the slate cut. In 3D (`src/detect.ts` `pocketInteriorTime`, `src/resolve/pocket.ts`, `src/pivot.ts`):

**Geometry** (`table-builder.ts`, from WPA §9 midpoints):
- **Slate cut:** the pocket's circle is the hole in the slate (edge at z = 0). Its nearest point to the table is the shelf behind the middle of the mouth: 1⅝ in at the corners, 3⁄16 in at the sides. It is tangent to both facings where they meet the slate. With a 13.5° back draft, each facing's foot is cushionHeight·tan 13.5° ≈ 9 mm behind its nose. The result is a cut about 4.3 in across at the corners and 4.5 in at the sides.
- **Open edge:** toward the table, between the facings' noses, nothing is above the edge. Elsewhere the cut continues up as a wall (the facings' undercut faces, then the liner) to the rail top (1¾ in, an estimate).

**Events:**
- **`ball_drop`:** a ball on the slate whose center crosses the edge, moving inward.
  - Fast across the edge (u² ≥ gR), it flies off.
  - Otherwise it **tips over the edge** (`pivoting`, motion state 7). It is a rigid rotation about the edge: friction takes up any slip at once, as on landing, conserving angular momentum about the contact. Its motion along the edge carries it around the edge circle.
  - In the tilt plane it is an inverted pendulum under gravity and the outward pull a = v∥²/ρ of following the curve: (7/5)Rθ̈ = g sin θ − a cos θ.
  - Timing comes in closed form from Carlson's elliptic integral R_F. The ball lets go where the edge's push g cos θ + a sin θ − RΩ² reaches zero; with no motion along the edge, that is cos θ = (10 + 7u²/gR)/17.
  - A ball moving mostly along the edge can't get past the balance angle tan β = a/g. It skims the pocket and carries on (`canTip`).
- **`pivoting_airborne`:** it lets go of the edge.
- **`ball_pocket_edge`:** a ball in the air hits the open edge (a sharp, cloth-covered edge).
  - It's a frictional inelastic impulse along the contact normal, using the landing's e_t and μs.
  - The contact is found by conservative advancement with a second-order bound, so it never steps past a contact; dense sampling in the tests confirms it.
  - A ball that settles onto the edge from inside the cut (rebound under `minBounceHeight`) rolls in: captured.
  - A ball that settles while within 0.1 mm of the slate's height rides over the edge: on the slate if heading out, tipping if heading in.
- **`ball_pocket` (capture):** the center falls to the slate's level inside the cut, or the ball reaches the wall below the rail top. WPA §10 requires liners to send balls down. The captured ball is placed at the cut's center at −depth.
- **Landings** over the cut don't happen; the ball falls in. Leaving the table through a pocket counts only once the ball flies out of the cut.

**Not modeled:**
- a ball sliding around the curved wall, or sustained rolling along the inside of the edge (both end in capture);
- other balls touching a ball while it tips (a few tens of milliseconds);
- spin effects of the edge beyond rolling.

**Checks** (`test/pocket-interior.test.ts`):
- **Geometry:** shelf, tangency and the ends of the open arc against the WPA numbers.
- **Pivot:** time against direct integration; release angle against the closed form; energy conserved while tipping.
- **Shots:** straight in at 0.26–7 m/s, all pocketed (slow ones tip, fast ones fly to the back). Below about 0.25 m/s the ball stops on the shelf, more than an inch past the mouth. A glancing ball skims a side pocket; a fast one drops, hits the far edge and climbs back out.
- **Invariants:** 270 shots into and across every pocket. Mechanical energy never increases; no ball is below the slate outside a cut; every ball ends at rest, pocketed or off the table, in under 100 events.

**Comparison with Alciatore's pocket analysis** (TP 3.5–3.8, geometric: approach angle limits with rattle allowances; his side-pocket parameters equal our WPA midpoints):

| Steepest approach angle that can still be pocketed | His analysis | Ours |
|---|---|---|
| Side pocket, slow | 68.3° | 66° |
| Side pocket, fast | 50.7° | 77° (ours includes balls that go in off the facings) |
| Corner pocket, fast | 59.8° | 50° |

Straight in, our effective target is 2.97 in (side, slow) and 2.66 in (corner, slow). Fitting these to measured pocketing data is part of the data-fitting step.

**Cost:** the computer's hard plan takes about 80 ms either way. Edge searches cost about as much as the capture circle's checks once the second-order step bound is used.

---

### Measured data (Phase 3, as built 2026-11-22)

We compare the engine with published measurements of real balls, and fit parameters to them where the data supports it. The game uses the fitted values (`MEASURED_BALL_PARAMS`, `MEASURED_MODEL_CONFIG`). `DEFAULT_BALL_PARAMS` and `DEFAULT_MODEL_CONFIG` stay pooltool's defaults, which the reference fixtures use.

- **Code:**
  - The data, with sources: `packages/physics/test/measured/data.ts`.
  - The experiments replayed in the engine (3D, Stronge or Mathavan cushion, both ball–ball models): `test/measured/experiments.ts`.
  - The report and the least-squares fits (Nelder–Mead): `node test/measured-report.ts`.
  - Regression tests: `test/measured.test.ts`.
- **Licensing:** we record measured values (facts) with citations. No text, figures or code are copied.

**Datasets**

| Data | Source | Equipment | Used for |
|---|---|---|---|
| Rail rebound angles: rolling ball, no English, 10–80° from the rail; immediate (high-speed video) and effective (after the ball stops curving) | Alciatore & Jewett, 2009 (TP B.11) | pool | fitting the cushion |
| Object-ball throw: 18 stun shots, 30° and 45° cuts, 4–36 km/h, 0 and ±50% English | Colenso, in Alciatore TP B.3 (2008) | pool | fitting throw friction |
| Rebound speed of a rolling ball straight into a cushion, 0.28–3.5 m/s, 31 shots (given only as the authors' fitted quadratic) | Mathavan et al., Am. J. Phys. 2009 | snooker | independent check |
| Speeds once both balls roll again after a ball–ball hit (5 shots) | Mathavan et al. 2009, Table I | snooker | check |
| Cloth friction: sliding 0.178–0.245, rolling 0.0127–0.0129 | Mathavan et al. 2009 | snooker cloth | check |

**Results** (RMS error; "fitted" = the game's parameters)

| Check | pooltool's defaults | fitted |
|---|---|---|
| Rail angle once the ball stops curving, Stronge cushion | 1.3° (max 2.0°) | **0.8°** (max 1.7°) |
| The same, Mathavan cushion | 3.3° (max 6.2°) | **0.8°** (max 1.1°) |
| Snooker cushion rebound speed, Stronge (not fitted to it) | 0.28 m/s | **0.14 m/s** |
| Throw, all 18 shots (either ball–ball model) | 1.77 in/yd | **0.66 in/yd** |
| Ball–ball speeds once rolling (either model) | 0.036 m/s | 0.041 m/s |

**Fitted values**

- **Cushion, Stronge model:** e_c = 0.98, f_c = 0.14 (pooltool: 0.85 and 0.20).
  - This is an independent confirmation: fitting Stronge to Mathavan's snooker rebound speeds gives e_c = 0.98 and f_c = 0.21. Mathavan et al. (Proc. IMechE C 224, 2010), fitting their own cushion model to the same experiments, give restitution 0.98 and cushion friction 0.14.
- **Cushion, Mathavan model:** e_c = 0.79, f_c = 0.17. The game picks the set that matches the cushion model in use. (Fitted to the snooker speeds instead, this model gives 0.93 and 0.18, so pool and snooker cushions differ here; we use the pool data.)
- **Throw friction:** u_b = 0.0166 + 0.215·exp(−0.607·v_rel) (pooltool: 0.00995 + 0.108·exp(−1.088·v_rel), Alciatore's fit to Marlow's three friction measurements).
  - Our fit nearly reproduces Alciatore's own fit to the same data with his closed-form model (0.016, 0.219, 0.691), which cross-checks the harness.
  - With pooltool's curve, medium-speed throw was about a third of what Colenso measured.
  - Bob Jewett's independent chart (sfbilliards.com, speeds not quantified) also shows more throw at speed than pooltool's curve gives, for example 3.7° medium and 2.2° hard at a 45° cut.

**What the data can't fix (known gaps)**

- **Throw above the rigid-ball limit.** On a stun shot, the most throw rigid balls can give is when the surfaces stop sliding: tan(throw) = 2·tan(cut) / (7(1 + e_b)). At a 30° cut that is 3.05 in/yd (4.8°).
  - Colenso measured 4.8 in/yd at soft speed. Jewett's chart shows about 6° near 27° and up to 3.25° at a 15° cut, where the limit is 2.2°.
  - No friction value can produce this. Tangential compliance at the contact (the surfaces spring back) is a likely explanation. Nothing has been modeled for it yet.
  - Outside English at 45° (measured +2.3 and +1.4 in/yd at 4 and 12 km/h) is also beyond the model.
- **Immediate rail angles.** The video-measured angles right off the rail are 3–8° below every model and parameter set we tried. Matching them would need e_c ≈ 0.66, which contradicts the effective angles and the rebound speeds. We fit only to the effective angles, which come from where the ball next hit a rail.
- **Cushion speed dependence.** The measured rebound speed levels off at high speed (cushion compression). Our models have a constant restitution, so they undershoot around 1–2 m/s and overshoot at 3.5 m/s.
- **Speeds not quantified.** "Slow" in the rail data isn't quantified; we use 4 km/h, Alciatore's "soft". The Stronge angles don't depend on speed, and Mathavan's change by under 0.5° between 0.5 and 2 m/s.
- **Rolling resistance:** kept at pooltool's 0.010. Snooker cloth measured 0.0128, and pool cloth (Simonis 860) is generally faster. No pool measurement has been found yet.
- **Pockets:** no measured pocket acceptance data has been found yet. Alciatore's pocket analysis (TP 3.5–3.8) is geometric; see "Pockets".

**Effect on the game**

- More throw on medium and fast cuts. The computer opponent's throw corrections are measured in the simulation, so they follow automatically.
- Livelier cushions.
- AI benchmark at hard level: 9-ball potting 76% (63% before), 8-ball 82% (83%).
- One AI change: when scores tie, an intended shot now beats a "safety" that happens to score as well. One such safety won by luck off several rails.

## Parameters

All parameters live in one typed registry. Each entry records its **value, unit, source (citation) and uncertainty**. The defaults are pooltool's (and the WPA's); where the game uses a value fitted to measured data, it is listed too (see "Measured data"):

| Parameter | Default | Source | Game (fitted) |
|---|---|---|---|
| Ball mass `m` | 0.170 kg | WPA spec range 5.5–6 oz | |
| Ball radius `R` | 0.028575 m | WPA 2¼″ | |
| Sliding friction `μs` | 0.20 | pooltool / Alciatore | |
| Rolling resistance `μr` | 0.010 | pooltool / Alciatore | |
| Spin decay `μsp` | ≈ 0.444·R | pooltool | |
| Ball–ball restitution `e_b` | 0.95 | pooltool / Alciatore | |
| Cushion restitution `e_c` | 0.85 | pooltool | 0.98 (Stronge), 0.79 (Mathavan) |
| Cushion friction `f_c` | 0.20 | pooltool | 0.14 (Stronge), 0.17 (Mathavan) |
| Stronge `ω` ratio | 1.8 | pooltool default | |
| Table restitution `e_t` | 0.5 | pooltool | |
| Cue end mass | (per cue spec) | Alciatore TP A-31 | |
| Throw friction `u_b(v_rel)` | 0.00995 + 0.108·e^(−1.088 v) | Alciatore TP A-14 (Marlow's data) | 0.0166 + 0.215·e^(−0.607 v) (Colenso's throws) |

---

## Validation strategy

1. **Unit tests per model.**
   - Conservation checks: energy never increases; momentum is conserved in ball–ball collisions; angular momentum is conserved about the contact point where it should be.
   - Limiting cases: frictionless gives a 90° cut-angle rule; a stun shot means the cue ball stops dead.
   - Symmetry under reflection and rotation.
2. **Property tests.** Generate random shots and check invariants: no overlaps, events in order, finite values, and simulation always finishes.
3. **Reference tests against pooltool.**
   - A Python harness runs pooltool on a fixed library of shots (break, cuts, banks, draw/follow/english, thin cuts, frozen balls, jaw rattles) and exports the events and final states as JSON.
   - Tolerances:
     - event times within `1e-6 s`;
     - final positions within `0.1 mm` for shots with ≤ 5 events.
   - Divergence on long chaotic shots like the break is expected; those are compared statistically.
   - **As built (2026-11-19):**
     - 279 shots in 8 categories (motion, cushion, jaw, cut, pocket, frozen, break, random). See `tools/reference/README.md`.
     - Every event records the post-event state of each ball involved, so failures can be pinned to a single event.
     - The fixtures satisfy our invariant checks: energy never increases, motion-state kinematics hold, and every shot ends at rest with no overlaps.
   - **pooltool conventions to account for when comparing:**
     - Resolved contacts are left 1 µm apart (`MIN_DIST`). Our `MIN_GAP` is 1e-9 m, so post-contact positions differ by up to about 1 µm by design.
     - Rails are nose cylinders at cushion height, with contact in 3D.
     - Frozen or following balls "chatter" through hundreds of micro-collisions (1,218 events in one combination shot). Compare those shots by outcome.
   - **Phase 1 engine results (2026-11-19, `packages/physics/test/engine.test.ts`):**
     - All 279 fixture shots (5,323 events) give the **same event sequence** as pooltool: same types, same balls, same order.
     - **Outside the breaks**, event times agree within 7.7e-10 s and post-event states within 7e-9 (relative).
     - **Breaks** are chaotic: a rounding-level difference roughly doubles at each collision, reaching 2.4e-6 s by event ~100. They are held to the sequence and final-position criteria.
     - **Final positions** are within 0.52 µm of pooltool's for every shot, including the breaks.
     - **Component checks** (each against every fixture event, independent of detection):
       - motion and transitions: 2,470 transitions, times to 2e-16 relative;
       - cue strike: 9e-16;
       - ball–ball: 1.5e-12;
       - rails: 6e-14;
       - jaws: 5e-14;
       - pockets: exact.
     - **Our engine's output satisfies the invariants:** energy never increases, every shot ends at rest, and no balls overlap.
   - **Findings while matching pooltool:**
     - **Stronge slip time.** In the slip–stick–slip case, the function whose root gives "slip resumes" is exactly zero where sticking *begins*, and stays ≤ 0 until the true root. pooltool brackets [t_c, t_f] and gets the right root only through its solver's iteration path; a different solver (Brent) landed on the stick start on 3 of 766 rail hits. We search for the first upward crossing after the stick start explicitly (`resolve/stronge.ts`).
     - **Cue tip.** pooltool's cue-strike docstring says the tip radius shifts the contact point, but 0.6.0's code doesn't apply it. We match the code, and flag it for Phase 3 fitting.
     - **Jaw normal.** pooltool takes the jaw contact normal from a point at cushion height (so it has a vertical component), while it detects jaw contact in the table plane. We match this for now.
4. **Tests against measured data (Phase 3).**
   - ✅ Published measurements (rail rebound angles, throw, cushion rebound speeds, ball–ball speeds, cloth friction), with least-squares fits. See "Measured data".
   - Still to come: squirt, pocket acceptance, and pool-cloth rolling resistance (no usable published data found yet); our own high-speed video, where possible.
5. **Accuracy report page.** Publish the validation results on the site. "Most accurate" should be a claim anyone can check.

---

## Performance plan

- **Memory:**
  - Ball and segment data in preallocated `Float64Array`s, or plain objects with numeric fields.
  - **No allocation inside the event loop.**
- **Reuse:**
  - Scratch buffers for the vector math.
  - Root solvers that return results through out-parameters instead of new arrays.
- **Less work:** caching as described above, plus quick rejection of pairs that can't meet.
- **Workers:** the AI search runs in a web worker; several workers can split the candidate shots.
- **Benchmarks** in CI: the break, a typical 8-ball shot, and 1,000 random shots. Track how long each takes and how many events per second the engine processes.
- **As built (2026-11-19).** Measured with `node packages/physics/test/engine-bench.ts` on Node 26, one core, over the pooltool fixture shots:

  | Shots | Before | After | Shots/s after |
  |---|---|---|---|
  | Typical (motion, cushion, jaw, cut, pocket, random) | 0.10–0.68 ms | 0.03–0.11 ms | 9,000–36,000 |
  | Frozen combinations (144 events) | 6.3 ms | 0.70 ms | 1,400 |
  | Breaks (116 events) | 19.1 ms | 1.73 ms | 580 |

  - **What changed.** All of these leave the results unchanged: the fixture comparison errors are identical to the digit.
    - Caches became flat `Float64Array`s indexed by ball and object, with `NaN` marking stale entries. Invalidating a ball touches only its own row.
    - Each ball keeps a per-row minimum for each object cache.
    - A ball's current state is evaluated lazily.
    - Quick rejection uses the trajectory horizon. A ball's segment ends at its next transition, which invalidates its entries, so only contacts within that horizon matter. The ball's reach over the horizon (exact for rolling; a triangle bound otherwise), and a relative-motion bound for pairs, skip most quartic solves.
  - **Where break time goes now.**
    - ~30% is in the quartic solver: about 14 solves per event (9 ball–ball, 5 jaw or pocket).
    - ~10% is the pair scan.
    - The rest is evaluating states and the vector helpers' allocations; GC is about 2%.
  - **Not done yet.**
    - Allocation-free vector math.
    - Per-row minima for the pair cache.
    - A tighter reach bound for long rolling horizons, by splitting each horizon into sub-intervals.
    - Benchmarks in CI.

---

## Determinism and multiplayer

- Within one build on one JavaScript engine, the simulation is deterministic: the same inputs give the same outputs, which matters for replays and tests.
- **Across browsers it may not be:** `Math.sin`, `cos`, `exp`, `atan2` and `sqrt` aren't all guaranteed to give identical results. So multiplayer **always syncs final positions**, and a replay stores its event log.
- *Optional later:* a deterministic math library if a server-authoritative mode needs it.

---

## Open questions

1. ~~Quartic solver source.~~ **Decided:** our own clean-room solver.
2. **Pocket interior model.** Which literature or measurements to base it on, and how much geometric detail is needed.
3. **Multi-contact break model.** Research is needed; keep the one-at-a-time resolution as the baseline.
4. **Cushion contact height.** Fixed, or varying with speed, decided from data.
5. **Cloth effects** (nap, slope, friction changing over a session). Are they worth adding, and would players want them as optional settings?
