# pooltool — Code Analysis

*Reviewed November 19, 2026, at commit `9e819eb1` (pushed 2026-11-18).*
*Source: https://github.com/ekiefl/pooltool · Paper: JOSS 2024*

## Purpose

To understand the most rigorous open-source billiards simulator, decide what to port to our TypeScript engine, and find where we can still go beyond it.

**Scope:** we read the event loop and detector, the motion equations, the ball–ball, ball–cushion, ball–pocket, ball–table and cue–ball models, the transition logic, the table geometry, the default parameters and the root solvers. We did not run it.

## License

**Apache-2.0** (`LICENSE.txt`, `pyproject.toml`). This is permissive: we may port and adapt its code under any license we choose.

**Obligations if we port code:**
- keep its copyright and license notice, for example in a `THIRD_PARTY_NOTICES` file plus file headers;
- mark files we changed;
- include its NOTICE file, if it has one.

---

## Architecture: an event-based engine

This is the core idea to adopt. A shot is a sequence of **events**. Between events, every ball follows a **closed-form trajectory**: a formula gives its exact position at any time, so nothing needs to be stepped forward numerically.

**The loop** (`evolution/event_based/simulate.py`):
1. Find the next event across all event types: the smallest time until any event.
2. Move every ball analytically to that time (`physics/evolve`).
3. Resolve the event with the configured model.
4. Update the caches, then repeat until no events remain.

**Event types:**
- the cue striking the ball;
- transitions: sliding→rolling, rolling→spinning in place, rolling→stopped, spinning→stopped;
- ball–ball;
- ball–straight cushion;
- ball–rounded cushion (the jaws);
- ball–pocket;
- ball–table (an airborne ball landing; 3D mode only);
- ball off the table (3D mode only).

### Why collision detection is exact

- In each motion state the acceleration is constant: sliding friction acts along a fixed direction while the ball slides, and rolling resistance acts against the velocity. So **every trajectory is a parabola** `r(t) = r0 + r1·t + r2·t²`. Airborne balls follow a parabola too.
- **Ball–ball:** the time when `|r1(t) − r2(t)| = 2R` is the root of a **quartic** (a degree-4 polynomial). Roots where the balls are moving apart are discarded (`detect/ball_ball.py`).
- **Ball–cushion:** each cushion is a **cylinder** (the nose, with a 1 mm radius) at the cushion height. A collision is a parabola meeting a circle in the cross-section, which is another quartic, with a check that the contact lies within the segment (`detect/ball_cushion.py`).
- **Ball–pocket:** the parabola meets the pocket circle, again a quartic.
- **Transition times are exact:**
  - sliding ends at `t = 2|u|/(7·μs·g)`, where `u` is the slip velocity at the contact point;
  - rolling ends at `t = |v|/(μr·g)`;
  - spinning in place ends at `t = |ωz|·(2/5)R/(μsp·g)`.

### Quartic solver

The quartic solver is a translation of **Algorithm 1010** (Orellana & De Michele, ACM TOMS 2020), which is fast and accurate (`ptmath/roots/_quartic_numba.py`). pooltool loosened one of its thresholds so that near-duplicate roots aren't missed when balls move with nearly the same velocity (Newton's-cradle cases).

Deciding whether a root is real uses mixed tolerances: `ATOL = 1e-9`, `RTOL = 1e-3`, with a cutoff of `1e-3`.

### Caching (performance)

- `CollisionCache` stores each pair's next collision time.
- After an event, only the pairs **involving the balls that changed** are recalculated. The rest stay valid, because untouched trajectories don't change.
- `TransitionCache` stores each ball's next transition.

### Simultaneous events

Events at the same time are ordered by priority tier: the cue strike first, then transitions and pockets, then balls leaving the table, then collisions. Within a tier, the event with the higher energy goes first.

The code documents that simultaneous impacts have **no single physical order**, so pooltool only guarantees that each one is resolved, one after another.

### Overlap handling

Before a cushion collision is resolved, `make_kiss` moves the ball back along its velocity to exactly `R + nose_radius + MIN_DIST` from the cushion. A fallback handles near-grazing paths. This keeps rounding errors from causing tunneling or repeated collisions.

---

## Physics models and defaults

Models can be swapped at runtime through configuration files (`resolver.yaml`). The defaults (`physics/resolve/resolver.py`):

| Interaction | Default model | Alternatives |
|---|---|---|
| Ball–ball | Frictional inelastic, an instantaneous impulse using **Alciatore's throw friction** `μ = 0.00995 + 0.108·e^(−1.088·v_rel)` | Frictionless elastic; **Mathavan 2014** (numerical impulse integration, N=1000, includes ball–table friction *during* the impact, validated against high-speed camera data) |
| Straight cushion | **Stronge compliant** (`omega_ratio = 1.8`), a closed-form solution with no numerical integration | Han 2005, Mathavan 2010, frictional inelastic impulse, perfect reflection |
| Rounded cushion (jaws) | Stronge compliant | Same family as the straight cushion |
| Cue → ball | **Instantaneous point contact** (Alciatore TP A-30), which accounts for cue mass, tip radius and elevation; **squirt** from TP A-31 (depends on the cue's end mass) | Two scaling factors: `english_throttle` and `squirt_throttle` |
| Ball → table (landing) | Frictional inelastic (TP A-14), with `e_t = 0.5`; a bounce lower than 5 mm counts as no bounce | None |
| Pocket | **"Canonical":** once the center crosses the pocket circle, the ball is placed at the pocket center at depth `−0.08` | None |
| Off table | Freeze (all motion set to zero) | None |

**Default ball parameters** (`objects/ball/params.py`):

| Parameter | Value |
|---|---|
| Mass `m` | 0.170 kg |
| Radius `R` | 28.575 mm (2¼″ ball) |
| Sliding friction `μs` | 0.2 |
| Rolling resistance `μr` | 0.01 |
| Spin-decay factor `μsp` | 10·(2/5)/9 ≈ 0.444, multiplied by R |
| Ball–ball friction `μb` | 0.05 |
| Ball–ball restitution `e_b` | 0.95 |
| Table restitution `e_t` | 0.5 |
| Cushion restitution `e_c` | 0.85 |
| Cushion friction `f_c` | 0.2 |

**Table geometry** (`objects/table/specs.py`, `layout.py`):
- Cushions are made of **straight segments plus circular jaw arcs**.
- Pocket parameters: width, facing angle (corner 5.3°, side 7.14°), depth (setback) and radius, plus the jaw radius.
- Three table types: pocket (default playing surface 1.98 × 0.99 m), carom and snooker.

---

## What to port

1. **The event loop and caching design.** This is the backbone of the engine.
2. **Parabolic trajectories by motion state** and the exact transition-time formulas.
3. **The quartic collision equations** (ball–ball, ball–cushion cylinder, ball–pocket) and the root-filtering logic: keep a root only if it is real, positive and approaching.
4. ~~**Algorithm 1010** for the quartic.~~ **Don't port it.** Its original code says copying for redistribution or posting on servers needs the author's permission, and pooltool's translation inherits those terms. **Decided:** we write our own clean-room solver (see physics-design.md). Either way, add a Newton-polish step to refine each root.
5. **The Stronge compliant cushion model.** It is closed-form, so it is fast and well suited to AI search.
6. **The Mathavan 2014 ball–ball model,** as a high-accuracy option to compare against the faster impulse model.
7. **The cue–ball model** (TP A-30) with squirt (TP A-31).
8. **The table/pocket layout generator** (segments plus jaw arcs, angled facings).
9. **The `make_kiss` overlap correction.**

## Where pooltool can still be beaten

These are our opportunities to become "the most accurate."

1. **Pockets are the weakest part.** The "Canonical" model teleports a ball into the pocket as soon as its center crosses a circle. There is no pocket interior (shelf, drop edge, back wall, liner). A ball can't rattle *inside* the pocket and come back out, and how a ball falls doesn't depend on its speed or spin. Jaw rattles *are* modeled, because the jaws are rounded cushion segments.
   - **Ours:** model the pocket's 3D interior: the slate cut, the shelf depth, the drop edge and the back facing. A ball falls when its contact point leaves the slate (edge-tipping physics) and can still rebound out.

2. **Cushion contact is a single point at a fixed height.** The cushion nose is a 1 mm cylinder at a fixed height. Real rubber deforms, and the contact height changes with speed.
   - Stronge's compliant model captures some of the effect.
   - We could add speed-dependent contact height or restitution, using measured data (Alciatore's cushion measurements).

3. **The cloth is uniform.** There is no nap direction, no table slope or roll-off, and friction is constant (no dependence on speed or wear). Nap and slope are second-order effects, but a "hyper-realistic" simulator could offer them.

4. **Spin decay is simple.** Spin about the vertical axis decays at a constant rate, and rolling resistance is constant. Real rolling resistance depends slightly on speed. Higher-fidelity models exist in the literature.

5. **Ball–ball collisions are instantaneous by default.** Mathavan 2014 is more accurate but takes 1000 iterations. A fast but faithful surrogate is possible, for example a closed-form fit to Mathavan's results.

6. **Simultaneous collisions are resolved one by one.** The break and frozen clusters (balls touching each other) are handled sequentially by priority. A true **simultaneous multi-contact** solver (e.g. LCP or compliant contacts) could model the break more realistically. This is the hardest item and an open research question.

7. **3D is optional and partial.**
   - The 2D default zeroes vertical velocity.
   - Detection for airborne balls against straight cushions is marked "broken" in the code.
   - Balls leaving the table are frozen, not simulated.
   - We should design for 3D from the start: jumps, landings, balls hopping the rail.

8. **There is no experimental validation dataset in the repo.** Its accuracy rests on the published models. Gathering or referencing real measured shot data (high-speed video, Alciatore's measurements) and fitting parameters to it would set our engine apart.

9. **Numerical edge cases.**
   - Root realness uses fixed tolerances, with known tradeoffs for near-tangent (very thin) contacts.
   - We could polish each root with Newton's method on the original distance function and handle near-double roots explicitly, so the thinnest cuts are reliable.

## Performance notes for a TypeScript port

- pooltool uses Numba (a Python compiler) to make its math fast; JavaScript engines run plain numeric code at comparable speed.
- **Fixed-size arrays and plain numbers:**
  - Use `Float64Array` or plain number fields with no per-call memory allocation.
  - Avoid creating `Vector3`-style objects in hot paths.
- **Evolve balls lazily.** pooltool's `evolve` moves *every* ball at *every* event; its own `FIXME` comment says so. Instead, store each ball's trajectory (its parabola coefficients plus a start time) and compute positions only when needed. This is a significant speedup.
- **Spatial broad phase.** It isn't needed for 16 balls, but a simple bounding-time test can skip quartic solves for pairs that can't possibly meet.
- **Rendering:** sample the stored trajectories at any frame rate. The physics never needs to run at render rate.

## Verdict

pooltool is the right **reference and porting source**. It has a sound event-based architecture, published models, a permissive license, and caching worth copying. Our edge comes from:
1. **Real pocket physics,**
2. **3D designed in from the start,**
3. **Parameters fitted to measurements,**
4. **Robust numerics for thin contacts,**
5. **A fast, allocation-free TypeScript implementation** that can run thousands of shots per second for the AI.
