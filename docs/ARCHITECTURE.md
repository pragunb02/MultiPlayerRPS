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

### Layout (ADR-001 JavaScript/ESM, ADR-002 React, ADR-006 monorepo)

Status: `apps/server` skeleton and `packages/shared` exist (CC-011); the rest is added by its ticket.

```
apps/
  server/src/
    index.js            # bootstrap: config → db → http + socket → listen
    app.js              # express app factory (no listen) — used by tests
    config/             # env schema, validated at boot
    http/
      routes/           # auth, users, matches
      middleware/       # auth, rate-limit, error handler
    realtime/
      gateway.js        # socket auth (session), event routing
    rooms/
      RoomManager.js    # create/join/leave, lifecycle, timeouts, reconnect, server clocks
    bots/               # Bot implementations (server-side players)
    domain/
      users/ matches/ ratings/ progression/   # service + repository per module
    lib/                # logger, errors, ids
  web/src/              # React + Vite
    app/ pages/ components/ games/<game>/ hooks/ lib/socket.js
packages/
  games/src/            # pure engines: rps/ tictactoe/ chess/ (ludo/) + engine.js typedefs
  shared/src/           # socket event names, constants, validators
tests live next to code: *.test.js (Vitest)
docs/
```

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
