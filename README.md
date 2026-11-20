# PixelPoolHall

The goal: the most accurate web billiards simulator on the internet. Free,
self-hosted, MIT licensed.

- Plan: [docs/billiards-game-plan.md](docs/billiards-game-plan.md)
- Physics design: [docs/physics-design.md](docs/physics-design.md)
- Rules implementation: [docs/rules.md](docs/rules.md)
- Prior-art analyses: [tailuge](docs/tailuge-analysis.md), [pooltool](docs/pooltool-analysis.md)

## Layout

| Path | What |
|---|---|
| `packages/physics` | Event-based physics engine. Pure TypeScript, no runtime dependencies. |
| `packages/game` | Game logic: WPA 8-ball and 9-ball rules, racks, spotting, match flow. |
| `packages/web` | 2D physics debug view (Vite). Later the game client. |
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
pnpm --filter @pixelpoolhall/web dev   # physics debug view
```

## License

MIT, see [LICENSE](LICENSE). Third-party code and cited works are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
