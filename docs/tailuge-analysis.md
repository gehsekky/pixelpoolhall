# tailuge/billiards — Code Analysis

*Reviewed November 19, 2026, at commit `3a95e4b6` (pushed 2026-11-18).*
*Source: https://github.com/tailuge/billiards*

## Purpose

To find where the leading open-source web billiards simulator can be beaten on **accuracy** and **performance**. Our goal is the most accurate web billiards simulator on the internet.

**Scope:** we read the core physics (`src/model/ball.ts`, `src/model/table.ts`, and everything in `src/model/physics/`). We did not run it or read its UI, game rules or network code.

## License

**GPL-3.0.** The LICENSE file and `package.json` both say so, and so does GitHub's license detection. The itch.io page's "LGPL v3" is wrong.

**Policy:** use it only as a behavioral reference, to compare how shots look and feel. **Do not copy its code** unless we deliberately decide to license our project under GPL-3.0.

---

## How it works

| Area | Implementation | File |
|---|---|---|
| Time integration | Fixed step `dt = 1/512 s` (~1.95 ms); explicit Euler for sliding, trapezoid rule for rolling | `container/container.ts:112`, `model/ball.ts` |
| Ball motion | Han (2005) sliding/rolling friction model with constant deceleration | `physics/physics.ts` |
| Ball–ball | Single instantaneous impulse; Alciatore TP A-14 throw model with speed-dependent friction `μ = 0.01 + 0.108·e^(−1.088·v)`; `e = 0.925` | `physics/collisionthrow.ts` |
| Cushion | Three models you can switch between: Han 2005 with a "blend" modification (the default), Mathavan 2010 (numerical impulse integration, N=100), Stronge compliant model (used by the worker) | `physics/physics.ts`, `mathavan.ts`, `stronge.ts` |
| Jaws (knuckles) | Circles; simple bounce off the normal with restitution `e`; spin halved | `physics/knuckle.ts` |
| Pockets | Circle; ball falls once its center crosses the radius; the fall is scripted animation | `physics/pocket.ts` |
| Cue strike | Spin from Alciatore TP A-12; elevation tilts the spin axis | `physics/physics.ts` (`cueStrike`, `cueToSpin`) |
| Collision detection | Discrete: overlap is checked at `pos + vel·dt`; all ball pairs are checked every step | `model/table.ts`, `physics/collision.ts` |

### Strengths worth matching

- **Throw:** a good ball–ball model, with friction that depends on how fast the balls' surfaces slide against each other.
- **Cushions:** three cushion models with adjustable parameters, plus sliders and URL parameters for tuning.
- **Validation against real shots:** there is tooling to overlay real recorded shots (`src/diagram/real/`) and to fit parameters to data (`test/fit/`).
- **Headless physics:** the physics runs without rendering, in a web worker, which is what an AI opponent and a server need.

---

## Accuracy gaps (our opportunities)

1. **Fixed time step and late collision detection.** This is the most important gap.
   - Collisions are detected by checking for overlap at the *end* of a step. The impulse is then applied while the balls are still at their *pre-contact* positions, so each collision's timing is off by up to one step (about 2 ms).
   - These errors add up across a break or a multi-rail shot.
   - A thin cut whose contact happens only mid-step can be **missed entirely**.
   - **Our approach:** an event-based engine that solves analytically for the exact time of each collision and each change in motion (sliding to rolling, rolling to stopped).

2. **Collisions in a cluster are resolved one pair at a time.** They're processed in the order the pair list happens to be in, which affects breaks and clusters, exactly where the order matters. If more than 100 collisions need resolving within one step, it throws `"Depth exceeded resolving collisions"`.
   - **Ours:** a well-defined event order plus a deliberate model for simultaneous collisions, checked against reference break data.

3. **Precision is deliberately reduced.** `Ball.fround()` rounds all ball state to float32 **every step**, so that different clients produce the same numbers. Rounding repeatedly over a whole shot adds error.
   - **Ours:** full 64-bit (float64) precision throughout, and multiplayer syncs only final positions.

4. **The sliding-to-rolling switch is a fixed threshold.** A ball is forced into rolling when its slip speed drops below 0.05 m/s (`Ball.transition`), but the exact time is known analytically: `t = 2|u₀| / (7·μs·g)`.
   - There are also hand-tuned fixes: spin wears off 12× faster when `|ωz| > 24` (`rollingFull`), and speeds below a set value are snapped to zero (`eps = 0.1`).

5. **Pockets and jaws are crude.** These are where players notice realism most.
   - Jaws are circles with a simple bounce and spin halved, with no friction or spin interaction.
   - The pocket is a circle with a "center inside radius" test. There is no angled facing, no shelf, no drop edge, and no rattle where a ball hits the jaws and stays out.
   - The fall into the pocket is scripted with magic constants (`R*10*g`, `R*7*g`) and a resting depth that depends on the ball's ID.
   - **Ours:** real pocket geometry (facing angle, mouth width, shelf depth) based on WPA specs, with jaws modeled as real cushion surfaces.

6. **Rails are straight lines with a fixed contact height.** An impact is detected when the ball's next position crosses the rail line, so there is no exact impact time.

7. **Balls never leave the table.** `vel.z` is always zero on the table. Jump shots, airborne balls, balls landing back on the cloth and balls leaving the table aren't possible.

8. **The cue strike uses made-up formulas.**
   - `speed = power·(1 − 0.25·offset²)` is a made-up formula.
   - There is no model of the cue tip contacting the ball and no **squirt** (the cue ball deflecting when struck off-center).
   - Swerve does come out of the physics on its own, because elevation tilts the spin axis and sliding friction acts on it.

9. **Constants are fixed in code.**
   - Ball–ball restitution is fixed at `0.925`.
   - The cushion contact height is fixed (`sinθ = 2/5`).
   - The Han cushion uses a different contact offset (`ε = 0.1R`) from the Mathavan cushion.

## Performance gaps

- **All work happens every step.** At 512 Hz it checks every ball pair (105 for 15 balls) plus every rail, jaw and pocket, even when balls are slow or stopped. An event-based engine only does work at events, which matters for an AI that simulates thousands of candidate shots.
- **Avoidable memory churn.** The Han cushion functions (`s0`, `Pze`, `impulseToDelta`) and the pocket fall code create new `Vector3` objects on every call, which creates work for the browser's memory cleanup.
- **The Mathavan cushion is computed numerically.** It takes about 100 or more iterations per cushion impact, which is acceptable but adds up during AI search.
- **The physics depends on Three.js.** It uses Three.js `Vector3`. Pure numeric code with no rendering library would be lighter and easier to run on a server.

---

## Implications for our engine

1. **Event-based simulation,** solved analytically between events. This gives both higher accuracy and faster AI search.
2. **Full float64 precision.** Never round ball state during a simulation.
3. **Exact transition times** for sliding to rolling to spinning in place to stopped.
4. **Realistic pocket and jaw geometry,** with jaws treated as cushions.
5. **A collision model that supports airborne balls** (jumps, landings), designed in from the start.
6. **A cue–tip model that includes squirt.**
7. **Every physical constant is a named, documented parameter** with a citation (paper or measurement).
8. **Validate against a reference implementation** (pooltool) and against real shot data.

*See also: [pooltool-analysis.md](pooltool-analysis.md).*
