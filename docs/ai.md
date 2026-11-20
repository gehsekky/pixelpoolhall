# Computer opponent

`packages/game/src/ai.ts`. It plays by searching shots against the same
physics and WPA referee as the player, so it never needs a separate model of
the game.

## How it picks a shot

1. **Pot candidates.**
   - For each legal ball (the lowest ball at 9-ball; the shooter's group, or the 8, at 8-ball) and each pocket, take the ghost-ball aim.
   - Try it at four cue speeds (1.3–5 m/s) and three tip heights: draw, center and follow.
   - **Throw and squirt correction:** simulate the shot, measure the direction the object ball actually leaves in, nudge the aim by 0.05°, and take one secant step onto the pocket line. A good player compensates the same way. A 30° cut is potted by the noiseless plan (see `test/ai.test.ts`).
2. **Safety candidates.** Soft shots every 6°, at two speeds, each called "safety" at 8-ball.
3. **Ball in hand.**
   - Try cue-ball spots behind each makeable ball: 0.15 or 0.3 m back, at cut angles of 0°, ±12° and ±25° to leave room for position.
   - Drop any spot that isn't a legal placement, including the head-string limit when ball in hand is above the head string.
   - Fully evaluate the ten easiest.
4. **Scoring.** Each candidate runs through `Game.preview`, the physics plus the referee:
   - win: +1000, loss: −1000;
   - foul: −300;
   - keep the turn: +300, plus up to +200 × the level's position weight × the next shot's ease;
   - turn passes: −200 × the opponent's best ease (a good safety scores near 0).
5. **Robustness** (Medium and Hard). The best pots and safeties are re-simulated several times under the level's own execution noise, and the best average wins. Shots it would often miss lose to safer choices.
6. **Execution.** The chosen strike is perturbed by the level's noise, and the shot is played.

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

Benchmark: AI against itself, 4 racks per level, 2026-11-19 (`AI_BENCH=1 pnpm --filter @pixelpoolhall/game test`):

| Level | 9-ball pot rate | 8-ball pot rate | Planning time, average (max) |
|---|---|---|---|
| Easy | 33% | 47% | 41–79 ms (259 ms) |
| Medium | 49% | 70% | 44–83 ms (227 ms) |
| Hard | 80% | 84% | 66–106 ms (365 ms) |

## Decisions

- **Spot the 8** whenever offered (4.3(e), (f)).
- **Otherwise,** it plans as if it had accepted the table. If that shot scores above +150, it shoots or accepts; if not, it passes, re-racks or takes ball in hand.

## Not yet

- Kick and bank shots, combinations and caroms.
- Intentional push outs.
- Sidespin candidates.
- Running the search in a Web Worker. It takes under 0.4 s, so it currently runs on the main thread behind a "thinking" status.
