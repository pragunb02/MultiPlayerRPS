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

### ADR-012: visual identity — "neon arcade"

- **Status:** Accepted · 2026-10-16 (proposed in [CC-087](tickets/CC-087.md))
  **Decision.** The web app's look is a self-contained arcade theme built only from what the CSP already allows:

1. **Tokens are the single source of colour, size and motion.** Every existing token name is kept (values may
   change), so B's and C's components restyle automatically. New tokens: display font stack (system fonts only, no
   `@font-face`), `--text-3xl`, `--radius-xl`, accent / XP / gold / streak / per-game / tier / locked colours,
   hero and XP gradients, the background grid line, glows, chunky press shadows, five durations and three easings.
   Art-only inks (`--color-art-ink`, `--color-art-white`, `--color-on-tier`, `--color-neon-*`), chess-square colours
   and the backdrop moved into tokens too, so components hold no raw colours.
2. **Art is hand-drawn SVG in React components** (`apps/web/src/art/`), painted with SVG presentation attributes and
   CSS-module classes over tokens — never a `style` attribute or `<style>` element. Variation without inline styles:
   confetti pieces get their position, drift, spin and colour from `:nth-child` rules; bars are `<progress>`.
   Glyphs are `<g>` groups so scenes, icons and medals reuse one drawing.
3. **Motion is decoration, never information.** Only `transform` and `opacity` animate (two documented exceptions
   below); nothing loops forever (sparkles 3 twinkles, flame 3 flickers); celebrations are `pointer-events: none`,
   `aria-hidden`, portalled to `<body>`, and finish within 1.5 s. The meaning is always also text: the room's
   "You won!" status, the "+30 XP" and "Level up! …" toasts.
4. **Reduced motion** sets every duration to 0, `global.css` turns off all animations and transitions, and
   `useReducedMotion()` (a `useSyncExternalStore` over `matchMedia`) makes `Confetti`, `LevelUpBurst` and `XpPop`
   render nothing. States that animate in are drawn so their resting (un-animated) style is the final one.
5. **Registries for extension.** `GAME_ART` maps game id → `{ Art, Glyph, tone }`; a new game adds one entry and
   falls back to the joystick until it does. Achievement icons fall back to a star.
6. **Lint guard.** `no-restricted-syntax` on `JSXAttribute[name.name='style']` ("inline styles violate CSP; use a
   CSS module") in `apps/web/src`, no new dependency.

**Alternatives considered.** An icon font or an icon library (new dependency, external assets, copyright);
a web font for the display face (a font file and a CSP change for little gain — `ui-rounded` and fallbacks look
right on all major platforms); a motion library (bundle cost; CSS keyframes do everything needed); inline style
variables for confetti (blocked by the CSP).

**Consequences.** Initial JS grows by about 9.5 KB gzip against main after the gamification batch (112.1 → 121.7 KB,
including the 3.4 KB `jsx-runtime` chunk Vite now splits out because the hero art is lazy), CSS by about 5.4 KB gzip
(4.6 → 10.0 KB); the hero scene is its own 1.2 KB chunk.
New screens must use tokens and the art registry; a style attribute fails `npm run lint`.

### Where the brief and the repo rules differ

- **Animated properties.** The brief allows only `transform`/`opacity` but also asks for a press shadow that
  shrinks and a stroke draw-in for X/O. Both are kept: `box-shadow` changes on press (80 ms) and
  `stroke-dashoffset` draws marks in (200 ms) — both paint-only, no layout.
- **XP bar shimmer.** A `<progress>` has no reliable `::after`, so the header chip's bar pulses once
  (`transform: scaleY`) when XP arrives instead of a gradient sweep.
- **Toasts** moved to the top right as the brief asks; the region is `pointer-events: none`, so a toast can never
  cover a button (relevant for the e2e suite and for people).
- **Focus colour.** `--color-focus` in light was `#f0a400` (1.9:1 on the background). It is now `#b45309`
  (4.6:1 on bg, 5.0:1 on surface); on the hero gradient the ring is `--color-focus-on-hero` `#ffe08a`
  (4.4:1 light, 8.4:1+ dark). Cells of the coloured TTT grid and chess squares draw the ring inside the cell.
- **Primary on primary-soft** is 4.49:1 (light) / 4.26:1 (dark), just under AA for small text, so the active nav
  pill, seat tags and ghost-button hover use text colour (14:1 / 12:1) or the raised surface instead.
- **Header chip.** The brief says "using the existing `useProgress`". It does, plus it follows `progress:updated`
  pushes so the level is live; it is mounted per identity (`key`), and only when there is a session, so visitors
  never request `/api/progress`.

### ADR-015 — Leaderboards and rematch

- **Status:** Accepted · 2026-10-16 (proposed in [CC-053](tickets/CC-053.md))
  **Context.** We need global, per-game and weekly leaderboards (FR-PROG-3) that stay correct when a match is applied
  twice, when quest XP arrives outside matches, and when a guest's data moves to an account (ADR-014).

**Decision.**

1. **Accounts only.** Entries are written only for `user_…` ids (`isAccountId`). Guest XP is never stored on a board;
   it reaches the boards through the account once the guest signs up.
2. **One collection, keyed by board and period**: `leaderboard_entries { board: "xp" | "wins:<gameId>", period:
"all" | "2026-W42", playerId, displayName, level, score, recentKeys, updatedAt, expiresAt? }`. Unique
   `{board, period, playerId}`; list index `{board, period, score: -1, updatedAt: 1, playerId: 1}` (the player id
   makes the order total, so the index serves the sort); TTL on `expiresAt` (weekly entries: week end + 28 days).
3. **Two idempotent writes only.**
   - `raiseScore` for totals (overall XP from the player's progress, wins per game from `matchDao.countWins`): the
     score only rises, `updatedAt` changes only when it does. Re-applying a total is a no-op; it also self-heals:
     wins before this feature count as soon as the player wins again.
   - `addOnce` for this week's XP, keyed by match id or quest key (last 200 keys remembered, like progress).
4. **Ranks**: list position for the top entries; "your rank" = entries ahead of yours + 1, using the same order
   (higher score; on a tie, earlier `updatedAt`; then lower player id). The brief said "number with a higher score +
   1" — that would disagree with the tie-broken list, so the list's order is used for both.
5. **Board ids are URL slugs** generated from `GAMES` (a new game gets a board with no code changes); the catalog
   lives in `@classicade/shared`, so the web app renders tabs without a request and paths can validate.
6. **Public endpoints** with their own rate limit (120/min per IP, raised for browser tests like the other limits).
7. **Rematch** (CC-037) is a transition inside the room state machine: `finished → playing` in the same room code,
   new match id and seed, same options, seats reversed. The room keeps `rematch { requestedBy, available }` and a
   `series { games, wins }`. See `docs/tickets/CC-037.md`.

**Consequences.** Weekly scores are kept for four weeks for history; older ones vanish via TTL. A player's weekly
score after a guest transfer is recomputed from this week's matches (scores only rise, so quest XP already on the
weekly entry is not lost, but a guest's quest XP from this week is not added). Leaderboards trust progression for
XP; if progression is ever recomputed downwards, boards keep the higher value until a dedicated rebuild job exists.

### ADR-014 — Player data follows the identity

- **Status:** Accepted · 2026-10-16 (proposed in [CC-032](tickets/CC-032.md))
  **Context.** Several components store data by player id (matches, progress; soon achievements, streaks, quests,
  leaderboards). A guest who signs in becomes a different player id. Moving the data must be exactly-once, survive a
  crash at any point, never block the sign-in, and must not lose a match that finishes while the player signs in.

**Decision.**

1. Every domain component that stores data by player id exposes
   `transferPlayer({ from, to: Identity, now }) → { moved: Record<string, number> }`: move everything stored for
   `from` to `to`, merging into what `to` already has; idempotent and resumable. Rooms keep their synchronous
   `transferPlayer` for seats (CC-083).
2. `domain/identity/playerTransferComponent.js` orchestrates: insert a `player_transfers` record (`{ from }` unique —
   a guest moves once) as `pending` → run each participant in the order the composition root lists them → mark
   `done` with `carriedOver`. `resumePending({ now })` re-runs transfers still pending 30 s after they started
   (housekeeping, every 60 s). `follow({ match, now })` runs in the match pipeline between recording and
   progression: a match recorded under the guest's id after their history moved is moved too.
3. Participants, in order: `matches` (CC-032), `progress` (CC-032), then gamification (B) and leaderboards (C) add
   one line each in `server.js` and `testing/testApp.js`.
4. Matches: every match `from` played that `to` did not is rewritten with `renamePlayer(match, from, to.id)` (the
   same helper rooms use) and the account's display name; the replacement only applies while `from` is still in the
   stored document, so re-runs are no-ops. A match the guest played against that same account stays unchanged.
5. Progress, two guarded steps: (1) mark the guest's document `mergedInto: <account>` (creating an empty one if the
   guest has none); (2) add its totals to the account, guarded by `mergedFrom: { $ne: guest }`, and remember the
   guest's recent match ids so none of them is applied to the account twice.
6. The sign-in route awaits the transfer and reports `carriedOver`; errors are caught there, logged with ids only,
   and the sign-in still succeeds.

**Deviations from the design brief** (and why):

- The guest's progress document is **kept as a marker** (`mergedInto`) instead of being deleted in a third step.
  Any match applied to that guest later (one that finished during the sign-in and slipped past `follow`) finds the
  marker, and `progressAccessor.applyMatchOnce` credits the account instead — exactly once, thanks to the merged
  match ids. Deleting the document would let such a match recreate a guest document nobody will ever read. Cost:
  one small document per converted guest.
- `follow` takes `{ match, now }` (named parameters, like every other call), and the transfer component receives
  `matches: { transferPlayer, getById }` explicitly for `follow`, besides the participant list.
- `carriedOver` is omitted when nothing moved (a guest who never finished a match), so clients show nothing.

**Consequences.** Adding a new kind of per-player data means adding a participant, not editing sign-in code.
Participants must be idempotent; their contract tests include running the move twice and resuming after a partial
run. Guests can no longer be "re-used": a guest id that moved once is refused for a second account (409 inside the
transfer, logged; the sign-in itself succeeds).

### ADR-013 — Gamification rules

- **Status:** Accepted · 2026-10-16 (proposed in [CC-054](tickets/CC-054.md))
  **Context.** We want achievements, streaks and daily quests that drive return visits without breaking the XP
  economy, that work for guests, and that can be rebuilt from what we already store.

**Decision.**

1. **One pipeline step after progression.** `connectMatchPipeline` runs `gamificationComponent.applyMatch({ match,
updates, now })` as its own background task after progression, so it only ever sees recorded matches and a
   failure is logged separately ("apply gamification") without touching XP already awarded.
2. **Counting.** A recorded match counts once per player (exactly-once by match id in a 200-key window per
   document, like progression). The player who left gets a loss; the opponent a win (`resultFor`). The match day is
   the UTC day of `endedAt`.
3. **Win streak** across all games in arrival order: win +1, loss or forfeit → 0, draw unchanged.
   **Daily streak** in UTC days: same day no change, next day +1, gap → 1, own forfeit ignored. A late match from
   _before_ the last counted day changes nothing (otherwise one late write would reset a streak). Read with `now`:
   last day before yesterday → shown as 0; last day yesterday → `atRisk`.
4. **Achievements are status only — no XP.** Evaluated by a pure `evaluateAchievements(stats, progress)` over
   `player_stats` + progress totals. Every metric except `questsCompleted` can be rebuilt from `matches`.
   "Triple Threat" grows with the catalog (`GAMES.length`).
5. **Quest XP goes through progression** with an idempotency key (`quest:<day>:<questId>`, `quest:<day>:sweep`),
   via `progressAccessor.applyAwardOnce` (XP only, not a match played). After each match, every completed quest of
   the day is (re)awarded by key, so a crash between saving the quests and awarding the XP heals with the next match.
6. **Concurrency.** Stats and quest days are read-modify-write with a `version` compare-and-set (retry up to 5
   times, then `ConflictError`); unlocks rely on a unique `{playerId, achievementId}` index.
7. **Events** `GAMIFICATION_EVENTS.{ACHIEVEMENTS_UNLOCKED, QUESTS_UPDATED, STREAKS_UPDATED}`, each mapped by the
   gateway to the player's own `player:<id>` room. `PROGRESS_UPDATED` gains `source: "match" | "quest"` and `key`;
   the web shows "+30 XP" for match XP and "Quest complete! +40 XP" for quest XP.
8. **Transfer (ADR-014 participant).** Unlocks move with the earlier time kept; stats are rebuilt from the account's
   (already moved) history — and those match ids are remembered, so a match that finishes during the sign-in is
   never counted twice; completed quests are added once (`mergedFrom`); guest quest days are deleted (their XP moved
   with progress).

**Consequences.** Cheap reads (one stats doc, one quest doc, a small unlock list). Up to ~8 extra small writes per
player per match. **Known risk:** someone can farm XP by playing guest against guest with themselves; quest XP is
capped at 150 a day (see CC-089) and leaderboards are accounts-only (CC-053). A per-opponent daily cap can come later.

**Alternatives.** Achievements awarding XP (rejected: feedback loops, harder to balance); computing everything on
read from `matches` (rejected: grows with history; kept as the rebuild path for transfers instead).

### ADR-011 — URL scheme: one canonical URL per screen, readable slugs, old URLs redirect

- **Status:** Accepted · 2026-10-16
- **Context:** The first React app used `/play/rps` and `/room/AB2CD3`: game ids in URLs, room links that don't say which
  game, lower-case codes that failed, nested `next` parameters on account pages, one title for every tab, and the legacy
  app's URLs (`/games/chess`, `/u/:name/userprofile`) answering "not found" for anyone with a bookmark.
- **Decision:**
  - URLs: `/` · `/games/:slug` · `/games/:slug/rooms/:code` · `/login?next=` · `/signup?next=` · `/profile`.
  - Games get a readable, permanent `slug` in the shared catalog (`rock-paper-scissors`, `tic-tac-toe`, `chess`); ids
    stay internal (events, API, database).
  - All URLs are built by one module (`apps/web/src/app/paths.js`); components never write URL strings.
  - Each page renders only at its canonical URL and replaces (`history.replace`) any other spelling — old URLs, ids,
    case, a room opened under the wrong game — so the back button never returns to a redirect.
  - `next` accepts only same-site paths and never an account page (no open redirect, no loops); signed-in users opening
    log in / sign up are sent to `next`.
  - Each page sets its own `<title>`.
- **Consequences:** Invite links name the game. Old links keep working forever (the redirect table is part of the
  public contract; slugs are never reused). Public player profiles (`/players/:username`) are a separate decision —
  they need a privacy choice and a public API.

### ADR-010 — CSRF defence without tokens for the same-origin app

- **Status:** Accepted · 2026-10-16
- **Context:** CC-030 was written as "CSRF tokens". The new app is a same-origin SPA talking JSON to its own API; it has no
  cross-site HTML forms and never enables CORS.
- **Decision:** Defend in depth without tokens (OWASP "verify origin with standard headers" + SameSite cookies):
  session cookies `SameSite=Lax`; state-changing `/api` requests must carry an allowed `Origin` when the browser sends one;
  request bodies must be `application/json` (cross-site pages cannot send JSON without a preflight we never grant).
  Sockets already check `Origin` at the handshake (CC-013).
- **Consequences:** No token plumbing in the client; stateless. Revisit if we ever allow cross-origin API clients, embed the
  app in other sites, or add classic HTML form posts.

### ADR-009 — Web app conventions: CSS Modules + tokens, injected clients, same-origin dev proxy

- **Status:** Accepted · 2026-10-16
- **Decision:**
  - **Styling:** CSS Modules (built into Vite, zero dependencies, styles scoped per component) over a single design-token
    file (`styles/tokens.css`, CSS custom properties) with light/dark themes from `prefers-color-scheme`. No raw colours
    or sizes in components.
  - **Data access:** only `src/lib` talks to the server (`createApiClient`, `createSocketClient`); both turn failures into
    `AppRequestError` carrying the server's `code`. Clients are created once in `main.jsx` and injected through a services
    context; components/pages may not call `fetch` or import `socket.io-client` (lint-enforced).
  - **State:** small hooks/providers (`SessionProvider`, `useGames`) instead of a state library until a second use appears.
  - **Development:** Vite proxies `/api` and `/socket.io` to the API server, so the app is same-origin in development as in
    production (one deploy, ADR-002) — cookies and origin checks behave identically.
  - **Tests:** Vitest project `web` (jsdom) with Testing Library; fakes for the injected clients.
- **Consequences:** No CSS framework to learn or upgrade; tests never touch the network; swapping transport or adding
  caching happens in `src/lib` only.

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
