# Progress

## Status

|               |                                                                                      |
| ------------- | ------------------------------------------------------------------------------------ |
| Process       | Ticket board: [BACKLOG.md](BACKLOG.md) · next free ID `CC-076`                       |
| Current stage | **Stage 0 — Foundation**                                                             |
| Stage health  | 🟢 On track                                                                          |
| In progress   | —                                                                                    |
| Blocked on    | —                                                                                    |
| Next up       | CC-013 socket auth / session identity → CC-014 engine interface → CC-015 RoomManager |

## Stage tracker

| Stage           | Status         | Done / Total |
| --------------- | -------------- | ------------ |
| S0 Foundation   | 🟡 In progress | 12 / 32      |
| S1 MVP launch   | ⚪ Not started | 0 / 19       |
| S2 Retention    | ⚪ Not started | 0 / 11       |
| S3 Monetization | ⚪ Not started | 0 / 4        |
| S4 Scale        | ⚪ Not started | 0 / 6        |

## Issue tracker

| Category         | Open | In progress | Fixed |
| ---------------- | ---- | ----------- | ----- |
| Security (SEC)   | 5    | 1           | 5     |
| Bugs (BUG)       | 11   | 1           | 2     |
| Tech debt (DEBT) | 4    | 6           | 3     |

## Changelog

Newest first. Format: `YYYY-MM-DD — <ticket IDs> — what changed`.

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
