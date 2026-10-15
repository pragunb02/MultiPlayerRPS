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

Status: `index.js`, `server.js`, `config/`, `service/http/`, `service/realtime/`, `domain/identity/`, `persistence/` (database, session store), `models/identity`, `utils/` exist (CC-011…CC-013); other folders arrive with their tickets.

### Game engine contract (draft, JSDoc)

```js
/**
 * @template State, Move, View
 * @typedef {Object} GameEngine
 * @property {string} id                         "rps" | "tictactoe" | "chess"
 * @property {number} minPlayers
 * @property {number} maxPlayers
 * @property {(players: string[], options: object) => State} init
 * @property {(state: State, playerId: string, move: unknown) => {ok: true, move: Move} | {ok: false, error: string}} validateMove
 * @property {(state: State, playerId: string, move: Move) => State} applyMove
 * @property {(state: State) => GameResult | null} getResult      null = ongoing
 * @property {(state: State, playerId: string | "spectator") => View} viewFor   hides secret info (e.g. RPS choice)
 * @property {(state: State) => string[]} currentPlayers            who may act now
 */
```

Rules: engines are pure (no I/O, no timers, no randomness except via injected RNG) → trivially unit-testable.
RoomManager owns timers, persistence, broadcasting. Bots call the same `validateMove/applyMove` path as humans.

### Data model (target, draft)

- `users` — id, username, email, passwordHash, avatar, xp, level, createdAt, flags (guest, banned, admin)
- `matches` — id, game, options, players[{userId, seat, ratingBefore/After}], moves[], result, startedAt, endedAt, rated
- `ratings` — userId, game, rating, rd, volatility
- `sessions` — managed by session store

Replaces `RPSData`, `TicTacToeData`, `ChessData` (single `matches` collection keyed by `game`).
