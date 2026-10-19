# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## Project

**ClassiCade** — a real-time, social, skill-based platform for classic multiplayer games
(Rock Paper Scissors, Tic-Tac-Toe, Chess today; Ludo and more planned). Treated as a company/product,
not a college project. Vision and business goals: [docs/BRD.md](docs/BRD.md).

## Where things are tracked

| File                                             | Purpose                                                                                          | Update when                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| [docs/BRD.md](docs/BRD.md)                       | Business requirements: vision, users, business model, KPIs                                       | Business direction changes      |
| [docs/PRD.md](docs/PRD.md)                       | Product requirements per stage, with requirement IDs (`FR-*`, `NFR-*`)                           | Scope of a feature changes      |
| [docs/PRODUCT_VISION.md](docs/PRODUCT_VISION.md) | Accepted product vision: personas, loops, phases and order of work, metrics (North Star WRP)     | Direction changes               |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | Current vs. target architecture                                                                  | Structure changes               |
| [docs/BACKLOG.md](docs/BACKLOG.md)               | **Ticket board** — every task as `CC-###` with type, priority, status                            | Tickets added/started/completed |
| [docs/tickets/](docs/tickets/)                   | One file per ticket (`CC-###.md`) from `TEMPLATE.md`, small ones included                        | Ticket started / progressed     |
| [docs/PROGRESS.md](docs/PROGRESS.md)             | Current phase, in-flight work, dated changelog                                                   | **Every working session**       |
| [docs/DECISIONS.md](docs/DECISIONS.md)           | Architecture/product decision records (ADRs)                                                     | A decision is made or reversed  |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)         | **Production**: Render settings, env vars, pre/post-merge checks, rollback, incidents            | Deploy setup changes            |
| [docs/ENGINEERING.md](docs/ENGINEERING.md)       | **How to write code**: layers, principles, patterns, coding/testing standards, dependency policy | Standards change                |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)     | Audit findings (`BUG-*`, `SEC-*`, `DEBT-*`)                                                      | Issue found or fixed            |

### ID scheme

- `CC-###` — **tickets** (units of work). Sequential, permanent, never reused. Next free ID is at the top of `BACKLOG.md`.
- `FR-*` / `NFR-*` — requirements (PRD). `SEC-*` / `BUG-*` / `DEBT-*` — audit findings. `ADR-*` — decisions.
- Tickets link to requirements/findings/ADRs; every finding is linked from at least one ticket.

### Working agreement (owner, 17 October 2026)

These rules come first. Where they differ from anything below, they win.

1. **Feature freeze.** No new feature or idea tickets until every ticket already on the board is closed, across all
   phases, in the order set by `docs/PRODUCT_VISION.md`. New ideas are written down in `docs/IDEAS.md` only, not as
   tickets, and are not started.
2. **Allowed new tickets:** security (always), testing (unit, integration, browser), and bugs in things that already
   exist. These are fixes, not new ideas.
3. **Security is P0 by default.** It drops to P1 only when a higher priority P0 is already in progress. A security
   issue is never cut or deferred without the owner.
4. **Research before code.** Every ticket starts with a Research section in its ticket file before any code: how our
   code does it today, how other products do it (with sources), and what is best for ClassiCade. Coding starts after
   that section is written. A small fix under an hour (one-line hotfix, test fix) still gets a ticket file with Root
   cause and a short Research note, written before the PR is merged.
5. **Document everything.** Decisions go in `docs/DECISIONS.md`, research in the ticket or `docs/investigations/`,
   changes in `docs/PROGRESS.md`. Nothing decided only in chat.
6. **Steady, not frantic.** At most six builders run at once, and only on independent work (no shared files).
   Builders run lint, format, coverage and only their own browser tests locally; CI runs the full browser suite.
   `main` stays green: a red `main` is fixed before anything else merges. **Fast mode ended 2026-10-18 (owner):** every check is required again, branches must be up to date, and builders run their own gates in full.
7. **Launch is by word of mouth among friends**, when the owner decides. Sharing (the growth plan, `docs/GROWTH.md`,
   added by PR #60) and the owner's admin console are in scope.
8. **Reviews before every merge.** Every pull request is reviewed before merge by reviewer agents in parallel: a
   code reviewer (correctness, tests, the working agreement and comment style, regressions), a security reviewer
   (auth, sessions, sockets, input, data exposure, secrets) and, for any change players can see, a design reviewer
   (phone and desktop layouts, plain words, accessibility, the look and feel domain). Each finding is checked by a second
   agent that tries to refute it. Confirmed findings are fixed, or written down with a reason, before the merge.

### Workflow rules

1. Before starting work, read `docs/PROGRESS.md` and the ticket on `docs/BACKLOG.md`.
2. **No untracked work**: anything new (including bugs found along the way) gets a ticket with the next free ID first.
3. Starting a ticket: set 🟦 on the board and create `docs/tickets/CC-###.md` from the template. Every ticket gets a
   file; a small one (under about an hour) gets Root cause and a short Research note (working agreement rule 4).
4. Branch `cc-###-short-name`. Every commit message starts with the ticket ID: `CC-007: fix RPS Scissors mismatch (BUG-01)`.
   Multi-ticket commits list all IDs: `CC-003, CC-004: …`.
   Every PR fills the template's **Evidence** section: screenshots for UI changes (desktop and phone, before and
   after), request and response for API or socket changes, and the tests added (owner, 2026-10-19; ADR-039).
   Screenshots go on the `pr-evidence` branch, never on `main`, and show test accounts only.
5. Finishing: ✅ on the board, update linked findings in `KNOWN_ISSUES.md`, add a dated changelog line in `PROGRESS.md`
   using ticket IDs, update the stage counters.
6. Non-trivial decisions (library, pattern, data model) get an ADR in `DECISIONS.md` first.
7. **Every required check must be green before merging**, on a branch that is up to date with `main`. Branch
   protection requires eight: lint, format, audit, unit + integration (coverage gates); the Docker build; the browser
   suites on Chromium (desktop + mobile) and Firefox; the backup round trip; actionlint (all in
   `.github/workflows/ci.yml`); and CodeQL for JavaScript and for Actions (GitHub's CodeQL setup, not ci.yml). WebKit
   runs nightly, on demand and on PRs that change `apps/web`, `packages/shared` or `e2e`; it is advisory until its
   open flakes (CC-273) are fixed. `Visual baselines (advisory)` (CC-155) runs on every PR and is not required
   during its first week; the owner decides whether to require it. **Merging to `main` deploys to
   production** (Render). Fill in the PR template's _Deployment impact_; if start/build,
   dependencies or env vars change, rehearse Render's build and start from a fresh clone before merging (DEPLOYMENT.md).
   **Temporary (owner, 2026-10-20):** during the feature phase merges do not wait for CI and branch protection
   requires no checks. CI still runs on every PR and push, and Render deploys only commits whose checks pass. The
   owner restores the required checks after the feature phase.
8. Don't start a stage until the previous stage's exit criteria in `BACKLOG.md` are met (unless explicitly agreed).
9. **Parallel agents (owner, 2026-10-20, from research):** at most 5 builders at once on one machine. Each starts
   from fresh `main` (never another open PR) with the files and APIs it owns listed in its brief. Locally a builder
   runs only the tests its change touches (`vitest related … --maxWorkers=2`, one or two Playwright specs with
   `--workers=1`); CI runs everything and is the source of truth. Reviews block only on correctness, security or a
   missing requirement; design findings below high severity become follow-up tickets.

## History

The original app (Express 4 monolith, EJS, client-authoritative games) ran production until 2026-10-16 and was deleted
in CC-029. Its audit findings and how each was fixed are in `docs/KNOWN_ISSUES.md`; the code is in git history before
the CC-029 merge. Its MongoDB `users` collection is still read (never written) so legacy players can log in (CC-078).

## Structure (ADR-001/002/004/006)

npm-workspaces monorepo, JavaScript ES modules with JSDoc types, React + Vite frontend:
`apps/server`, `apps/web`, `packages/games` (pure engines), `packages/shared` (event names, constants).
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Built so far: `apps/web` — React app (session, home, lobby `/play/:gameId`, room `/room/:code`, `/login`, `/signup`, `/profile`, client game registry `src/games/registry.js` with lazy-loaded boards for RPS / Tic-Tac-Toe / Chess, share/seats/modal/toasts; ADR-009); `apps/server` — composition root, config, MongoDB + session store, identity model/component, HTTP app (request logging, error translation, `/api/session`), Socket.IO gateway (session-authenticated, origin-checked, rate-limited, standard acks, room handlers), room manager (domain state machine + accessor + MongoDB DAO, rooms survive restarts, lifetimes in `roomLifetimes.js`, CC-101), match history (MongoDB, replayable via `replayGame`), progression (XP/levels, exactly-once, pushed via `progress:updated`), accounts (scrypt, `/api/auth/signup|login`), background tasks for post-game work, gamification (achievements, streaks, daily quests — ADR-013), leaderboards for accounts and for guests under their server-given name, and rematch (ADR-015, ADR-060), player data following a guest who signs in (`playerTransferComponent`, ADR-014), typed errors, pino logger; `packages/shared` — game catalog, error codes, socket events, identity kinds, move rejections; `packages/games` — engine contract, registry, seeded RNG, contract test kit (`@classicade/games/testing`), engines: RPS, Tic-Tac-Toe, Chess (server clocks via the optional `deadline`/`expire` time hooks). Integration tests use an in-memory MongoDB (`testing/memoryMongo.js`).
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
npm run test:all       # every test incl. the slow-tagged bot games, as the nightly workflow does (CC-203)
npm run test:e2e       # browser persona tests (first time: npx playwright install chromium)
E2E_BROWSER=webkit npm run test:e2e   # the same on firefox or webkit (npx playwright install webkit, CC-184)
npm run test:visual    # screenshot baselines, in the pinned Playwright image through Docker (CC-155)
npm run test:visual:update  # rewrite the baselines that changed, then review the images in the PR
npm audit              # must be 0 high/critical
./scripts/issue-counts.sh  # issue counts for PROGRESS.md (never hand-edit them)
```

No local MongoDB? `docker compose up mongo` (or the whole app: `docker compose up --build`, http://localhost:4000).
A throwaway `mongodb-memory-server` instance in a temp dir also works for smoke tests.

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
