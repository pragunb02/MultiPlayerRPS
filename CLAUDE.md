# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository. This file is a map: short rules, the commands,
and where the detail lives. Detail goes in the linked docs, not here (CC-302).

## Project

**ClassiCade** — a real-time, social, skill-based platform for classic multiplayer games (Rock Paper Scissors,
Tic-Tac-Toe, Chess today; Ludo and more planned). Treated as a company/product, not a college project. An
npm-workspaces monorepo in JavaScript ES modules with JSDoc types: `apps/server` (Express 5, Socket.IO, MongoDB),
`apps/web` (React + Vite), `packages/games` (pure engines), `packages/shared` (event names, constants). Vision:
[docs/BRD.md](docs/BRD.md). Structure: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Always

Each rule names the check that enforces it, where one exists.

1. **No secrets in the repository**, in logs or in responses: no `.env`, keys, tokens, passwords, session ids or
   emails. Check: GitHub secret scanning with push protection (DEPLOYMENT.md "Repository protection"), the `players`
   fixture in browser tests. Detail: ENGINEERING.md §3 rules 8 and 9.
2. **Never delete the legacy collections** (`users`, `sessions`, `chessdatas`, `rpsdatas`, `tictactoedatas`, `book`
   in `GameArena`). `users` is read, never written (CC-078, CC-251). Check: `legacyUserDao.integration.test.js`
   ("never writes to the legacy collection"). Detail: [docs/DATA.md](docs/DATA.md).
3. **Bind to 127.0.0.1.** The server's `HOST` defaults to `127.0.0.1` and Docker publishes on `127.0.0.1` only. Only
   Render sets `0.0.0.0` (CC-287). Check: `apps/server/src/config/index.test.js`. Detail: DEPLOYMENT.md "Listen
   address".
4. **Commit identity:** `git -c user.email=pragun.bhutani897@gmail.com -c user.name="Pragun Bhutani" commit …`.
5. **Test first.** Every bug fix starts with a failing test that reproduces it, and every change has its tests
   beside the code. Check: coverage gates in `npm run test:coverage` (100 % lines and functions, 99 % branches).
   Detail: ENGINEERING.md §4.
6. **Read [docs/ENGINEERING.md](docs/ENGINEERING.md) before writing code.** It is binding for `apps/` and
   `packages/`: five server layers, server-authoritative games, pure core, composition root, typed errors, comment
   style, inclusive language, dependency policy. Check: `npm run lint` (layers, comment style, CSS tokens, pop-ups).
   Screens follow [docs/design/CONTRACT.md](docs/design/CONTRACT.md).

## Working agreement (owner, 17 October 2026)

These rules come first. Where they differ from anything else, they win. Full text:
[docs/PROCESS.md](docs/PROCESS.md#the-working-agreement-in-full-owner-17-october-2026).

1. **Feature freeze.** No new feature or idea tickets until the board is closed. Ideas go in `docs/IDEAS.md` only.
2. **Allowed new tickets:** security, testing, and bugs in things that already exist.
3. **Security is P0 by default**, P1 only while a higher P0 is in progress. Never cut or deferred without the owner.
4. **Research before code**, in the ticket's Research section, small fixes included.
5. **Document everything.** Nothing decided only in chat.
6. **Steady, not frantic.** At most 5 builders (rule 9), independent work only. A red `main` is fixed first.
7. **Launch is by word of mouth**, when the owner decides.
8. **Reviews before every merge**: code, security and (for anything players see) design reviewers, each finding
   checked by a skeptic. Confirmed findings are fixed or written down with a reason.

## Decision-first tickets (owner, 2026-10-20, CC-311, ADR-072)

Detail in [docs/PROCESS.md](docs/PROCESS.md).

1. **Decision gate.** No builder starts until every open decision is answered or its default day has passed.
   Check: `node scripts/bin/check-tickets.mjs` in the `Changelog fragments` job.
2. **Owner decision list** in `docs/DECISIONS-PENDING.md`, kept by the coordinator.
3. **Shaping interview**: all of a ticket's questions to the owner at once.
4. **Spec review** of the ticket before build, code review against its acceptance criteria after.
5. **Appetite.** Going over means cutting scope, not extending the build.
6. **Files touched.** Never two builders on overlapping areas.
7. **Flags.** New player-facing features ship behind a flag, off by default, with a removal date. Check:
   `packages/shared/src/flags.test.js` (well formed, not past `removeBy`), `apps/server/src/flagNames.test.js`
   (registered, read, and a `flagPaths` suite). How: PROCESS.md "How a feature ships behind a flag".

## Workflow rules

1. Before starting, read `docs/PROGRESS.md` and the ticket on `docs/BACKLOG.md`.
2. **No untracked work.** Anything new, bugs found along the way included, gets a ticket first.
3. Every ticket gets `docs/tickets/CC-###.md` from `TEMPLATE.md`, or `TEMPLATE-lite.md` for one-sentence work.
4. Branch `cc-###-short-name`. Every commit message starts with the ticket ID (`CC-007: fix …`, `CC-003, CC-004: …`).
   Every PR fills the template's Evidence section; images go on the `pr-evidence` branch, test accounts only.
5. **Fragments.** Finish with one `docs/changes/CC-###.md` ([format](docs/changes/README.md)). **Never edit
   `PROGRESS.md`'s changelog, the board rows in `BACKLOG.md` or any next free line**; ask the coordinator for new
   numbers ([PROCESS.md](docs/PROCESS.md#ticket-and-adr-numbers)). Check: `collect-changes.mjs --check` in the
   `Changelog fragments` job (the changelog only).
6. Non-trivial decisions (library, pattern, data model) get an ADR in `DECISIONS.md` first.
7. **Merge policy.** Every required check green, on a branch up to date with `main`. Check: the ruleset "main:
   required checks, branch up to date" (seven checks, plus CodeQL). **Merging to `main` deploys to production**
   (Render): fill in _Deployment impact_. Detail: DEPLOYMENT.md "Merge policy and required checks".
8. Don't start a stage until the previous stage's exit criteria in `BACKLOG.md` are met (unless agreed).
9. **Parallel agents:** at most 5 builders, each from fresh `main` with its files listed in its brief. **Locally run
   only the tests your change touches** (`npx vitest related <files> --run --maxWorkers=2`, one or two Playwright
   specs with `--workers=1`); CI runs everything. Reviews block only on correctness, security or a missing
   requirement.

## Commands

```bash
nvm use && npm install
cp apps/server/.env.example apps/server/.env   # MONGO_URI (non-production DB!), SESSION_SECRET
npm run dev:server     # server (apps/server) on 127.0.0.1:4000
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
npm run test:visual:update  # optional: rewrite the baselines that changed (main's are refreshed after merge, CC-300)
npm audit              # must be 0 high/critical
node scripts/bin/check-tickets.mjs          # the decision gate on ticket files
node scripts/bin/collect-changes.mjs --check   # check the fragments, write nothing
./scripts/issue-counts.sh  # issue counts for PROGRESS.md (never hand-edit them)
```

No local MongoDB? `docker compose up mongo` (or the whole app: `docker compose up --build`, http://localhost:4000).
A throwaway `mongodb-memory-server` instance in a temp dir also works for smoke tests.

## Where things are

| File                                               | Holds                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [docs/BRD.md](docs/BRD.md)                         | Business requirements: vision, users, business model, KPIs                 |
| [docs/PRD.md](docs/PRD.md)                         | Product requirements per stage (`FR-*`, `NFR-*`)                           |
| [docs/PRODUCT_VISION.md](docs/PRODUCT_VISION.md)   | Personas, loops, phases and order of work, metrics (North Star WRP)        |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | Current vs. target architecture, what is built                             |
| [docs/ENGINEERING.md](docs/ENGINEERING.md)         | How to write code: layers, patterns, coding and testing standards          |
| [docs/design/CONTRACT.md](docs/design/CONTRACT.md) | Design tokens, components, pop-ups, copy limits                            |
| [docs/DATA.md](docs/DATA.md)                       | What is stored where, who reads it, how long it is kept                    |
| [docs/PROCESS.md](docs/PROCESS.md)                 | Ticket stages, working agreement in full, ticket and ADR numbers, flags    |
| [docs/BACKLOG.md](docs/BACKLOG.md)                 | The ticket board, `CC-###`, and the next free ID                           |
| [docs/tickets/](docs/tickets/)                     | One file per ticket, from `TEMPLATE.md` or `TEMPLATE-lite.md`              |
| [docs/changes/](docs/changes/README.md)            | Changelog fragments, one per PR (CC-299)                                   |
| [docs/PROGRESS.md](docs/PROGRESS.md)               | Current phase, in-flight work, dated changelog (folded from fragments)     |
| [docs/DECISIONS.md](docs/DECISIONS.md)             | Decision records (`ADR-*`); open owner questions in `DECISIONS-PENDING.md` |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)           | Production: Render, env vars, merge policy, before/after merge, rollback   |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)       | Audit findings (`BUG-*`, `SEC-*`, `DEBT-*`), legacy history                |
