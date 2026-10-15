# Decision Log (ADRs)

Format: each decision gets an ID, status (`Open` · `Accepted` · `Superseded`), date, context, decision, consequences.

## Open decisions

### ADR-003 — Database: stay on MongoDB vs move to PostgreSQL

- **Status:** Open
- **Context:** Ratings, leaderboards, friends, payments are relational; matches/moves fit documents.
- **Recommendation:** Stay on MongoDB through Stage 1 (lower migration risk); revisit before Stage 3 payments.

### ADR-005 — Hosting

- **Status:** Open
- **Context:** Needs WebSockets, low cost, simple ops.
- **Options:** Render / Fly.io / Railway / AWS (ECS Fargate or Lightsail) + MongoDB Atlas.
- **Recommendation:** Decide in Stage 0 exit; containerize first so it's portable.

## Accepted decisions

### ADR-007 — Layered server architecture, design patterns and engineering standards

- **Status:** Accepted · 2026-10-16
- **Context:** The legacy server mixed transport, rules and storage in one file, which caused most audit findings. The product must grow (more games, bots, storage changes, new APIs) without rewrites.
- **Decision:** Five layers (service → domain logic → domain data → persistence | dependency) plus shared immutable models and utils, wired in a single composition root. Adjacent, top-down, request/response interactions only — enforced by ESLint and pinned by `architecture.test.js`. Patterns, principles, coding and testing standards in [ENGINEERING.md](ENGINEERING.md).
- **Consequences:** More files per feature, but each change touches one layer; everything is unit-testable with fakes; games/bots/storage are plug-ins (open/closed).

### ADR-008 — Dependency policy: latest stable, minimal, zero known vulnerabilities

- **Status:** Accepted · 2026-10-16
- **Decision:** Latest stable releases only (no pre-releases), Node Active LTS, prefer built-ins over packages, `npm audit` 0 high/critical before merge, majors upgraded via their own ticket. Details: [ENGINEERING.md §5](ENGINEERING.md).
- **Consequences:** Replaced nodemon with `node --watch`; upgraded `connect-mongodb-session` 2 → 5; applied same-major legacy updates. Audit went from 31 vulnerabilities (1 critical, 11 high) to 0.

### ADR-001 — Language: JavaScript

- **Status:** Accepted · 2026-10-16
- **Context:** Rewrite of server, game engines and shared event contracts.
- **Decision:** Plain JavaScript (owner's choice). New code uses ES modules. Types and contracts are documented with JSDoc
  (`@typedef`, `@param`) so editors still give autocomplete; event names live in one shared constants module, never as string literals.
- **Consequences:** No build step for the server. Protocol safety comes from shared constants + tests instead of a compiler.

### ADR-002 — Frontend: React SPA (Vite)

- **Status:** Accepted · 2026-10-16
- **Context:** Current UI is EJS + jQuery with duplicated scripts; target needs a rich realtime, mobile-first UI.
- **Decision:** React, built with Vite, served by the same Node server in production (single deploy). Styling approach decided at CC-022.
- **Consequences:** EJS views are retired as each game is ported. Legacy CSP stays relaxed until the React app replaces inline scripts.

### ADR-004 — Rewrite strategy: new code alongside legacy

- **Status:** Accepted · 2026-10-16
- **Decision:** Build the new structure next to the legacy app, port game by game, delete legacy files once each game reaches parity.
  Legacy app stays runnable throughout. Only security/bug quick-fixes (CC-007..CC-010) touch legacy code.

### ADR-006 — Repository layout: npm workspaces monorepo

- **Status:** Accepted · 2026-10-16
- **Decision:**
  - `apps/server` — Express + Socket.IO API and realtime gateway
  - `apps/web` — React + Vite frontend
  - `packages/games` — pure game engines (shared: server is authoritative; web may reuse for local/offline modes)
  - `packages/shared` — socket event names, constants, validation helpers used by both apps
    Legacy app stays at the repo root until CC-029 deletes it.
- **Consequences:** One `npm install`, shared tooling (ESLint, Prettier, Vitest) at the root.

### ADR-000 — Server-authoritative game model

- **Status:** Accepted · 2026-10-16
- **Decision:** All game rules, move validation, clocks and results run on the server through a common `GameEngine` interface. Clients send intents and render server state.
- **Consequences:** Fixes SEC-04, SEC-09, BUG-04/06/07 by construction; enables bots, replays, anti-cheat. Requires porting TTT and chess logic to the server.
