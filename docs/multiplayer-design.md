# Phase 4: Multiplayer architecture (sketch)

Status: design sketch, 2026-11-19. Nothing here is built yet.

## Goals

- **Play a friend from an invite link.** No accounts, no installs.
- **Fair and consistent.** Both players see the same table after every shot, and neither client can cheat the physics or the referee.
- **Cheap to host.** It fits the existing setup in `gehsekky-infra`: the static site on S3/CloudFront, plus one small container on the shared host.
- **Replays** of whole games that can be shared.

**Not goals (yet):** accounts, friends lists, matchmaking with strangers, leaderboards, spectators and chat. These are the plan's "Later" items. The design leaves room for them.

## What makes this easy

Pool is turn-based. Only one player acts at a time, and a whole shot is decided by a tiny input:

```
{ strike: { V0, phi, theta, a, b }, call, pushOut, placement }   ≈ 100 bytes
```

Everything after that is computed: the shot, the ruling, the next state. Latency barely matters, since 100 ms before a replay starts is invisible. Bandwidth is negligible.

The hard parts are already done and portable:
- `packages/physics` and `packages/game` are pure TypeScript with no DOM, already tested under Node;
- `Game.shoot` and `Game.decide` are the only ways to change a game;
- `Game.preview` simulates without side effects.

## Authority: the server decides

**The server is authoritative.** A client sends its shot input. The server validates it, runs `Game.shoot` and broadcasts the result. The server's positions and ruling are canonical.

Why not let each client simulate the shot itself and only exchange inputs (lockstep)?

1. **Floating-point portability.** IEEE `+ − × ÷ √` are exact everywhere, but ECMAScript lets each engine approximate `Math.sin`, `cos`, `atan2`, `exp` and `pow`. The engine uses these in the cue strike, motion and solvers. V8 (Chrome, Node), SpiderMonkey (Firefox) and JavaScriptCore (Safari) can differ by an ulp. A break is chaotic, so an ulp at the first collision can become a different rack. Same input does not guarantee the same table across browsers.
2. **Cheating.** A modified client could report any outcome. With server authority, the worst a cheater can do is send a legal strike, which is just playing.
3. **One referee.** Rule disputes are impossible when one process judges.

### Client-side prediction

For responsiveness, the shooter's client simulates its own shot immediately and starts the replay, as it does today. The opponent's client does the same as soon as the strike arrives. When the server's result arrives:

- **Final positions within 1 µm of the server's** (expected whenever both run the same engine family): nothing to do.
- **Otherwise:** after the replay, the balls ease to the server's positions over about 150 ms, and the server's ruling stands. In the rare case the outcome itself differs (a ball that dropped for one didn't for the other), the client requests the server's event list and replays that instead. That's exact, at a few to tens of KB.

**Optional hardening, later:** our own deterministic `sin`, `cos`, `atan2` and `exp`, written from the classical algorithms (fdlibm's approach), would make every engine bit-identical. Prediction would then always match. It isn't required for correctness, because the server decides anyway.

## Components

```
packages/
  physics/    (exists) shared engine
  game/       (exists) rules, Game session, AI
  protocol/   (new)    message types, validators, protocol version; no runtime deps
  server/     (new)    Node service: WebSocket rooms, runs Game, Dockerfile
  web/        (exists) adds a net layer: lobby/invite UI, room client
```

Games against the computer stay entirely in the browser. The server only carries player-versus-player games, which keeps its load small.

## Rooms

```
create ──> waiting (invite link) ──> playing ──> rack over ──> playing … ──> match over
                │                       │
                └─ expires after 30 min └─ a player away > 5 min ─> forfeit (claimable)
```

- **Creating a room.** `POST /rooms` (or a `create` message) chooses the discipline, rule options (three-ball rule, race length) and the server-side rack seed. It returns the room id and the creator's **seat token**.
- **Invite link:** `https://<site>/#join=<roomId>.<joinSecret>`.
  - Both ids are 128-bit random, base64url-encoded.
  - The secret sits in the fragment, so it never reaches server logs or `Referer` headers.
  - The first person to use it takes seat 2 and gets their own seat token; the link then stops working.
- **Seat tokens** are bearer secrets kept in `localStorage`. They let a player reconnect after a reload, a network drop or a phone sleeping. A reconnect replays a full snapshot.
- **Who breaks first:** a server coin flip, since the lag isn't simulated. Later breaks alternate (WPA 1.3).
- **Rematch** and **resign** are messages. A race to N racks ends the match.
- **Timeouts:**
  - a 60 s grace period, with a presence indicator, before a disconnected player is marked away;
  - at 5 min, the opponent may claim the match;
  - an optional shot clock (WPA 3.14), off by default.

## Protocol

JSON over one WebSocket per client (`wss://`). Every message has `{ v: <protocol version>, type, … }`. Every client message is validated with hand-written validators in `packages/protocol`, so there's no schema-library dependency to license-check.

### Client → server

| type | fields | notes |
|---|---|---|
| `hello` | `roomId`, `seatToken` or `joinSecret`, `clientVersion` | first message; the server answers `welcome` or `error` |
| `place` | `point` | ball in hand; checked with `Game.placementProblem`; also relayed so the opponent sees it |
| `aim` | `phi`, `theta`, `a`, `b`, `pull` | optional live cue position; at most 10 Hz; relayed, never stored |
| `shoot` | `shotSeq`, `strike`, `call`, `pushOut`, `placement` | the only message that changes the table |
| `decide` | `shotSeq`, `option` | answers a pending WPA choice |
| `rematch`, `resign`, `ping` | | |

### Server → client

| type | fields | notes |
|---|---|---|
| `welcome` | `seat`, `seatToken`, `snapshot` | `snapshot` = rules `GameState`, ball positions, score, `shotSeq`, physics version |
| `shot` | `shotSeq`, `shooter`, `strike`, `call`, `pushOut`, `placement`, `final`, `ruling` | inputs (for local replay) plus authoritative results |
| `decided` | `shotSeq`, `option`, `ruling`, `snapshot` | |
| `events` | `shotSeq`, `events` | on request, when prediction diverged |
| `opponentAim`, `presence`, `matchOver`, `error`, `pong` | | |

### What the server checks on `shoot`

- **Turn and order:** it's this seat's turn, no decision is pending, and the rack isn't over.
- **No replays or double-sends:** `shotSeq` equals the room's next number; duplicates are rejected.
- **Strike bounds:**
  - `0 < V0 ≤ 10` m/s;
  - `0 ≤ theta ≤ 30`°;
  - `a² + b² ≤ 0.6²` (past that, a real cue miscues);
  - `phi` finite.
- **Placement:** legal under the current ball in hand (kitchen or table).
- **Call:** a well-formed call (8-ball) and push-out flag; the rules engine judges the rest.

The server then runs `Game.shoot` and broadcasts `shot` to both seats. A break simulates in about 2 ms and a typical shot in about 0.1 ms, so there's no queue to speak of.

## Versioning

- **Protocol version:** a mismatch makes the client reload, so it picks up the new static bundle.
- **Physics version:** a hash of the physics package, recorded in each room and each replay. A room is pinned to the version it started on.
- **Deploys** drain the server: new rooms go to the new process, existing rooms finish or are snapshotted. In-memory rooms make "finish or expire" the simple first answer.

## Server

- **Node 26, one process.** The physics and game packages run unchanged.
- **WebSocket library:** `ws` (MIT), the de facto standard. Node 26 ships a WebSocket client but no server. To be license-checked like everything else.
- **State:** rooms live in memory. A room is a `Game` plus seats and timers, a few tens of KB. A t4g.small could hold thousands of idle rooms; CPU is spent only while a shot simulates.
- **Persistence:** none at first; restarting loses active rooms. If that hurts, snapshot rooms (initial positions, the shot input list, seat tokens) to SQLite or Redis. A game is fully reconstructable from its inputs plus the per-shot final positions.
- **Abuse limits:**
  - per IP: rooms created per minute, and concurrent sockets;
  - per socket: messages per second, with frames capped at 4 KB;
  - an `Origin` check;
  - idle sockets dropped after a 25 s ping and 75 s timeout.
- **Privacy:** no accounts and no personal data. Logs hold room ids and errors, not invite secrets, which stay in the fragment. IPs live only in the rate limiter's memory.

## Hosting (gehsekky-infra)

| Piece | Module | Notes |
|---|---|---|
| Static client | `modules/static_site` | S3 + CloudFront. `pnpm --filter @pixelpoolhall/web build`, then sync `dist/`. Needs a domain (open question). |
| Game server | `modules/server_app` (name `pixelpoolhall`) | ECR repository `pixelpoolhall-server`, log group `/pixelpoolhall/server`, deploy role over SSM, container on the shared host. |
| WebSocket routing | edge site file **in this repo**, per the infra README | Path `/ws` on a subdomain such as `play.<domain>` pointing at the host. The edge config must forward the upgrade: `proxy_http_version 1.1`, `Upgrade` and `Connection` headers, `proxy_read_timeout` ≥ 75 s. The base edge config currently has none of this. |

Order, per the infra README: apply the infra resources (domain, static site, server app) first, then merge the app code that uses them. CI in this repo would run tests, build the client, sync it to S3, build and push the server image, and deploy over SSM.

## Replays

A replay file contains:
- the physics and protocol versions;
- the discipline, the rules and the initial ball positions;
- one entry per shot: input, final positions and ruling.

The final positions make it portable. A player on any engine re-simulates each shot for the animation, then snaps to the recorded result, so the replay can never drift. Files are a few KB per rack. Clients can export them (download, or a compressed URL fragment) with no server storage; server-side sharing can come later.

## Testing

- **protocol:** validator unit tests, including fuzzing with malformed and out-of-range messages.
- **server:** room lifecycle tests with in-process fake sockets:
  - turn enforcement and `shotSeq` replay rejection;
  - reconnect, forfeit and the timers (with a fake clock).
- **End to end:** two headless browsers playing a rack through a local server.
- **Cross-engine determinism report:** run the 279 fixture shots plus a few hundred breaks in Chromium, Firefox and WebKit, and diff the final positions against Node. This measures how often prediction diverges and whether the deterministic-math hardening is worth doing.

## Milestones

1. `packages/protocol`: types, validators, version.
2. `packages/server`: rooms, `shoot`/`decide`, reconnect, timers. Tested in-process.
3. Web net layer: create/join UI, invite link, prediction plus reconciliation, presence, live opponent cue.
4. Infra: domain, static site, server app, edge site file with WebSocket upgrade; CI deploy.
5. Replays: export and import.
6. The cross-engine determinism report; decide on deterministic math.

## Open questions

- **Domain name.** Needed for the static site and the `play.` subdomain.
- **Chat.** Free-text chat brings moderation and abuse work. I'd suggest preset quick messages ("Nice shot", "Good game") only.
- **Spectators** via a read-only link. Cheap to add later, since the server already broadcasts.
- **Race length** and match format defaults (race to 5?).
