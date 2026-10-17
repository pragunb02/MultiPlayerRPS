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

### ADR-020 — Game shell: one match layout every game plugs into

- **Status:** Proposed · 2026-10-17
- **Where:** [ux/MATCH_EXPERIENCE.md](ux/MATCH_EXPERIENCE.md) §2, from the two-browser match experience audit. Tickets
  CC-157 to CC-178.

### ADR-025, ADR-026, ADR-027 — to be written

- **Status:** Open. The roadmap ([ROADMAP.md](ROADMAP.md) §8) asks for these before the work starts:
  1. ADR-025: bot identity and rewards (CC-138).
  2. ADR-026: coin economy (CC-142).
  3. ADR-027: ratings only for skill games (CC-042).
- The roadmap first called them ADR-016, ADR-017 and ADR-018. Those numbers went to the decisions above.

## Accepted decisions

### ADR-024 — Story mode "ClassiCade Quest"

- **Status:** Accepted · 2026-10-17 (design in [story/STORY_MODE.md](story/STORY_MODE.md), CC-179; built from CC-187)
- **Decision.** A single player story across three districts (Paper Town, Grid City, The Kingdom) against character
  rivals built on the bots, with tutorials, bosses and 1 to 3 stars per level, scored on the server. The owner's
  decisions:
  1. The mascot is named Bit, everywhere (story mode, the CC-153 mascot, empty states, the 404 page).
  2. Story rewards are cosmetic only (avatars, frames, board themes and skins, badges). Nothing affects play,
     nothing is for sale, and Quest gives no coins.
  3. Story XP counts towards the player's level but not towards the weekly leaderboard. Story matches never count on
     any leaderboard.
- **Consequences.** See STORY_MODE.md sections 6 and 7 for the data (`story_progress`, XP source `story`), URLs,
  private bot rooms and the build plan.

### ADR-023 — Cookie notice: a line in the footer, not a banner

- **Status:** Accepted · 2026-10-17 (proposed in [CC-046](tickets/CC-046.md))

- **Context.** The site sets exactly one cookie, only after the player chooses to play, and only to keep them signed
  in. That is a strictly necessary cookie, for which the ePrivacy rules and similar laws require information but
  not consent. At the time, the browser tests (`e2e/fixtures.js`) failed on anything in web storage.
- **Decision.** No consent wall and no dismissible banner. Every page's footer says "One cookie keeps you signed in.
  No ads, no trackers." with a link to `/privacy`, and the policy explains the cookie in section 3.
- **Why.** A banner that can be closed must remember that it was closed, which needs a second cookie or web
  storage, exactly what the notice promises we do not use. A consent wall for a necessary cookie would ask a
  question with only one possible answer, and would get in the way of an invite link opening straight into a game.
- **Revisit when** anything non-essential is added (analytics, ads, embeds): that needs real consent, before the
  thing loads.
- **Later (ADR-018, CC-103).** The browser may now keep one preference, the sound setting, in `localStorage`
  (`cc.sound`). It is not a cookie and does not identify the player, so the footer line stays true. The Privacy and
  Terms texts are drafts until the owner's legal review.

### ADR-022 — Public names: a curated reserved list and abuse filter in the repo

- **Status:** Accepted · 2026-10-17 (proposed in [CC-119](tickets/CC-119.md))

**Context.** Public names need a reserved list and a profanity filter. A filter that is too eager refuses real
people (the Scunthorpe problem: "Scunthorpe", "Dickens", "Cockburn", "Therapist" all contain a rude word). A filter
that is too loose is pointless. We have no moderation tools yet, and must not call a third-party service from
sign-up (privacy, latency, a new failure mode).

**Decision.**

1. A small curated list in the repo (`models/nameLists.js`), no network calls, no new dependency.
2. Two kinds of entry. Short or ambiguous words ("ass", "dick", "cock", "sex", "rape", "nazi") match only a
   whole name or a whole part of a name. Parts are split at underscores, hyphens and where a capital letter
   follows a small one, so `BigDick` is caught but `Dickens` is not. Long words that never hide inside innocent
   words ("fuck", "cunt", "nigger") match anywhere, after known innocent words containing them ("Scunthorpe",
   "shiitake", "snigger") are taken out. All-lowercase joined names like `bigdick` therefore pass. That is the
   price of not refusing real names, and reports (CC-044) cover it.
3. Before comparing, a name is lowercased, leetspeak digits and symbols are read as letters, and a listed word
   also matches with its letters held longer (`fuuuck`). A doubled letter in the list stays at least doubled,
   so "ass" never matches "as". A part made only of digits is read as a number, not leetspeak, so `Player_7117`
   is not read as "tit".
4. Each check is tried with and without digits padding the ends, so both `5hit` (leetspeak) and `Admin_1`
   (padding) are read correctly.
5. Reserved staff and bot words compare exactly (no held letters), because "mood" must not read as "mod" and
   "boot" must not read as "bot". Brand words ("classicade", "nocapgaming") and the long staff words "admin" and
   "moderator" are reserved anywhere in a name, with "badminton" allowed.
6. Game names come from the shared `GAMES` catalog, so a new game is reserved without touching the filter.
7. Some common profanity is left off on purpose because it is also an ordinary name in some language (Randi,
   Lund, Lauda). The data file says so.
8. The refusal message is the same for every reserved name and the same for every unsuitable name, so the
   response never reveals the list or which word matched.
9. Existing accounts are not renamed by this ticket. Existing sessions keep working, because `createIdentity`
   does not apply the filter.

**Consequences.** Cheap, deterministic and easy to change with a test per entry. It will miss creative
spellings and joined lowercase words, and may still refuse a rare real name. When that happens, add the name to
the allowlist with a test.

### ADR-021 — Fair play: when a recorded game counts

- **Status:** Accepted · 2026-10-17 (proposed in [CC-095](tickets/CC-095.md))

**Context.** Every reward (XP, wins, quests, achievements, streaks, boards) was paid per recorded match. That makes
instant forfeits and endless short games against a friend or a second tab a free XP machine (SEC-19).

**Decision.**

1. A match is judged once for each player, right after it is recorded, and the verdict is stored on the match.
   Every reward step reads the stored verdict, never the clock or the other games again. This keeps all steps
   idempotent and consistent with each other and with recounts (gamification's stats rebuild, weekly board XP).
2. **Moves, not seconds**, decide "ended too soon": a player who never moved, or a forfeit before both players made
   two moves. Waiting costs a script nothing, so a minimum duration would only slow down honest quick games (a
   one-round Rock Paper Scissors match takes seconds and counts). Two moves each is the smallest amount of real
   play in all three games, and leaving before it is almost always an abort, not a contest.
3. **Ten counted games per opponent pair per UTC day.** Friends who play each other a lot (a long evening of Tic-Tac-Toe
   is easily more than ten games) keep playing, only the reward stops. Ten games is 300 XP at most from one
   opponent per day, about three levels at the start and much less later, so a pair cannot climb the boards
   together. UTC matches daily quests and streaks (ADR-013).
4. **Twenty counted games per player per UTC clock hour.** That is one counted game every three minutes, above what
   an honest player finishes, and caps a script that rotates many guest opponents at 480 counted games a day.
5. The limits count every other game of the day that counts for the player or is not judged yet, before and after
   this one. So two games judged at the same moment can only under-count, never over-count, and a guest's games
   moved into an account later are held to the account's whole day.
6. A guest's game that counted for the guest but would pass a limit for the account is marked `withdrawnFrom` and
   its credit is taken out of the merged totals (ADR-014 stays exactly-once: the marks are written before progress
   merges, and the merge recomputes them on resume).

**Consequences.** One extra indexed query per player per match (`players.playerId, endedAt`). Old matches count.
Limits are constants in one file, so tuning them is a one-line change with tests. Ratings (CC-042) can reuse the
verdict.

### ADR-019 — Requests between players are derived from the room view

- **Status:** Accepted · 2026-10-17 (proposed in [CC-104](tickets/CC-104.md))

Context. Draw offers and rematch requests already live in server state (the chess engine's `drawOfferBy`, the room's
`rematch.requestedBy`). Popups could be driven by new push events, but those are lost on a reload and would duplicate
state the view already carries.

Decision.

1. A request is a plain object (`RoomRequest` in `games/roomUpdates.js`) computed from the current RoomView: who
   asked, the texts, and what Accept, Decline and Cancel do (a game move, or the rematch events). Games add their own
   requests and notices through the client game registry (`requests`, `notices`), so the room page never names a
   game.
2. How a request ended is part of the state: `drawAnswer` ("declined" or "withdrawn") in the chess view and
   `rematch.declinedBy` in the RoomView. Notices are worked out by comparing the view before and after an update,
   so they follow every kind of update and nobody is told about their own answer.
3. Moving instead of answering still declines a draw offer, as before, and now says so to the offerer.

Consequences. A reload shows the same popup with no chime. Rooms and chess games stored before this change (rooms
live in MongoDB since CC-101) have no `declinedBy` or `drawAnswer`. The server's views read that as nobody, and so
does the client. Declining runs through the room component's versioned `change({ decide })` like every other room
change, and answers GONE once the rematch window has ended.

### ADR-018 — Sounds are synthesised in the browser, and one preference may live in localStorage

- **Status:** Accepted · 2026-10-17 (proposed in [CC-103](tickets/CC-103.md))

Context. We need about twenty short sounds. Audio files need a licence check, add downloads, and would need the CSP
to allow media. Browsers also refuse to start audio before the person has touched the page, and Chrome logs a
console warning when a page tries.

Decision.

1. Every sound is a few notes built with the Web Audio API (`OscillatorNode` and `GainNode`) from a recipe in
   `lib/sound/sounds.js`. There are no audio files, nothing to license, nothing to download, and no CSP change.
2. The audio context is created only inside a user gesture (`navigator.userActivation.isActive`). Before that `play`
   does nothing. The player is created in `main.jsx`, injected through the services context like the API and socket
   clients, and tests use `fakeSound()`, which records what would have played.
3. Sounds are worked out from two RoomViews (before and after an update) by pure functions, so they come out the same
   for every kind of update (a push, the answer to your own move, a rematch) and need no extra server events.
4. Sound settings are a preference of this browser, not of the account, so they live in `localStorage` under the
   single key `cc.sound` with the exact shape `{"muted":boolean,"volume":number}`. The browser tests used to demand
   that web storage is empty. They now allow exactly the keys in `STORAGE_ALLOWLIST` (`e2e/fixtures.js`), each with a
   checker for its value, so nothing identifying a player or a game can slip into storage that page scripts can read
   and that outlives the session.

Consequences. Sounds are tuned in code (gain values and wave shapes, with a unit test that keeps every note soft and
short). Changing a sound is a code change. A browser without Web Audio stays silent.

Why not a library (Howler, Tone.js): both are built for playing files or music and would add weight for what is
about two hundred lines.

### ADR-017 — Rooms are stored in MongoDB, with explicit lifetimes

- **Status:** Accepted · 2026-10-17 (proposed in [CC-101](tickets/CC-101.md))

**Context.** Rooms were kept in memory (CC-015) with a note that a Redis DAO would come for scaling (CC-061). On a
single free-plan instance that sleeps when idle, memory loses every room several times a day.

**Decision.** Store rooms in the MongoDB we already run (ADR-003), one document per room, written with optimistic
versioning. Keep lifetimes as named business rules in one module. Keep a small closed-room record for a day.

**Why MongoDB and not Redis now.** No new service, no new dependency, no new cost. A room is one small document and
changes a few times a minute. The DAO contract stays the same, so CC-061 can still swap in Redis for horizontal
scale without touching anything above the data layer.

**Consequences.** Every room action is one read and one write to MongoDB, a few milliseconds on the same region.
The every second deadline check asks only for rooms whose stored `dueAt` has come, using an index. Two new
collections appear in production. They are created on first use and need no migration, because there were no
stored rooms before.

### ADR-016 — Motion for interaction animation

- **Status:** Accepted · 2026-10-17 (proposed in [CC-102](tickets/CC-102.md))

**Context.** Chess needs pieces that slide between squares, and CC-092 plans the same for toasts, dialogs and
results. CSS transitions cannot animate a piece from one square to another when React moves the element to a new
parent, and writing a small animation engine by hand would be code we maintain forever.

**Decision.** Use `motion` (14.3.0, latest stable, MIT, no native build step), imported only from `motion/react`.

1. Wrap animated parts in `components/Motion/MotionProvider.jsx`: `LazyMotion` with `strict`, so only the small
   `m.*` components can be used, and `MotionConfig reducedMotion="user"`.
2. The `domAnimation` features load from their own file (`motionFeatures.js`) after the board has rendered.
   Something that would animate before they arrive simply appears in place.
3. Components that must not move at all for a player with reduced motion also check `useReducedMotion()` (the
   chess board skips slides entirely, as the celebrations do).
4. Motion animates by setting `element.style` from script. The CSP (CC-030) blocks style attributes written in
   markup, not styles set from script, so no CSP change is needed. The e2e `players` fixture would fail on any
   CSP violation.

**Cost.** Measured with `npm run build:web` (gzip): the chess chunk grew from 13.8 kB to 32.9 kB (our new board
code plus the Motion core), and `motionFeatures` is a separate 17.9 kB file loaded only on the chess page. The
main bundle is unchanged (118.3 kB). Pages without chess load none of it.

**Alternatives.** CSS transitions and the Web Animations API with hand written measuring (no dependency, but every
future animation needs its own measuring code). `react-spring` (heavier for the same features, less used).
Framer Motion under its old name (the same library, now published as `motion`).

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
