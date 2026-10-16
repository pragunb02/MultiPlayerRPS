# Progress

## Status

|               |                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Production    | https://nocapgaming.onrender.com (Render, auto-deploys `main`) — [DEPLOYMENT.md](DEPLOYMENT.md) |
| Process       | Ticket board: [BACKLOG.md](BACKLOG.md) · next free ID `CC-078`                                  |
| Current stage | **Stage 0 — Foundation**                                                                        |
| Stage health  | 🟢 On track                                                                                     |
| In progress   | —                                                                                               |
| Blocked on    | —                                                                                               |
| Next up       | CC-020 Chess (server clocks) → CC-016 matches → CC-017 progression → CC-076 auth API            |

## Stage tracker

| Stage           | Status         | Done / Total |
| --------------- | -------------- | ------------ |
| S0 Foundation   | 🟡 In progress | 18 / 34      |
| S1 MVP launch   | ⚪ Not started | 0 / 19       |
| S2 Retention    | ⚪ Not started | 0 / 11       |
| S3 Monetization | ⚪ Not started | 0 / 4        |
| S4 Scale        | ⚪ Not started | 0 / 6        |

## Issue tracker

Counts are derived from [KNOWN_ISSUES.md](KNOWN_ISSUES.md) (`scripts/issue-counts.sh`), not edited by hand.

| Category         | Open | In progress | Fixed |
| ---------------- | ---- | ----------- | ----- |
| Security (SEC)   | 0    | 6           | 5     |
| Bugs (BUG)       | 5    | 7           | 2     |
| Tech debt (DEBT) | 3    | 6           | 3     |

## Changelog

Newest first. Format: `YYYY-MM-DD — <ticket IDs> — what changed`.

- 2026-10-16 — CC-019 — Tic-Tac-Toe engine: seeded starter as X, strict cell moves, server-decided wins/draws with exactly one result (BUG-04 regression: 9th move completing two lines), registered and playable over sockets; clients cannot claim results. Extracted shared socket test helpers. 400 tests; engine 100 % covered. Live game verified.
- 2026-10-16 — CC-018 — Rock Paper Scissors engine: best of 1/3/5/7, secret simultaneous choices (opponent sees only "has chosen"), draws replayed, round history; registered — first game playable end to end on the new server. Contract kit + full rules matrix + BUG-01 regression + socket-level proof that pending choices never reach the opponent (SEC-09). 369 tests; engine 100 % covered. Live best-of-3 verified.
- 2026-10-16 — CC-015 — Room manager across all layers: shared room/move socket contracts; room-code model; in-memory room DAO with copies + optimistic versioning; room accessor; room state machine (crypto codes, auto-start, engine-validated moves, forfeit, host hand-over, disconnect/rejoin, expiry sweep, per-viewer views, domain events); socket handlers with strict payload validation, per-socket rate limit, personalised broadcasts, multi-tab disconnects; boot check that engines are in the catalog; sweeper. 331 tests incl. 15 end-to-end socket tests (full game, forfeit, rejoin, multi-tab, rate limit). SEC-08, BUG-09/10/13/14 fixed in the new stack.
- 2026-10-16 — CC-014 — `@classicade/games`: GameEngine contract, `defineEngine` (fail-fast shape check), engine registry (plug-in point), `ok`/`reject` results, seeded RNG; contract test kit with 10 checks that every engine runs, proved against 12 deliberately broken engines (caught a weakness in the kit's own JSON-safety check — fixed). 218 tests; games package 100 % covered.
- 2026-10-16 — CC-013 — Session identity for HTTP and sockets: MongoDB (Mongoose 9, per-instance connection), sessions in MongoDB (connect-mongo 6, TTL), identity model + guest creation, hardened session cookie with fixation protection, `/api/session` routes (guest creation rate-limited), Socket.IO gateway with origin allow-list, session-only identity, standard acknowledgements, logout disconnects that session's sockets. Found and fixed a shutdown race (session-store index creation → unhandled rejection). 165 tests incl. MongoDB integration, 98.9 % lines. Verified live end to end. SEC-01/SEC-03 fixed in the new stack.
- 2026-10-16 — CC-077 — **Incident:** deploys of `main` failed — Render start command was `nodemon index.js` (removed in PR #1) and the Atlas cluster was paused. Previous deploy stayed live. Fixed with owner: Build `npm ci`, Start `npm start`, cluster resumed; verified live (200, new code, DB lookups, security headers). Follow-ups: `docs/DEPLOYMENT.md`, DB-aware `/health` (200 up / 503 down, verified both), PR template with deployment-impact checklist. Added CC-076 (auth API).
- 2026-10-16 — CC-012 — Structured logging and typed errors: shared `ERROR_CODES`; `AppError` (abstract) + Validation/Unauthorized/Forbidden/NotFound/Conflict errors with `code`, frozen `details`, `cause`; pino 10 logger with redaction of passwords/tokens/emails/cookies/auth headers; request-id + access-log middleware; single error→HTTP translation (`{ error: { code, message, requestId, details? } }`, 400/401/403/404/409/413, generic 500); `LOG_LEVEL` config; fatal-error handlers; `no-console` lint. Tests caught a real bug (access log recorded router-relative paths). 96 tests, 100 % lines. Verified live: request ids propagate, secrets absent from logs, bad config → fatal log + exit 1.
- 2026-10-16 — CC-075 — One test run failed once and could not be reproduced in 45 runs (30 under parallel load). Likely cause: `server.test.js` asserted a fetch to a freed port fails, but parallel workers (supertest) can be assigned the same ephemeral port. Now asserts `server.listening === false`.
- 2026-10-16 — CC-073 — Engineering guidelines ([ENGINEERING.md](ENGINEERING.md)): five-layer server architecture, design principles, patterns + where they apply, extension points, coding/testing standards, dependency policy (ADR-007, ADR-008). Enforced: ESLint layer + engine-purity rules (proved by `architecture.test.js`), coverage gates (80 %, games 90 %). HTTP code moved to `service/http/`; shutdown handler made injectable and tested. Dependencies: same-major legacy updates, `connect-mongodb-session` 2 → 5, nodemon → `node --watch`; `npm audit` 31 → 0. Legacy flows re-verified on in-memory MongoDB. New: CC-074 (remove env fallback), CC-031 redefined (Dependabot + audit gate). 42 tests, 100 % lines.
- 2026-10-16 — CC-011 — Monorepo scaffold: npm workspaces; `apps/server` (ESM, Express 5, validated config, `createApp()` factory, `startServer()` + graceful SIGINT/SIGTERM, `/api/health`, `/api/games`, JSON 404/500) and `packages/shared` (game catalog). 16 tests. Verified by running: endpoints respond, bad config exits 1, SIGTERM frees the port, legacy app still runs alongside on Express 4. `packages/games` → CC-014, `apps/web` → CC-022.
- 2026-10-16 — CC-072 — Introduced `CC-###` ticket IDs: BACKLOG.md is now a ticket board (type, priority, status, links), `docs/tickets/TEMPLATE.md` added, every KNOWN_ISSUES finding linked to a ticket, old `S#-##` IDs replaced everywhere. New tickets CC-030 (CSP + CSRF) and CC-031 (dependency upgrades). Next free ID: CC-073.

- 2026-10-16 — CC-003..CC-010 — Setup and legacy quick fixes:
  - README, `.env.example`, `.nvmrc` (24), `engines >=22`; ESLint 10 flat config, Prettier, Vitest; `start`/`dev`/`lint`/`format`/`test` scripts.
  - Removed 10 unused deps; `nodemon` → dev; `body-parser` → built-in `express.json`; `bcrypt` → `bcryptjs` (npm 11 blocks native install scripts; existing hashes still verify).
  - `config.js` validates env at boot; `MONGO_URI` (falls back to `MONGO_URI_PRODUCTION`).
  - Fixed RPS Scissors (BUG-01) + server-side choice validation; profile XSS (SEC-02); signup validation, unique username, 400/409 codes (SEC-07, BUG-11); generic login error (SEC-11); Helmet, auth rate limit, `HttpOnly`/`SameSite=Lax`/`Secure`-in-prod cookies, proper logout (SEC-05 partial, SEC-10); removed double Passport init (DEBT-07) and dead server code.
  - Verified against a throwaway in-memory MongoDB: signup/login/logout/profile flows, status codes, headers, rate limit (429 after 20), RPS outcomes over sockets.
  - Found BUG-14 (duplicate `playersConnectedRPS`).
- 2026-10-16 — CC-002 — ADR-001 JavaScript (ESM + JSDoc), ADR-002 React + Vite, ADR-004 build alongside legacy, ADR-006 npm-workspaces monorepo — accepted.
- 2026-10-16 — docs — Full codebase audit. Created CLAUDE.md, BRD, PRD, ARCHITECTURE, BACKLOG, DECISIONS, KNOWN_ISSUES, PROGRESS. ADR-000 (server-authoritative) accepted.
