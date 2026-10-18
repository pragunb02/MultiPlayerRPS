# Architecture

Last updated: 2026-10-18 (docs audit: bots, sessions and tabs, abuse limits, owner console, waking-up screen)

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
  shared/src/             # catalog, event names, constants, page list for head tags (site.js, CC-047)
tests live next to code: *.test.js (unit), *.integration.test.js
```

Status: every folder above exists. `service/http/` has sessions, accounts, matches, progress, leaderboards, the owner
console (`adminRoutes.js`) and the web app router. `domain/` has identity, rooms, matches (fair play), progression,
gamification, leaderboards, bots, analytics and the player transfer. `persistence/` stores rooms, matches, accounts,
progress, stats, quests, boards, transfers and sessions in MongoDB, so nothing is lost on a restart (CC-101). The full
list of what is stored where is [DATA.md](DATA.md).

### Computer players (CC-138, CC-221, CC-225, ADR-025, ADR-040, ADR-041)

In plain words, with every level: [games/BOTS.md](games/BOTS.md). The strategies are pure functions in
`packages/games/src/bots/` (one per game, with named levels, checked by a contract kit); the server only decides when
and where they play.

```
lobby "Play Rocky" ──room:play-computer──► botComponent.playComputer ─► roomComponent (create, seat the bot)
                                                                              │ every saved change: room.changed
                                                                              ▼
                       botDriver.watch ─► botTurns.nextAction ─► pause ─► roomComponent.makeMove / requestRematch
                                                                              │ room.updated ─► gateway broadcast
```

- `domain/bots/botTurns.js`: pure decisions on a stored room. What a computer player does next, its move from its
  own seat's view with an RNG seeded from the game, and the seals of simultaneous moves (commit and reveal for Rock
  Paper Scissors, `seals.js`). The room component calls `settle` on every change it saves and `checkMove` before
  every move.
- `domain/bots/botDriver.js`: plans and carries out those actions after a human-like pause (400 to 900 ms, zero in
  tests). Plans live in the process. Rooms live in MongoDB, so `resume` at start up plans again for every stored room.
- `models/botIdentity.js`: `bot_<character>_<level>` ids for the characters in `@classicade/shared` `BOT_CHARACTERS`.
- Rewards: `domain/matches/fairPlay.js` counts each character as one opponent (rolling 24 hours) and limits XP from
  computer games to `BOT_DAILY_XP` a day. The verdict stores it in `credit.botXp`. Computer games never reach a
  leaderboard.
- Room views carry `revision`, so the web app keeps the newest view when a computer's update overtakes an answer.
- Limits: at most 3 computer games per player, and `domain/bots/thinkingQueue.js` chooses one computer move at a time
  on the whole server and then rests as long as the search took.

### Sessions and tabs (ADR-030, ADR-033)

- Sessions live in MongoDB (`player_sessions`) behind the `cc.sid` cookie: 30 days rolling for everyone, and 90 days
  absolute after signing in for accounts (ADR-030).
- `service/http/session.js` `createSessionCheck` compares the session's `sessionVersion` with the account's on every
  `/api` request and every socket handshake. Password change and "Sign out other devices" count the version up; the
  browser that asked gets a new session id (with 5 s of grace for its requests already on the way) and every other
  socket of the account is disconnected.
- In the web app, `lib/socket.js` reports a socket the server ended on purpose, and `lib/sessionBroadcast.js` posts
  `"changed"` on the BroadcastChannel `cc.session` after a sign up, log in, log out or new guest. `SessionProvider`
  then asks `GET /api/session` again and takes the server's answer (ADR-033). The message carries no identity.

### Abuse limits (ADR-035)

```
request ─► app-wide /api limit (300 a minute per session or address, CC-110) ─► session check ─► route limits
                                                                                (sign-up 10 an hour, failed logins)
socket  ─► origin and session check ─► socketAdmission (5 per session, 30 per address) ─► one event budget per player
room:create ─► roomLimits (3 waiting per player, 30 open per network, 2000 open in all)
```

Client addresses come from `X-Forwarded-For` with `TRUST_PROXY_HOPS` (DEPLOYMENT.md). Rooms store only a keyed hash
of the address (`network`). A `room gauge` log line every minute shows rooms, connections and players.

### Owner console (CC-233, ADR-036)

`/admin` and `/api/admin/analytics`, answered only for account ids in `ADMIN_ACCOUNT_IDS`; everyone else gets the
ordinary 404. `persistence/analyticsDao.js` runs read-only aggregations over what gameplay already stores,
`domain/analytics/` turns them into metrics (India days, `utils/indiaTime.js`), hides any group under 5
(`privacy.js`) and caches each range for 5 minutes. The web pages are lazy-loaded for admins only, with SVG charts,
tables and CSV export and no new dependency. There is no new tracking; telemetry is planned in
[analytics/EVENTS.md](analytics/EVENTS.md) (ADR-034).

### First load: "Waking up the arcade" (CC-232, ADR-005)

The free Render instance sleeps after 15 minutes. `apps/web/index.html` carries a static arcade-cabinet screen
inside `#root`, styled only by the built CSS (no inline style or script, so the CSP is unchanged). It stays hidden for
0.6 s so a warm visit never shows it, and React replaces it on its first render. While `/api/session` is still
outstanding the layout shows the same screen (`WakingUp`), and after 10 s it says it can take up to a minute. On a
true cold start Render's own loading page comes first; replacing that is open decision ADR-046.

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

### Data model

Every collection with its fields, who reads it and how long it is kept: [DATA.md](DATA.md). Summary:

- `users` (legacy, read-only) — username, email, bcrypt `password`; read at a legacy player's first login (CC-078), never written.
- `matches` (implemented, CC-016) — matchId, roomCode, gameId, options, seed, players[{playerId, displayName}], log[{kind, playerId?, move?, at}], result{result, winners, reason}, startedAt, endedAt, schemaVersion; replayable with `replayGame()`. Ratings fields arrive with CC-042.
- `accounts` (implemented, CC-076) — _id, username, usernameKey (unique, lower-case), email (unique), passwordHash (`scrypt$N$r$p$salt$hash`), createdAt. Identity id = `user_<_id>`. Legacy `users` are migrated lazily at first login (CC-078): read-only lookup, bcrypt check, scrypt re-hash.
- `player_progress` (implemented, CC-017) — playerId (unique), xp, matchesPlayed, wins, losses, draws, recentMatchIds (exactly-once window), updatedAt.
- `player_stats` (implemented, CC-054) — playerId (unique), winsByGame, matchesByGame, checkmateWins, questsCompleted, winStreak{current,best}, dailyStreak{current,best,lastDay}, recentKeys (exactly-once window), mergedFrom, updatedAt, version (compare-and-set).
- `player_achievements` (implemented, CC-054) — playerId + achievementId (unique), unlockedAt, matchId.
- `player_quests` (implemented, CC-089) — playerId + day (unique), items (self-contained snapshot of the day's 3 quests), sweepAt, recentKeys, expiresAt (TTL, day + 8 days), version.
- `rooms` and `closed_rooms` (implemented, CC-101, ADR-017) — one document per room with optimistic versioning and a `dueAt`
  index for deadlines; seats may carry `bot`, games `seals` (CC-225), rooms a hashed `network` (CC-107); closed rooms keep
  a small record for a day so a late visitor hears why.
- `leaderboard_entries` (implemented, CC-053, ADR-015) — board, period, playerId, score, recentKeys; accounts only.
- `player_transfers` (implemented, CC-032, ADR-014) — one record per guest that moved into an account.
- `player_sessions` (implemented, CC-013, ADR-030) — connect-mongo sessions with `sessionVersion` and `signedInAt`;
  `accounts.sessionVersion` is the current version.
- Matches also store the fair-play verdict (`credit`, ADR-021, with `botXp` for computer games, ADR-025) and progress
  keeps `unrankedXp`.
- `pending_matches` (implemented, CC-111, ADR-047) — the match pipeline's outbox: matchId (unique), match (the record to write), status (pending, done, failed), done (names of the steps done), attempts, nextAttemptAt, lastError{step, message}, createdAt, doneAt, expiresAt (TTL, done records only, 2 days).
- `ratings` — userId, game, rating, rd, volatility (planned, CC-042, ADR-027)

Replaces `RPSData`, `TicTacToeData`, `ChessData` (single `matches` collection keyed by `game`).
