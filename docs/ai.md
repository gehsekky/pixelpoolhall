# Computer opponent

`packages/game/src/ai.ts`. It plays by searching shots against the same
physics and WPA referee as the player, so it never needs a separate model of
the game.

## How it picks a shot

1. **Pot candidates.**
   - For each legal ball (the lowest ball at 9-ball; the shooter's group, or the 8, at 8-ball) and each pocket, take the ghost-ball aim.
   - Try it at four cue speeds (1.3–5 m/s) and three tip heights: draw, center and follow.
   - **Throw and squirt correction:** simulate the shot, measure the direction the object ball actually leaves in, nudge the aim by 0.05°, and take one secant step onto the pocket line. A good player compensates the same way. A 30° cut is potted by the noiseless plan (see `test/ai.test.ts`).
2. **Harder shots, when the direct options are weak.** Their aim starts from mirror geometry and is then *solved in the simulation*, because real cushions don't reflect like mirrors (friction, spin and nose height bend the rebound):
   1. Sweep the aim over ±1.2–2.5° around the geometric guess.
   2. At each aim, measure a signed miss: how far, and on which side, the ball's simulated path passes the pocket. For kicks, it's the cue ball's contact offset on the object ball.
   3. Take the sign change nearest the guess, ignoring jumps of more than 25 cm, which are discontinuities such as a jaw.
   4. Refine with Illinois regula falsi, five steps.

   The shot types:
   - **Banks** (one rail): aim at the pocket mirrored across the rail. Bank points near the corners or the side-pocket mouths are skipped.
   - **Combinations:** cue ball → legal ball A → ball B → pocket, with cut limits of 55° at A and 45° at B. At 9-ball, combinations on the 9 are always tried, because they win the rack.
   - **Kicks** (one rail): when every option fouls or leaves a disaster (snookered), aim at the object ball mirrored across a rail, solving for a full hit.
   - **Push outs** (9-ball, 5.4): soft shots in every direction. Since the opponent then chooses who shoots, a push is worth −200·|2E − 1|, where E is the next shot's ease: best when it's a coin flip. The computer pushes only if that beats everything else.
3. **Safety candidates.** Soft shots every 6°, at two speeds, each called "safety" at 8-ball.
4. **Ball in hand.**
   - Try cue-ball spots behind each makeable ball: 0.15 or 0.3 m back, at cut angles of 0°, ±12° and ±25° to leave room for position.
   - Drop any spot that isn't a legal placement, including the head-string limit when ball in hand is above the head string.
   - Fully evaluate the ten easiest.
5. **Scoring.** Each candidate runs through `Game.preview`, the physics plus the referee:
   - win: +1000, loss: −1000;
   - foul: −300;
   - keep the turn: +300, plus up to +200 × the level's position weight × the next shot's ease;
   - turn passes: −200 × the opponent's best ease (a good safety scores near 0).
6. **Robustness** (Medium and Hard). The best pots and safeties are re-simulated several times under the level's own execution noise, and the best average wins. Shots it would often miss lose to safer choices.
7. **Execution.** The chosen strike is perturbed by the level's noise, and the shot is played.

## Shot ease

Ease is the chance of potting the shot with a 0.15° aim error:
- the pocket's tolerance seen from the object ball: half the opening minus a ball radius, narrowed by the approach angle, divided by the object–pocket distance;
- carried back to the cue ball: a cue-ball aim error δφ moves the contact point by d₁·δφ, which turns the object ball by d₁·δφ / (2R·cos θ).

Ease is zero for blocked paths, for cuts over 78°, and for approaches outside the pocket's opening (60° at the side pockets, 75° at the corners).

## Levels

| Level | Aim σ | Speed σ | Tip σ | Position | Robustness check |
|---|---|---|---|---|---|
| Easy | 0.5° | 12% | 0.06 R | none | off |
| Medium | 0.2° | 7% | 0.03 R | 0.6 | 6 finalists × 6 samples |
| Hard | 0.07° | 4% | 0.015 R | 1.0 | 10 finalists × 10 samples |

Benchmark: AI against itself, 4 racks per level, 2026-11-20, with banks, combinations, kicks and push outs (`AI_BENCH=1 pnpm --filter @pixelpoolhall/game test`):

| Level | 9-ball pot rate | 8-ball pot rate | Fouls (9-ball / 8-ball) | Planning time, average (max) |
|---|---|---|---|---|
| Easy | 38% | 38% | 20 / 18 | 45–84 ms (288 ms) |
| Medium | 47% | 77% | 3 / 5 | 48–88 ms (246 ms) |
| Hard | 83% | 81% | 2 / 0 | 69–121 ms (413 ms) |

Pot rates count banks and combinations. Over 4 racks they vary by about ±10 points between runs. Banks, combinations and kicks appear in roughly 1 shot in 15. That's expected: they're searched only when no direct pot is makeable.

## In the browser

The 3D view runs the search in a Web Worker (`packages/web/src/play/ai-worker.ts`). It sends a plain-data `Game.snapshot()` and an RNG seed, and drops any answer that arrives after a new game or rack has started. Execution noise is applied on the main thread. A 10 ms main-thread timer shows no extra stall while the computer thinks (14 ms worst gap, the same as idle).

## Decisions

- **Spot the 8** whenever offered (4.3(e), (f)).
- **Otherwise,** it plans as if it had accepted the table. If that shot scores above +150, it shoots or accepts; if not, it passes, re-racks or takes ball in hand.

## Not yet

- Two-rail banks and kicks, caroms (cue ball off an object ball), and sidespin candidates.
- Ball-in-hand placement for banks and combinations (placements currently target direct pots).
