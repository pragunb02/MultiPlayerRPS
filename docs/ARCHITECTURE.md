# Architecture

Last updated: 2026-10-16

## 1. Current (legacy)

```
Browser (EJS pages + jQuery + per-game scripts)
   │  HTTP (Express)            │  Socket.IO (no auth)
   ▼                            ▼
index.js — routes + ALL socket handlers + game rules + DB writes + leveling
   │ in-memory rooms: rpsRooms / ticTacToeRooms / chessRooms
   ▼
MongoDB (users, sessions, RPSData, TicTacToeData, ChessData)
```

Key problems: client-authoritative games (TTT, chess), identity from free-text names, monolithic handler file,
server code under `client/`, triplicated models and UI code, no tests. Full list: [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## 2. Target

```
web/  (SPA, mobile-first)  ──HTTP──►  API (REST)        ─┐
                           ──WS────►  Realtime gateway   ├─► Services ─► Repositories ─► DB
                                          │              │
                                          ▼              │
                                     RoomManager ────────┘
                                          │
                                     Game engines (pure)  ◄── Bots (server-side players)
```

### Layout (ADR-001 JavaScript/ESM, ADR-002 React, ADR-006 monorepo, ADR-007 layers)

Layer rules, patterns and extension points: [ENGINEERING.md](ENGINEERING.md).

```
apps/
  server/src/
    index.js              # process entry: load env → config → startServer
    server.js             # composition root: builds layers bottom-up, starts HTTP/socket servers
    config/               # env schema, validated at boot (injected, never imported by layers)
    service/              # 1. service layer
      http/               #    express app, routes, controllers, validators, transformers, error middleware
      realtime/           #    socket gateway + socket handlers
    domain/               # 2. domain logic: *Component (rooms, matches, progression, bots)
    data/                 # 3. domain data: *Accessor — returns domain models
    persistence/          # 4a. *Dao — MongoDB CRUD for data we own
    dependency/           # 4b. *Client — external services
    models/               # immutable domain models & value objects
    utils/                # logger, typed errors, assertions, ids
  web/src/                # React + Vite (CC-022)
packages/
  games/src/              # pure engines + registry (CC-014)
  shared/src/             # catalog, event names, constants
tests live next to code: *.test.js (unit), *.integration.test.js
```

Status: composition root, config, `service/http/` (sessions, matches), `service/realtime/` (gateway, rooms), `domain/` (identity, rooms, matches), `data/` (room + match accessors), `persistence/` (database, session store, in-memory room DAO, MongoDB match DAO), `models/`, `utils/` exist (CC-011…CC-020, CC-016).

### Game engine contract (implemented — `packages/games/src/engine.js`, CC-014)

```js
/**
 * @typedef {{ status: "ongoing" } | { status: "finished", result: "win" | "draw", winners: PlayerId[], reason: string }} Outcome
 * @typedef {{ ok: true, value: T } | { ok: false, reason: MOVE_REJECTIONS, message: string }} Result
 *
 * @typedef {Object} GameEngine
 * @property {string} id                                   matches a GAME_IDS value
 * @property {{ min: number, max: number }} players
 * @property {(raw) => Result<Options>} validateOptions
 * @property {({ players, options, rng }) => State} init     randomness only via the injected seeded rng
 * @property {(state, playerId, raw, { now }) => Result<Move>} validateMove   never throws
 * @property {(state, playerId, move, { now }) => State} applyMove           returns new state, never mutates
 * @property {(state) => Outcome} getOutcome                                  never null
 * @property {(state, viewer | "spectator") => View} viewFor                 hides secret info (e.g. RPS choice)
 * @property {(state) => PlayerId[]} activePlayers                           who may act now (empty when finished)
 * @property {(state) => number} [deadline]       optional: when a time-based event happens if nobody acts (0 = none)
 * @property {(state, { now }) => State} [expire]  optional, with deadline: applies it (e.g. chess flag falls)
 */
```

Engines are registered with `defineEngine()` (shape check) in `createEngineRegistry()`. Every engine's test file calls
`describeEngineContract(engine, scenario, { describe, it })` from `@classicade/games/testing`, which runs 10 checks:
options, determinism from a seed, JSON-safe state/views, robustness against garbage input, outsiders, scenario
rejections, full playthrough without mutation, game-over refusal, and identical replay.

### Data model (target, draft)

- `users` — id, username, email, passwordHash, avatar, xp, level, createdAt, flags (guest, banned, admin)
- `matches` (implemented, CC-016) — matchId, roomCode, gameId, options, seed, players[{playerId, displayName}], log[{kind, playerId?, move?, at}], result{result, winners, reason}, startedAt, endedAt, schemaVersion; replayable with `replayGame()`. Ratings fields arrive with CC-042.
- `player_progress` (implemented, CC-017) — playerId (unique), xp, matchesPlayed, wins, losses, draws, recentMatchIds (exactly-once window), updatedAt.
- `ratings` — userId, game, rating, rd, volatility
- `sessions` — managed by session store

Replaces `RPSData`, `TicTacToeData`, `ChessData` (single `matches` collection keyed by `game`).
