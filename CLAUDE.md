# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## Project

**ClassiCade** — a real-time, social, skill-based platform for classic multiplayer games
(Rock Paper Scissors, Tic-Tac-Toe, Chess today; Ludo and more planned). Treated as a company/product,
not a college project. Vision and business goals: [docs/BRD.md](docs/BRD.md).

## Where things are tracked

| File                                         | Purpose                                                                                          | Update when                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| [docs/BRD.md](docs/BRD.md)                   | Business requirements: vision, users, business model, KPIs                                       | Business direction changes      |
| [docs/PRD.md](docs/PRD.md)                   | Product requirements per stage, with requirement IDs (`FR-*`, `NFR-*`)                           | Scope of a feature changes      |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current vs. target architecture                                                                  | Structure changes               |
| [docs/BACKLOG.md](docs/BACKLOG.md)           | **Ticket board** — every task as `CC-###` with type, priority, status                            | Tickets added/started/completed |
| [docs/tickets/](docs/tickets/)               | One file per non-trivial ticket (`CC-###.md`) from `TEMPLATE.md`                                 | Ticket started / progressed     |
| [docs/PROGRESS.md](docs/PROGRESS.md)         | Current phase, in-flight work, dated changelog                                                   | **Every working session**       |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | Architecture/product decision records (ADRs)                                                     | A decision is made or reversed  |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)     | **Production**: Render settings, env vars, pre/post-merge checks, rollback, incidents            | Deploy setup changes            |
| [docs/ENGINEERING.md](docs/ENGINEERING.md)   | **How to write code**: layers, principles, patterns, coding/testing standards, dependency policy | Standards change                |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | Audit findings (`BUG-*`, `SEC-*`, `DEBT-*`)                                                      | Issue found or fixed            |

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
7. **Merging to `main` deploys to production** (Render). Fill in the PR template's _Deployment impact_; if start/build,
   dependencies or env vars change, verify `NODE_ENV=production npm ci && npm start` from a fresh clone before merging.
8. Don't start a stage until the previous stage's exit criteria in `BACKLOG.md` are met (unless explicitly agreed).

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

Built so far: `apps/server` — composition root, config, MongoDB + session store, identity model/component, HTTP app (request logging, error translation, `/api/session`), Socket.IO gateway (session-authenticated, origin-checked, standard acks), typed errors, pino logger; `packages/shared` — game catalog, error codes, socket events, identity kinds. Integration tests use an in-memory MongoDB (`testing/memoryMongo.js`).
New code: ES modules, JSDoc types, Express 5, pure functions where possible, a `*.test.js` beside every module,
dependencies passed in (e.g. `createApp({ config })`) rather than imported globals.

## Commands

```bash
nvm use && npm install
cp .env.example .env   # MONGO_URI (non-production DB!), SESSION_SECRET
npm run dev            # legacy app (node --watch index.js) on :8080
npm run dev:server     # new server (apps/server) on :4000 — own env file apps/server/.env
npm run lint           # must have 0 errors
npm run format:check
npm test               # Vitest across all workspaces (*.test.js next to the code)
npm run test:coverage  # with coverage gates (ENGINEERING.md §4)
npm audit              # must be 0 high/critical
```

No local MongoDB? A throwaway `mongodb-memory-server` instance in a temp dir works for smoke tests.

## Engineering principles

**Read [docs/ENGINEERING.md](docs/ENGINEERING.md) before writing code.** It is binding for `apps/` and `packages/`. Key points:

- **Five layers** in the server (service → domain → data → persistence | dependency), adjacent and top-down only — `npm run lint` fails on violations.
- **Server-authoritative games.** Clients send intents; the server validates, applies, decides results. Identity comes from the session.
- **Pure core**: game engines and rule maths are pure functions; time, randomness and I/O are injected.
- **Composition root** (`apps/server/src/server.js`) wires everything; factories receive dependencies; no globals.
- **Extensible by addition**: new games/bots/storage plug in via registries and contracts (open/closed).
- **Typed errors**, no `null` results, value objects for ids, named parameters, no silent fallbacks, immutable data.
- **Tests**: behaviour-focused unit tests beside code, fakes over mocks, deterministic; coverage gates via `npm run test:coverage`.
- **Dependencies**: latest stable only, minimal, `npm audit` 0 high/critical.
- Inclusive language (allowlist/denylist, primary/replica).
