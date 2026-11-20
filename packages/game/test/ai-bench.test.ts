/**
 * AI-vs-AI benchmark (opt-in: AI_BENCH=1 pnpm --filter @pixelpoolhall/game test).
 * Prints pot rate, fouls and planning time per level.
 */
import { it } from "vitest"
import { AI_LEVELS, chooseOption, executionNoise, planShot } from "../src/ai.ts"
import { createRng } from "../src/rng.ts"
import { Game } from "../src/session.ts"

it.runIf(process.env.AI_BENCH)("AI benchmark", () => {
  for (const discipline of ["9-ball", "8-ball"] as const)
  for (const name of ["easy", "medium", "hard"] as const) {
    const level = AI_LEVELS[name]
    const kinds: Record<string, number> = {}
    let shots = 0, pots = 0, potAttempts = 0, fouls = 0, safeties = 0, racks = 0, planMs = 0, maxMs = 0
    const wins = [0, 0]
    for (let seed = 1; seed <= 4; seed++) {
      const g = new Game({ discipline, seed })
      const rng = createRng(seed * 7)
      for (let i = 0; i < 150 && g.state.winner === null; i++) {
        if (g.state.pending) { g.decide(chooseOption(g, level, rng)); continue }
        const t0 = performance.now()
        const plan = planShot(g, level, rng)
        const ms = performance.now() - t0
        planMs += ms; maxMs = Math.max(maxMs, ms)
        if (plan.placement) g.placeCueBall(plan.placement)
        const rec = g.shoot(executionNoise(plan.strike, level, rng), { call: plan.call, pushOut: plan.pushOut })
        shots++
        kinds[plan.kind] = (kinds[plan.kind] ?? 0) + 1
        if (rec.ruling.fouls.length) fouls++
        if (plan.kind === "safety") safeties++
        if (plan.kind === "pot" || plan.kind === "bank" || plan.kind === "combo") {
          potAttempts++
          if (rec.facts.pocketed.some((p) => p.ball === plan.target!.ball && p.pocket === plan.target!.pocket)) pots++
        }
      }
      if (g.state.winner !== null) { racks++; wins[g.state.winner]++ }
    }
    console.log(`${discipline} ${name}: racks ${racks}/4 shots ${shots} pot ${pots}/${potAttempts} (${(100 * pots / potAttempts).toFixed(0)}%) safeties ${safeties} fouls ${fouls} plan avg ${(planMs / shots).toFixed(0)} ms max ${maxMs.toFixed(0)} ms kinds ${JSON.stringify(kinds)}`)
  }
}, 600_000)
