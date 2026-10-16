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
   dependencies or env vars change, rehearse Render's build and start from a fresh clone before merging (DEPLOYMENT.md).
8. Don't start a stage until the previous stage's exit criteria in `BACKLOG.md` are met (unless explicitly agreed).

## History

The original app (Express 4 monolith, EJS, client-authoritative games) ran production until 2026-10-16 and was deleted
in CC-029. Its audit findings and how each was fixed are in `docs/KNOWN_ISSUES.md`; the code is in git history before
the CC-029 merge. Its MongoDB `users` collection is still read (never written) so legacy players can log in (CC-078).

## Structure (ADR-001/002/004/006)

npm-workspaces monorepo, JavaScript ES modules with JSDoc types, React + Vite frontend:
`apps/server`, `apps/web`, `packages/games` (pure engines), `packages/shared` (event names, constants).
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Built so far: `apps/web` — React app (session, home, lobby `/play/:gameId`, room `/room/:code`, `/login`, `/signup`, `/profile`, client game registry `src/games/registry.js` with lazy-loaded boards for RPS / Tic-Tac-Toe / Chess, share/seats/modal/toasts; ADR-009); `apps/server` — composition root, config, MongoDB + session store, identity model/component, HTTP app (request logging, error translation, `/api/session`), Socket.IO gateway (session-authenticated, origin-checked, rate-limited, standard acks, room handlers), room manager (domain state machine + accessor + in-memory DAO), match history (MongoDB, replayable via `replayGame`), progression (XP/levels, exactly-once, pushed via `progress:updated`), accounts (scrypt, `/api/auth/signup|login`), background tasks for post-game work, typed errors, pino logger; `packages/shared` — game catalog, error codes, socket events, identity kinds, move rejections; `packages/games` — engine contract, registry, seeded RNG, contract test kit (`@classicade/games/testing`), engines: RPS, Tic-Tac-Toe, Chess (server clocks via the optional `deadline`/`expire` time hooks). Integration tests use an in-memory MongoDB (`testing/memoryMongo.js`).
New code: ES modules, JSDoc types, Express 5, pure functions where possible, a `*.test.js` beside every module,
dependencies passed in (e.g. `createApp({ config })`) rather than imported globals.

## Commands

```bash
nvm use && npm install
cp apps/server/.env.example apps/server/.env   # MONGO_URI (non-production DB!), SESSION_SECRET
npm run dev:server     # server (apps/server) on :4000
npm run dev:web        # web app (apps/web) on :5173, proxies /api and /socket.io to :4000
npm run build:web      # production build → apps/web/dist
npm start              # production: the server, serving apps/web/dist (WEB_DIST_DIR)
npm run lint           # must have 0 errors
npm run format:check
npm test               # Vitest across all workspaces (*.test.js next to the code)
npm run test:coverage  # with coverage gates (ENGINEERING.md §4)
npm run test:e2e       # browser persona tests (first time: npx playwright install chromium)
npm audit              # must be 0 high/critical
./scripts/issue-counts.sh  # issue counts for PROGRESS.md (never hand-edit them)
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
