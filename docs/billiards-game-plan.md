# Billiards Game — Project Plan

*Created November 19, 2026 · Revised November 19, 2026*

## Goal

**The most accurate web billiards simulator on the internet.**

- 8-ball and 9-ball on a regulation pool table.
- Free to play, and self-hosted on our own web server.
- **Not targeting** Steam, consoles or web game portals. This was decided on November 19, 2026, and it removes the platform abstraction layer and the console limits from scope.
- **MVP:** a single player against a computer opponent.
- **Later:** online multiplayer between friends.

**Accuracy is the product.** Every physical behavior should come from a published model or measured data, and our implementation should be checked against a reference simulator.

---

## Licensing policy

Because the game is free and self-hosted, the licenses of the things we use set our legal limits. **Before adopting any library, asset, font or code, check its license and record it in the table below.**

| Project | License | How we use it | Obligations |
|---|---|---|---|
| tailuge/billiards | **GPL-3.0** (verified in LICENSE and package.json; itch.io's "LGPL" is wrong) | Behavioral reference only: compare how shots look and feel. **We copy no code.** | None, as long as no code is copied |
| pooltool | **Apache-2.0** | Reference implementation and porting source | Keep the copyright and license notices in `THIRD_PARTY_NOTICES` and in file headers; mark files we change |
| Algorithm 1010 (quartic solver, ACM TOMS 2020), code by C. De Michele | **Restrictive** (checked 2026-11-19 in the `quartic_C` and `quarticpp` READMEs): copies are allowed only for personal or classroom use, and "to post on servers or to redistribute… requires prior specific permission" | **Do not port the author's code, or pooltool's translation of it** (pooltool's Apache license can't override the original terms) | **Decided:** we write our own quartic solver (see physics-design.md) |
| Published papers (Han 2005, Mathavan 2010/2014, Stronge, Alciatore TPs, Aberth 1973, Bini 1996) | Copyright covers the text, not the math | Implement the equations ourselves | Cite them in code and docs |
| NumPy 2.5.5 (BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0; bundles OpenBLAS, BSD-3-Clause, and the GCC runtime under the GCC Runtime Library Exception) | Permissive (verified 2026-11-19 from the wheel metadata and license file) | Reference harness only (`tools/reference`): accuracy comparison for our solvers. Not shipped | None for shipped code |
| pooltool's Python dependencies (numba, llvmlite, scipy, panda3d, attrs, cattrs, msgpack, h5py, Pillow, rich, …) and uv | All permissive: MIT, BSD-2/3-Clause, Apache-2.0, PSF-2.0, MIT-CMU (verified 2026-11-19 from each package's metadata) | Reference harness only. Not shipped | None for shipped code |
| Vite 8 (MIT) and its dependencies: MIT, Apache-2.0, ISC, BSD-3-Clause, plus lightningcss (**MPL-2.0**) | Verified 2026-11-19 from each installed package.json | Dev server and bundler for `packages/web`. lightningcss only processes our CSS at build time and none of its code ships, so MPL's file-level copyleft doesn't reach our code | None for shipped code |
| Dev tools: TypeScript (Apache-2.0), Vitest (MIT), oxlint (MIT), @types/node (MIT) | Permissive (verified 2026-11-19 from each package.json) | Build and test only; not shipped to players | None for shipped code |

**Our project license: MIT** (decided 2026-11-19).
- **Apache-2.0 code we port from pooltool can be included in an MIT project.** Those files keep their Apache-2.0 header and a "modified" note, and pooltool's license and notices go in `THIRD_PARTY_NOTICES`.
- **No GPL code may enter the repo.** GPL would force the whole project to be GPL.
- **No code under restrictive terms may enter the repo,** such as Algorithm 1010's.

*(Not legal advice.)*

---

## Platform

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere: the physics, the AI, the client and the server |
| Physics | **Our own event-based engine:** pure TypeScript with zero runtime dependencies, so it runs headless in a browser, a web worker or Node. See [physics-design.md](physics-design.md) |
| Rendering | Three.js for the 3D table; a simple 2D canvas view for debugging the physics |
| AI | Runs in a web worker using the headless engine |
| Backend (later) | Node + WebSockets for friend games; static hosting for everything else |

**Why web:** play instantly from a link, and the same physics code runs in the browser and on the server. 3D graphics needs are modest.

---

## Architecture overview

```
┌──────────────┐   shot params   ┌────────────────────┐
│  UI / input  │ ──────────────▶ │  Physics engine    │  pure TS, no deps
│  (Three.js)  │ ◀────────────── │  (event-based)     │  runs in worker / Node
└──────────────┘  shot result:   └────────────────────┘
       ▲          events + exact          ▲
       │          trajectories            │ many simulations
┌──────────────┐                 ┌────────────────────┐
│  Game rules  │                 │  AI shot search    │
│ (8/9-ball)   │                 │  (worker)          │
└──────────────┘                 └────────────────────┘
```

- **The engine is the source of truth.** A shot goes in; a list of events and exact trajectory segments comes out. The renderer reads ball positions from those segments at any frame rate.
- **Game rules read the event list,** for example: first ball hit, balls pocketed, whether any ball touched a rail after contact, scratches.
- **The AI** generates candidate shots, simulates them headless and scores the results. It then adds random error to the chosen shot to set the difficulty.
- **Multiplayer** sends the shot inputs and the final ball positions. Never assume two clients simulate identically: JavaScript's `Math.sin` and similar functions can differ between engines.

---

## Prior art (analyzed)

- [tailuge-analysis.md](tailuge-analysis.md): the leading web simulator. It uses fixed time steps, rounds to float32 every step, and has scripted pockets and no airborne balls.
- [pooltool-analysis.md](pooltool-analysis.md): the most rigorous open simulator. It is event-based and solves exact collision times with quartics. Its weaknesses are pockets, 3D and the lack of real-world validation data.

**Where we aim to beat both:**
1. **Real 3D pocket physics,** with balls able to rattle out.
2. **3D designed in from the start,** including jumps and airborne balls.
3. **Parameters fitted to measured data.**
4. **Robust numerics for very thin cuts.**
5. **A fast, allocation-free implementation,** so the AI can simulate thousands of shots per second.

---

## Roadmap

### Phase 0: Foundations
- ✅ Repo: pnpm workspace, TypeScript, Vitest, oxlint (`packages/physics`, `packages/game`, `packages/web`). Still to do: CI.
- ✅ MIT `LICENSE` (copyright gehsekky) and `THIRD_PARTY_NOTICES.md`.
- ✅ Our own quadratic, cubic and quartic solvers, verified against exact roots. See physics-design.md, "Root solving".
- ✅ Compared with NumPy `roots` (LAPACK): ours is more accurate on every test family, and NumPy loses all accuracy on 43% of wide-range cases. The Python reference environment lives in `tools/reference`.
- ✅ **Reference harness:** `tools/reference/pooltool_fixtures.py` runs pooltool (pinned commit) on 279 shots in 8 categories and exports deterministic JSON fixtures to `packages/physics/test/fixtures/pooltool/`. Tests check the fixtures for integrity, pooltool's contact conventions and physical invariants; our engine will be tested against them in Phase 1.

### Phase 1: Physics core (2D, on the table)
- ✅ Event loop, motion states, exact transition times, caching (`packages/physics/src/engine.ts`).
- ✅ Event detection with our own quartic solver (`detect.ts`).
- ✅ Ball–ball collisions (frictional inelastic with throw), cushions (Stronge compliant), jaws, the cue strike with squirt (`resolve/`).
- ✅ Pockets: pooltool's simple "canonical" model.
- ✅ **Exit criterion met (2026-11-19):** all 279 pooltool fixture shots reproduce the same event sequence. Outside the breaks, times agree within 1e-9 s; every shot's final positions agree within 0.52 µm. See physics-design.md, "Validation strategy".
- ✅ **Performance, first pass.** Typical shots take 0.03–0.11 ms (9,000–36,000 shots/s, against a design goal of under 1 ms), and breaks take 1.7 ms (580/s), 11× faster than before. Results are unchanged. Remaining ideas are in physics-design.md, "Performance plan".
- ✅ **Table builder** (`TableSpec` → rails, jaws, pockets). It reproduces pooltool's geometry bit for bit. ✅ WPA 9-ft preset from the WPA equipment specifications (the game's default table).
- ✅ **2D debug view** (`packages/web`, `pnpm --filter @pixelpoolhall/web dev`). It replays any fixture shot through our engine and shows paths, color-coded event markers, a scrubbable timeline, editable strike parameters, and pooltool's event positions as rings. Deep links: `#category/shot@time`.

### Phase 2: Playable game
- A Three.js table, aiming UI, and controls for spin, elevation and power.
- ✅ **8-ball and 9-ball rules** (`packages/game`), from the WPA Rules of Play and Regulations effective 2026-10-21. Covers the break and its options, open table and groups, called shots and safeties, push out, the three-ball break rule, three consecutive fouls, spotting, and cue ball in hand (including the head-string restrictions). It also includes WPA racks and a `Game` session that runs shots through the physics and applies each ruling. See [rules.md](rules.md).
- Computer opponent using shot search, with difficulty levels.

### Phase 3: Accuracy beyond the references
- **3D:** airborne balls, jump shots, landings, balls hopping the rail.
- **Pocket interior:** shelf, drop edge, back facing, rattle.
- **Accuracy options:** Mathavan 2014 ball–ball model as a selectable high-accuracy mode.
- **Fitting to real data:** collect measured shot data (high-speed video, Alciatore's data) and fit our parameters to it.
- **Optional extras:** cloth nap and table slope.

### Phase 4: Play with friends
- Invite link, turn taking and syncing final positions; shot replays.

### Later (optional)
- Accounts, friends lists, leaderboards.
- A research-grade multi-contact solver for the break.
