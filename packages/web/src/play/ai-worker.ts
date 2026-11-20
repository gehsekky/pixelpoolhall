/**
 * Runs the computer opponent's search off the main thread, so rendering
 * and input stay smooth while it thinks (planning takes up to a few hundred
 * milliseconds).
 */
import { AI_LEVELS, chooseOption, createRng, Game, planShot, type AiPlan, type GameSnapshot, type Option } from "@pixelpoolhall/game"

export type AiRequest = {
  id: number
  kind: "plan" | "decide"
  snapshot: GameSnapshot
  level: keyof typeof AI_LEVELS
  seed: number
}

export type AiResponse = { id: number; plan?: AiPlan; option?: Option; error?: string }

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, kind, snapshot, level, seed } = e.data
  try {
    const game = Game.fromSnapshot(snapshot)
    const rng = createRng(seed)
    const res: AiResponse =
      kind === "plan" ? { id, plan: planShot(game, AI_LEVELS[level], rng) } : { id, option: chooseOption(game, AI_LEVELS[level], rng) }
    self.postMessage(res)
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies AiResponse)
  }
}
