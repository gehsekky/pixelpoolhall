# PixelPoolHall

[![CI](https://github.com/gehsekky/pixelpoolhall/actions/workflows/ci.yml/badge.svg)](https://github.com/gehsekky/pixelpoolhall/actions/workflows/ci.yml)

The goal: the most accurate web billiards simulator on the internet. Free,
self-hosted, MIT licensed.

- Plan: [docs/billiards-game-plan.md](docs/billiards-game-plan.md)
- Physics design: [docs/physics-design.md](docs/physics-design.md)
- Rules implementation: [docs/rules.md](docs/rules.md)
- Computer opponent: [docs/ai.md](docs/ai.md)
- Multiplayer architecture (Phase 4 sketch): [docs/multiplayer-design.md](docs/multiplayer-design.md)
- Prior-art analyses: [tailuge](docs/tailuge-analysis.md), [pooltool](docs/pooltool-analysis.md)

## Layout

| Path | What |
|---|---|
| `packages/physics` | Event-based physics engine. Pure TypeScript, no runtime dependencies. |
| `packages/game` | Game logic: WPA 8-ball and 9-ball rules, racks, spotting, match flow. |
| `packages/web` | Game client: 3D table and floating cue (Three.js), plus the 2D physics debug view at `/debug.html`. |
| `tools/reference` | Python reference harness: NumPy and pooltool comparisons. |
| `docs/` | Plan, design and research notes. |

Infrastructure (hosting, CI deploy roles) lives in the sibling `gehsekky-infra` repo.

## Development

Requires Node 26 (`nvm use`) and pnpm.

```sh
pnpm install
pnpm test        # all packages
pnpm typecheck
pnpm lint
pnpm --filter @pixelpoolhall/web dev   # game at /, physics debug view at /debug.html
```

## License

MIT, see [LICENSE](LICENSE). Third-party code and cited works are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
