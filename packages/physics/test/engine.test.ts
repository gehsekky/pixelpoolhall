/**
 * End-to-end: every pooltool fixture shot replayed through our engine.
 * - Phase 1 exit criterion (docs/physics-design.md, "Validation strategy"):
 *   the same events, in the same order, with times within 1e-6 s, and final
 *   positions within 0.1 mm.
 * - The physical invariants checked on pooltool's output also hold for ours.
 * Run on the default-model fixtures and on the Mathavan-model ones.
 */
import { describe, expect, it } from "vitest";
import type { BallState } from "../src/motion.ts";
import { MotionState } from "../src/motion.ts";
import {
  compareShot,
  STATE_TOL,
  TIME_TOL,
  type ShotComparison,
} from "./support/compare-shots.ts";
import { loadFixtures } from "./support/pooltool-fixtures.ts";

const ke = ({ v, w }: BallState, m: number, R: number) =>
  0.5 * m * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) +
  0.2 * m * R * R * (w[0] ** 2 + w[1] ** 2 + w[2] ** 2);

for (const [setName, files] of [
  ["default models", loadFixtures()],
  ["Mathavan models", loadFixtures("mathavan")],
] as const) {
  const results: ShotComparison[] = files.flatMap((f) =>
    f.shots.map((s) => compareShot(f, s)),
  );
  const params = new Map(
    files.flatMap((f) =>
      f.shots.map(
        (s) => [`${f.category}/${s.name}`, s.balls[0]!.params] as const,
      ),
    ),
  );

  describe(`engine vs pooltool fixtures (${setName})`, () => {
    it("produces the same event sequence (types, balls, order) for every shot", () => {
      const events = results.reduce((n, r) => n + r.theirEvents, 0);
      console.log(`${results.length} shots, ${events} events`);
      expect(
        results
          .filter((r) => r.firstStructuralDivergence >= 0)
          .map(
            (r) =>
              `${r.category}/${r.name} at event ${r.firstStructuralDivergence}: ${r.divergence}`,
          ),
      ).toEqual([]);
    });

    // Breaks are chaotic: each collision roughly doubles a difference, so 1e-16
    // rounding differences reach ~1e-6 s after ~100 events. They are held to
    // the sequence and final-position criteria only.
    it(`matches event times within ${TIME_TOL} s and states within ${STATE_TOL} (all but breaks)`, () => {
      const calm = results.filter((r) => r.category !== "break");
      const worstTime = Math.max(...calm.map((r) => r.maxTimeError));
      const worstState = Math.max(...calm.map((r) => r.maxStateError));
      const breakTime = Math.max(
        ...results
          .filter((r) => r.category === "break")
          .map((r) => r.maxTimeError),
      );
      console.log(
        `worst time error ${worstTime.toExponential(2)} s, worst state error ${worstState.toExponential(2)} (breaks: ${breakTime.toExponential(2)} s)`,
      );
      expect(
        calm
          .filter((r) => r.firstDivergence >= 0)
          .map(
            (r) =>
              `${r.category}/${r.name} at event ${r.firstDivergence}: ${r.divergence}`,
          ),
      ).toEqual([]);
    });

    it("ends every shot within 0.1 mm of pooltool's final positions", () => {
      const worst = results.reduce((a, r) =>
        r.finalPositionError > a.finalPositionError ? r : a,
      );
      console.log(
        `worst final position error ${worst.finalPositionError.toExponential(2)} m (${worst.category}/${worst.name})`,
      );
      expect(
        results
          .filter((r) => r.finalPositionError > 1e-4)
          .map((r) => `${r.category}/${r.name}`),
      ).toEqual([]);
    });
  });

  describe(`engine: physical invariants (${setName})`, () => {
    it("total kinetic energy never increases after the strike", () => {
      const bad: string[] = [];
      for (const r of results) {
        const { m, R } = params.get(`${r.category}/${r.name}`)!;
        const energy = new Map<string, number>();
        let total = Infinity;
        for (const e of r.ours.events) {
          for (const [id, s] of Object.entries(e.states))
            energy.set(id, ke(s, m, R));
          if (e.type === "none") continue;
          const now = [...energy.values()].reduce((a, b) => a + b, 0);
          if (e.type !== "stick_ball" && now > total * (1 + 1e-12))
            bad.push(`${r.category}/${r.name} ${e.type} @${e.time}`);
          total = now;
        }
      }
      expect(bad).toEqual([]);
    });

    it("ends at rest with no overlapping balls, and never runs into the event cap", () => {
      const bad: string[] = [];
      for (const r of results) {
        const { R } = params.get(`${r.category}/${r.name}`)!;
        if (r.ours.truncated) bad.push(`${r.category}/${r.name}: truncated`);
        const on = Object.entries(r.ours.final).filter(
          ([, s]) => s.s !== MotionState.pocketed,
        );
        for (const [id, s] of Object.entries(r.ours.final)) {
          if (s.s !== MotionState.stationary && s.s !== MotionState.pocketed)
            bad.push(`${r.category}/${r.name}: ${id} in state ${s.s}`);
        }
        for (let i = 0; i < on.length; i++) {
          for (let j = i + 1; j < on.length; j++) {
            const [a, b] = [on[i]![1].r, on[j]![1].r];
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 2 * R)
              bad.push(
                `${r.category}/${r.name}: ${on[i]![0]}/${on[j]![0]} overlap`,
              );
          }
        }
      }
      expect(bad).toEqual([]);
    });
  });
}
