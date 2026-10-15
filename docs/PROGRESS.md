# Progress

## Status

|               |                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Process       | Ticket board: [BACKLOG.md](BACKLOG.md) · next free ID `CC-073`                                             |
| Current stage | **Stage 0 — Foundation**                                                                                   |
| Stage health  | 🟢 On track                                                                                                |
| In progress   | —                                                                                                          |
| Blocked on    | —                                                                                                          |
| Next up       | CC-011 scaffold monorepo (`apps/server`, `apps/web`, `packages/games`, `packages/shared`) → CC-012..CC-017 |

## Stage tracker

| Stage           | Status         | Done / Total |
| --------------- | -------------- | ------------ |
| S0 Foundation   | 🟡 In progress | 9 / 30       |
| S1 MVP launch   | ⚪ Not started | 0 / 19       |
| S2 Retention    | ⚪ Not started | 0 / 11       |
| S3 Monetization | ⚪ Not started | 0 / 4        |
| S4 Scale        | ⚪ Not started | 0 / 6        |

## Issue tracker

| Category         | Open | In progress | Fixed |
| ---------------- | ---- | ----------- | ----- |
| Security (SEC)   | 5    | 1           | 5     |
| Bugs (BUG)       | 11   | 1           | 2     |
| Tech debt (DEBT) | 6    | 2           | 2     |

## Changelog

Newest first. Format: `YYYY-MM-DD — <ticket IDs> — what changed`.

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
