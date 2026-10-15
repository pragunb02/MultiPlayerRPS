# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## Project

**ClassiCade** — a real-time, social, skill-based platform for classic multiplayer games
(Rock Paper Scissors, Tic-Tac-Toe, Chess today; Ludo and more planned). Treated as a company/product,
not a college project. Vision and business goals: [docs/BRD.md](docs/BRD.md).

## Where things are tracked

| File                                         | Purpose                                                                | Update when                     |
| -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| [docs/BRD.md](docs/BRD.md)                   | Business requirements: vision, users, business model, KPIs             | Business direction changes      |
| [docs/PRD.md](docs/PRD.md)                   | Product requirements per stage, with requirement IDs (`FR-*`, `NFR-*`) | Scope of a feature changes      |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current vs. target architecture                                        | Structure changes               |
| [docs/BACKLOG.md](docs/BACKLOG.md)           | **Ticket board** — every task as `CC-###` with type, priority, status  | Tickets added/started/completed |
| [docs/tickets/](docs/tickets/)               | One file per non-trivial ticket (`CC-###.md`) from `TEMPLATE.md`       | Ticket started / progressed     |
| [docs/PROGRESS.md](docs/PROGRESS.md)         | Current phase, in-flight work, dated changelog                         | **Every working session**       |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | Architecture/product decision records (ADRs)                           | A decision is made or reversed  |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | Audit findings (`BUG-*`, `SEC-*`, `DEBT-*`)                            | Issue found or fixed            |

### ID scheme

- `CC-###` — **tickets** (units of work). Sequential, permanent, never reused. Next free ID is at the top of `BACKLOG.md`.
- `FR-*` / `NFR-*` — requirements (PRD). `SEC-*` / `BUG-*` / `DEBT-*` — audit findings. `ADR-*` — decisions.
- Tickets link to requirements/findings/ADRs; every finding is linked from at least one ticket.

### Workflow rules

1. Before starting work, read `docs/PROGRESS.md` and the ticket on `docs/BACKLOG.md`.
2. **No untracked work**: anything new (including bugs found along the way) gets a ticket with the next free ID first.
3. Starting a ticket: set 🟦 on the board; for anything over ~1 hour create `docs/tickets/CC-###.md` from the template.
4. Branch `cc-###-short-name`. Every commit message starts with the ticket ID: `CC-007: fix RPS Scissors mismatch (BUG-01)`.
   Multi-ticket commits list all IDs: `CC-003, CC-004: …`.
5. Finishing: ✅ on the board, update linked findings in `KNOWN_ISSUES.md`, add a dated changelog line in `PROGRESS.md`
   using ticket IDs, update the stage counters.
6. Non-trivial decisions (library, pattern, data model) get an ADR in `DECISIONS.md` first.
7. Don't start a stage until the previous stage's exit criteria in `BACKLOG.md` are met (unless explicitly agreed).

## Current state (legacy code — being replaced)

- Stack: Node.js, Express 4, Socket.IO 4, MongoDB/Mongoose 6, Passport (local), EJS, jQuery, chess.js 0.10, chessboard.js.
- `index.js` — monolith: HTTP routes, all socket handlers for all games, game rules, DB writes, leveling.
- `config.js` — env loading + validation (fails fast on missing `MONGO_URI` / `SESSION_SECRET`).
- `db.js` — Mongo connection + session store.
- `models/` — `User`, `RPSData`, `TicTacToeData`, `ChessData`.
- `client/` — **mixes server and client code**: EJS views, static assets, browser JS, _and_ server routes in `client/routes/`.
  - `index.ejs` home, `index2.ejs` RPS, `index3.ejs` TTT, `index4.ejs` chess lobby, `game.ejs` chess board, `profile.ejs`.
  - `client.js` RPS, `script.js` TTT, `chessJs.js` chess lobby, `public/js/index.js` chess board, `signup.js` auth, `scriptindex.js` home.
- Legacy files are excluded from Prettier and their browser scripts lint with warnings only — don't reformat them; they are deleted in CC-029.

See `docs/KNOWN_ISSUES.md` before touching any legacy file — many behaviours are known bugs, not intent.

## Target structure (being built — ADR-001/002/004/006)

npm-workspaces monorepo, JavaScript ES modules with JSDoc types, React + Vite frontend:
`apps/server`, `apps/web`, `packages/games` (pure engines), `packages/shared` (event names, constants).
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Built so far: `apps/server` (app factory, config, health/games routes) and `packages/shared` (game catalog).
New code: ES modules, JSDoc types, Express 5, pure functions where possible, a `*.test.js` beside every module,
dependencies passed in (e.g. `createApp({ config })`) rather than imported globals.

## Commands

```bash
nvm use && npm install
cp .env.example .env   # MONGO_URI (non-production DB!), SESSION_SECRET
npm run dev            # legacy app (nodemon index.js) on :8080
npm run dev:server     # new server (apps/server) on :4000 — own env file apps/server/.env
npm run lint           # must have 0 errors
npm run format:check
npm test               # Vitest across all workspaces (*.test.js next to the code)
```

No local MongoDB? A throwaway `mongodb-memory-server` instance in a temp dir works for smoke tests.

## Engineering principles (target)

- **Server-authoritative games.** Clients send intents; the server validates, applies, decides results. Never trust the client for moves, winners, or identity.
- **Identity comes from the session**, never from a name typed in a form.
- **Games are pure modules** behind a common engine interface (`init / validateMove / applyMove / getResult / viewFor`), unit tested, no I/O.
- **One room/match system** shared by all games; bots are just players driven by the server.
- Escape all user-controlled output; no `<%-` with user data.
- No dead code, no commented-out blocks, no debug `console.log` — use a logger.
- Inclusive language (allowlist/denylist, primary/replica).
