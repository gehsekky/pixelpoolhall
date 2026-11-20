# Rules implementation

`packages/game` implements 8-ball and 9-ball from the **WPA Rules of Play** and
**WPA Regulations**, both effective 2026-10-21, at https://wpapool.com/rules-of-play/.
Code comments and ruling notes cite rule numbers. The WPA text is paraphrased,
not reproduced.

## How a shot is judged

1. **`simulate`** (physics) runs the shot and returns the event list.
2. **`shotFacts`** (`facts.ts`) reads off what the rules need:
   - the first ball the cue ball contacts;
   - balls pocketed (and which pocket), and balls driven off the table;
   - whether a ball reached a rail after contact;
   - the distinct object balls that reached a rail;
   - head-string crossings.
3. **`judge`** (`rules/`) applies the discipline's rules to the facts and the
   pre-shot state. It returns a `Ruling`: the new state, fouls, balls to spot,
   whether to re-rack, and plain-language notes.
4. **`decide`** resolves a pending choice, such as the options after an
   illegal break or a push out.
5. **`Game`** (`session.ts`) ties the steps together:
   - keeps ball positions;
   - removes pocketed balls;
   - spots balls (WPA 1.5);
   - places the cue ball when it's in hand;
   - re-racks and alternates the break (1.3).

The rules are pure functions of state and facts. The AI can score candidate
shots by running `simulate` and `judge` without touching the live game.

## Interpretations

Where the rules leave room, or a simulation can't reproduce the situation exactly, we chose as follows:

- **Simultaneous contacts (3.2, 3.3).** WPA gives the shooter the benefit of the doubt when a referee can't tell which contact came first. The simulation always knows the order. We treat contacts within 1 µs as simultaneous; in practice that means exact ties.
- **Driven to a rail (2.7).** A cushion or jaw collision event counts. A ball frozen to a rail produces no event unless it leaves the rail and returns, which matches the rule.
- **Crossing the head string (3.11, Regulation 16).** We evaluate each ball's exact path, including the vertex of each parabolic segment, up to the moment it's pocketed.
  - The cue ball has crossed when its center reaches the head string.
  - An object ball has crossed when its center goes beyond it.
- **Scratch on the 8-ball break (4.3(h)).** The incoming player's options are to accept the table or take cue ball in hand above the head string. With the cue ball pocketed, accepting the table isn't possible, so ball in hand above the head string is applied directly.
- **The 8 on a foul break, "re-breaking" (4.3(f)).** The opponent re-racks and breaks.
- **Three consecutive fouls (3.13).** Our referee always warns a player who is on two fouls, so a third foul always loses the rack. The count is per rack, and any legal shot resets it.
- **Three-ball rule (Regulation 16).** On by default, as at WPA ranking events (`rules.threeBallRule`). Balls pocketed and balls that crossed the head string are counted together, with no ball counted twice.
- **Racks (4.2, 5.2).** "As tightly as possible" becomes a nominal gap of 2R·10⁻³ between balls, with a seeded random displacement of up to a quarter of the gap. Neither can create an overlap. This matches the tight-but-not-perfect racks in pooltool's reference breaks.
- **Spotting (1.5).** A spotted ball is placed 1 µm from the ball it rests against ("in contact"), and 1 mm from the cue ball ("a small separation").
- **Cue-ball placement (1.6).** Anywhere on the playing surface that doesn't overlap a ball or sit inside a pocket's capture circle. Above the head string, when restricted (3.10).

## Options

- **`rules.callShots`** (8-ball, default on). With calls off, which is not a WPA rule, the first legal ball pocketed counts as called, in the pocket it went in; that includes the 8. The 3D view runs with calls off until it has a call-shot picker.

## Not modeled

- **Fouls that need a person at the table:** foot on floor, touched ball, double hit, push shot, balls still moving, playing out of turn, slow play, rack template.
- **Spotting a ball above the head string on request (1.6).** A player with cue ball in hand above the head string may ask for this when every legal ball is above the string. Planned.
- **Stalemate (1.13, 4.11, 5.9).**
- **Balls driven off the table.** The physics doesn't produce them until Phase 3 (airborne balls). The rules already handle them: a foul, and the 8 or 9 is spotted where the rules say.
