# Architecture

Last updated: 2026-10-16

## 1. Legacy (deleted in CC-029)

Until 2026-10-16 production ran an Express 4 monolith (`index.js`: routes, every socket handler, game rules, DB writes)
with EJS pages and client-authoritative games. Its findings and their fixes: [KNOWN_ISSUES.md](KNOWN_ISSUES.md). Its
`users` collection is still read so legacy players can log in (CC-078).

## 2. Architecture

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
  web/src/                # React + Vite (CC-022, ADR-009): app/ (App, providers), lib/ (api, socket), hooks/, components/, pages/, styles/
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

- `users` (legacy, read-only) — username, email, bcrypt `password`; read at a legacy player's first login (CC-078), never written.
- `matches` (implemented, CC-016) — matchId, roomCode, gameId, options, seed, players[{playerId, displayName}], log[{kind, playerId?, move?, at}], result{result, winners, reason}, startedAt, endedAt, schemaVersion; replayable with `replayGame()`. Ratings fields arrive with CC-042.
- `accounts` (implemented, CC-076) — _id, username, usernameKey (unique, lower-case), email (unique), passwordHash (`scrypt$N$r$p$salt$hash`), createdAt. Identity id = `user_<_id>`. Legacy `users` are migrated lazily at first login (CC-078): read-only lookup, bcrypt check, scrypt re-hash.
- `player_progress` (implemented, CC-017) — playerId (unique), xp, matchesPlayed, wins, losses, draws, recentMatchIds (exactly-once window), updatedAt.
- `player_stats` (implemented, CC-054) — playerId (unique), winsByGame, matchesByGame, checkmateWins, questsCompleted, winStreak{current,best}, dailyStreak{current,best,lastDay}, recentKeys (exactly-once window), mergedFrom, updatedAt, version (compare-and-set).
- `player_achievements` (implemented, CC-054) — playerId + achievementId (unique), unlockedAt, matchId.
- `player_quests` (implemented, CC-089) — playerId + day (unique), items (self-contained snapshot of the day's 3 quests), sweepAt, recentKeys, expiresAt (TTL, day + 8 days), version.
- `ratings` — userId, game, rating, rd, volatility
- `sessions` — managed by session store

Replaces `RPSData`, `TicTacToeData`, `ChessData` (single `matches` collection keyed by `game`).
