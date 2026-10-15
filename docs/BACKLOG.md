# Backlog — Ticket Board

Every unit of work is a ticket with a permanent ID **`CC-###`** (ClassiCade). IDs are sequential, never reused,
and don't encode the stage — a ticket can move between stages without changing its ID.

**Next free ID: `CC-078`** — bump this when you add a ticket.

| Field  | Values                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type   | `feature` · `bug` · `security` · `debt` · `infra` · `test` · `docs` · `chore`                                                                                                  |
| Pri    | `P0` must fix now / blocks launch · `P1` needed for current stage · `P2` should have · `P3` later                                                                              |
| Status | ⬜ Todo · 🟦 In progress · ⛔ Blocked · ✅ Done                                                                                                                                |
| Links  | Requirements (`FR-*`/`NFR-*` → [PRD.md](PRD.md)), findings (`SEC-*`/`BUG-*`/`DEBT-*` → [KNOWN_ISSUES.md](KNOWN_ISSUES.md)), decisions (`ADR-*` → [DECISIONS.md](DECISIONS.md)) |

**Workflow**

1. Pick a ticket → set 🟦 and create `docs/tickets/CC-###.md` from [the template](tickets/TEMPLATE.md) (skip for tickets under ~1 hour).
2. Branch `cc-###-short-name`; every commit message starts with the ID: `CC-007: fix RPS Scissors mismatch`.
3. Done → ✅ here, update linked findings in KNOWN_ISSUES.md, add a dated line in [PROGRESS.md](PROGRESS.md).
4. New work discovered → new ticket with the next free ID (never do untracked work).

### Project setup & process

| ID                          | Title                                                                                                                                                                | Type | Pri | Status  | Links                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | ------- | ------------------------------------------- |
| CC-001                      | Codebase audit; BRD, PRD, architecture, decisions, known issues, progress docs, CLAUDE.md                                                                            | docs | P1  | ✅ Done | ADR-000                                     |
| CC-072                      | Ticket ID system: `CC-###` board, ticket template, findings ↔ tickets mapping                                                                                        | docs | P1  | ✅ Done |                                             |
| [CC-073](tickets/CC-073.md) | Engineering guidelines: layered architecture, design principles & patterns, coding/testing standards, dependency policy — enforced by lint, coverage gates and audit | docs | P0  | ✅ Done | ADR-007, ADR-008, DEBT-06, DEBT-10, DEBT-11 |

---

## Stage 0 — Foundation

**Goal:** secure, structured, tested, deployable codebase with parity for the 3 existing games.
**Exit criteria:** all `SEC-*` fixed · all 3 games server-authoritative with unit tests · CI green · one deployed non-prod environment · legacy files removed.

### 0.A Decisions & setup

| ID     | Title                                                                                               | Type     | Pri | Status  | Links                              |
| ------ | --------------------------------------------------------------------------------------------------- | -------- | --- | ------- | ---------------------------------- |
| CC-002 | Resolve ADR-001 (language), ADR-002 (frontend), ADR-004 (rewrite strategy)                          | chore    | P1  | ✅ Done | ADR-001, ADR-002, ADR-004, ADR-006 |
| CC-003 | README, `.env.example`, Node version pin (`.nvmrc` / `engines`)                                     | docs     | P1  | ✅ Done | DEBT-09                            |
| CC-004 | Tooling: ESLint + Prettier, test runner (Vitest/Jest), npm scripts (`dev`, `build`, `test`, `lint`) | chore    | P1  | ✅ Done | DEBT-09                            |
| CC-005 | Remove unused deps, move `nodemon` to dev, declare real deps; `bcrypt` → `bcryptjs`                 | debt     | P1  | ✅ Done | DEBT-06                            |
| CC-006 | Config module: validate env at boot, separate dev/prod DB URIs                                      | security | P0  | ✅ Done | SEC-06, NFR-10                     |

### 0.B Quick security & bug fixes on legacy (keep app usable while restructuring)

| ID     | Title                                                             | Type     | Pri | Status  | Links                            |
| ------ | ----------------------------------------------------------------- | -------- | --- | ------- | -------------------------------- |
| CC-007 | Fix RPS "Scissor"/"Scissors" mismatch                             | bug      | P1  | ✅ Done | BUG-01                           |
| CC-008 | Escape profile JSON (XSS)                                         | security | P0  | ✅ Done | SEC-02                           |
| CC-009 | Signup validation, unique username check, proper status codes     | security | P0  | ✅ Done | SEC-07, BUG-11, FR-ACC-1, SEC-11 |
| CC-010 | Helmet, rate limiting on auth, secure cookie flags, proper logout | security | P0  | ✅ Done | SEC-05, SEC-10, NFR-1, DEBT-07   |

### 0.C New architecture

| ID                          | Title                                                                                                                                              | Type     | Pri | Status  | Links                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --- | ------- | ----------------------------------------------------- |
| [CC-011](tickets/CC-011.md) | Scaffold monorepo (`apps/server`, `apps/web`, `packages/games`, `packages/shared`) per [ARCHITECTURE.md](ARCHITECTURE.md); app factory + bootstrap | debt     | P1  | ✅ Done | DEBT-01, DEBT-02                                      |
| [CC-012](tickets/CC-012.md) | Structured logger + central error handler                                                                                                          | debt     | P1  | ✅ Done | DEBT-08                                               |
| [CC-013](tickets/CC-013.md) | Socket auth via shared session; identity from session only (guests get session identity)                                                           | security | P0  | ✅ Done | SEC-01, SEC-03, FR-ROOM-3                             |
| [CC-014](tickets/CC-014.md) | `GameEngine` interface + typed socket event contracts                                                                                              | feature  | P1  | ✅ Done | FR-GAME-1                                             |
| CC-015                      | `RoomManager`: create/join/leave, secure room codes, expiry/cleanup, disconnect handling                                                           | feature  | P1  | ⬜ Todo | FR-ROOM-1/2/5, SEC-08, BUG-10, BUG-13, BUG-14, BUG-09 |
| CC-016                      | Unified `matches` model + repository; migrate away from 3 legacy models                                                                            | debt     | P1  | ⬜ Todo | FR-ROOM-8, DEBT-04                                    |
| CC-017                      | Progression service: XP/level on match completion only; level-up event wired                                                                       | bug      | P1  | ⬜ Todo | FR-PROG-1, BUG-02, BUG-05, BUG-08                     |

### 0.D Port games (server-authoritative, unit tested)

| ID     | Title                                                           | Type    | Pri | Status  | Links                             |
| ------ | --------------------------------------------------------------- | ------- | --- | ------- | --------------------------------- |
| CC-018 | RPS engine (hidden choices, best-of-N) + tests                  | feature | P1  | ⬜ Todo | FR-GAME-2, SEC-09, BUG-02         |
| CC-019 | Tic-Tac-Toe engine + tests                                      | feature | P1  | ⬜ Todo | FR-GAME-3, SEC-04, BUG-03, BUG-04 |
| CC-020 | Chess engine (chess.js latest) + server clocks + resign + tests | feature | P1  | ⬜ Todo | FR-GAME-4, SEC-04, BUG-06, BUG-07 |
| CC-021 | Integration tests: create → join → play → result → persisted    | test    | P1  | ⬜ Todo | DEBT-09                           |

### 0.E Frontend parity

| ID     | Title                                                                         | Type    | Pri | Status  | Links                    |
| ------ | ----------------------------------------------------------------------------- | ------- | --- | ------- | ------------------------ |
| CC-022 | Frontend scaffold per ADR-002; shared layout, design tokens                   | feature | P1  | ⬜ Todo |                          |
| CC-023 | Shared components: room lobby, share menu (correct game name), modals, toasts | feature | P1  | ⬜ Todo | DEBT-03, DEBT-05, BUG-12 |
| CC-024 | Game screens: RPS, TTT, Chess rendering server state                          | feature | P1  | ⬜ Todo |                          |
| CC-025 | Auth, home, profile pages rebuilt                                             | feature | P1  | ⬜ Todo |                          |

### 0.F Delivery

| ID     | Title                                                                       | Type  | Pri | Status  | Links            |
| ------ | --------------------------------------------------------------------------- | ----- | --- | ------- | ---------------- |
| CC-026 | Dockerfile + docker-compose (app + Mongo) for local dev                     | infra | P1  | ⬜ Todo |                  |
| CC-027 | CI: lint, test, build on every push                                         | infra | P1  | ⬜ Todo | DEBT-09          |
| CC-028 | Resolve ADR-005; deploy staging environment                                 | infra | P1  | ⬜ Todo |                  |
| CC-029 | Delete legacy files (`index.js` handlers, `client/*`, old models, `hw.txt`) | debt  | P1  | ⬜ Todo | DEBT-05, DEBT-08 |

### 0.G Follow-ups found during Stage 0

| ID     | Title                                                                                                                                            | Type     | Pri | Status  | Links                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --- | ------- | ------------------------ |
| CC-030 | CSP and CSRF tokens for the new app (finishes SEC-05)                                                                                            | security | P0  | ⬜ Todo | SEC-05, NFR-1            |
| CC-031 | Automated dependency updates (Dependabot) + `npm audit` gate in CI; new code adopts latest stable majors (Mongoose 9, chess.js) as it is written | debt     | P2  | ⬜ Todo | DEBT-10                  |
| CC-074 | Rename `MONGO_URI_PRODUCTION` → `MONGO_URI` in the deployment, then remove the fallback in `config.js` (needs owner access to hosting)           | debt     | P2  | ⬜ Todo | DEBT-12, SEC-06          |
| CC-075 | Flaky test: `startServer` close check probed a freed port that parallel workers can reuse                                                        | test     | P1  | ✅ Done |                          |
| CC-076 | Auth API on the new server: signup / login / logout / me with users persistence, password hashing, rate limits (user identities for CC-013)      | security | P0  | ⬜ Todo | FR-ACC-1, SEC-01, SEC-07 |
| CC-077 | Deployment safety: DEPLOYMENT.md, `/health` + Render health check, PR template with deployment impact, incident note                             | infra    | P0  | ✅ Done |                          |

---

## Stage 1 — MVP public launch

**Exit criteria:** public URL · 3 polished games · bots for each · invite links · guest play · ratings · legal pages · monitoring.

| ID     | Title                                                                         | Type     | Pri | Status  | Links                |
| ------ | ----------------------------------------------------------------------------- | -------- | --- | ------- | -------------------- |
| CC-032 | Guest play + guest→account upgrade                                            | feature  | P1  | ⬜ Todo | FR-ACC-2, FR-ACC-3   |
| CC-033 | Password reset email                                                          | feature  | P1  | ⬜ Todo | FR-ACC-4             |
| CC-034 | Public profile, avatars                                                       | feature  | P1  | ⬜ Todo | FR-ACC-6             |
| CC-035 | Account deletion & data export                                                | security | P1  | ⬜ Todo | FR-ACC-7             |
| CC-036 | Reconnect grace period + forfeit                                              | feature  | P1  | ⬜ Todo | FR-ROOM-4, NFR-4     |
| CC-037 | Rematch flow                                                                  | feature  | P1  | ⬜ Todo | FR-ROOM-6            |
| CC-038 | Bot interface + RPS bots (random, Markov)                                     | feature  | P1  | ⬜ Todo | FR-AI-1, FR-AI-2     |
| CC-039 | TTT bots (easy/medium/minimax)                                                | feature  | P1  | ⬜ Todo | FR-AI-3              |
| CC-040 | Chess bot (Stockfish WASM/worker, levels)                                     | feature  | P1  | ⬜ Todo | FR-AI-4              |
| CC-041 | Chess: time controls, draw offer, promotion picker, PGN export, replay viewer | feature  | P1  | ⬜ Todo | FR-GAME-4, FR-GAME-5 |
| CC-042 | Glicko-2 ratings per game                                                     | feature  | P1  | ⬜ Todo | FR-PROG-2            |
| CC-043 | Share result cards; emotes                                                    | feature  | P1  | ⬜ Todo | FR-SOC-1, FR-SOC-2   |
| CC-044 | Block / mute / report                                                         | feature  | P1  | ⬜ Todo | FR-SOC-4             |
| CC-045 | Analytics events                                                              | feature  | P1  | ⬜ Todo | FR-ADM-3             |
| CC-046 | Privacy policy, ToS, cookie consent                                           | docs     | P1  | ⬜ Todo | FR-LEG-1             |
| CC-047 | Landing + SEO pages per game; brand identity                                  | feature  | P1  | ⬜ Todo | FR-MKT-1             |
| CC-048 | Accessibility & mobile pass                                                   | feature  | P1  | ⬜ Todo | NFR-8, NFR-9         |
| CC-049 | Observability: error tracking, metrics, alerts, uptime                        | infra    | P1  | ⬜ Todo | NFR-7                |
| CC-050 | Production deploy + launch checklist                                          | infra    | P1  | ⬜ Todo |                      |

## Stage 2 — Retention

| ID     | Title                                                     | Type    | Pri | Status  | Links              |
| ------ | --------------------------------------------------------- | ------- | --- | ------- | ------------------ |
| CC-051 | Quick-match matchmaking (rating-based) + bot fallback     | feature | P2  | ⬜ Todo | FR-AI-5            |
| CC-052 | Friends, presence, direct challenge                       | feature | P2  | ⬜ Todo | FR-SOC-3           |
| CC-053 | Leaderboards                                              | feature | P2  | ⬜ Todo | FR-PROG-3          |
| CC-054 | Achievements, streaks                                     | feature | P2  | ⬜ Todo | FR-PROG-4          |
| CC-055 | Seasons                                                   | feature | P2  | ⬜ Todo | FR-PROG-5          |
| CC-056 | Spectating                                                | feature | P2  | ⬜ Todo | FR-ROOM-7          |
| CC-057 | Ludo (2–4 players)                                        | feature | P2  | ⬜ Todo | FR-GAME-6          |
| CC-058 | Social login                                              | feature | P2  | ⬜ Todo | FR-ACC-5           |
| CC-059 | Admin console + feature flags                             | feature | P2  | ⬜ Todo | FR-ADM-1, FR-ADM-2 |
| CC-060 | Anti-cheat signals                                        | feature | P2  | ⬜ Todo | FR-AI-7            |
| CC-061 | Redis-backed rooms + Socket.IO adapter (horizontal scale) | infra   | P2  | ⬜ Todo | NFR-5              |

## Stage 3 — Monetization

| ID     | Title                                       | Type    | Pri | Status  | Links    |
| ------ | ------------------------------------------- | ------- | --- | ------- | -------- |
| CC-062 | Payments + Plus subscription & entitlements | feature | P3  | ⬜ Todo | FR-MON-1 |
| CC-063 | Cosmetics store                             | feature | P3  | ⬜ Todo | FR-MON-2 |
| CC-064 | Ads (between matches)                       | feature | P3  | ⬜ Todo | FR-MON-3 |
| CC-065 | Revisit ADR-003 (DB) before payments        | chore   | P3  | ⬜ Todo |          |

## Stage 4 — Scale

| ID     | Title                                                | Type    | Pri | Status  | Links     |
| ------ | ---------------------------------------------------- | ------- | --- | ------- | --------- |
| CC-066 | More games (Connect Four, Checkers, Dots & Boxes, …) | feature | P3  | ⬜ Todo | FR-GAME-7 |
| CC-067 | Tournaments                                          | feature | P3  | ⬜ Todo | FR-PROG-6 |
| CC-068 | Clubs/groups                                         | feature | P3  | ⬜ Todo | FR-SOC-5  |
| CC-069 | AI coach / post-game analysis                        | feature | P3  | ⬜ Todo | FR-AI-6   |
| CC-070 | B2B private events                                   | feature | P3  | ⬜ Todo |           |
| CC-071 | Native apps                                          | feature | P3  | ⬜ Todo |           |
