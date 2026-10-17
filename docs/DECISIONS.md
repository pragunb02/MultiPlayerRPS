# Decision Log (ADRs)

Format: each decision gets an ID, status (`Open` · `Accepted` · `Superseded`), date, context, decision, consequences.

## Open decisions

### ADR-003 — Database: stay on MongoDB vs move to PostgreSQL

- **Status:** Open
- **Context:** Ratings, leaderboards, friends, payments are relational; matches/moves fit documents.
- **Recommendation:** Stay on MongoDB through Stage 1 (lower migration risk); revisit before Stage 3 payments.

## Accepted decisions

### ADR-031 — Notification channels and caps

- **Status:** Accepted · 2026-10-18 (from [GROWTH.md](GROWTH.md) §5)
- **Context:** Reminders bring players back, but too many make them leave and break the promise of at most one
  reminder a day (PRODUCT_VISION.md).
- **Decision:**
  1. Messages about something the player started (your move, a challenge, a rematch, a friend accepted) are on once
     push is allowed, for adults only: at most 1 per opponent every 15 minutes and 10 a day, bundled when 3 or more are
     waiting, and none while the tab is open.
  2. Reminders the player did not ask for (daily puzzle ready, streak reminder) are off until an adult turns them on:
     at most 1 a day and 4 a week, only on days the player has not played. After 3 ignored they drop to once a week,
     after 7 ignored they stop and leave one inbox item.
  3. A weekly email recap is off by default with double opt in, only when something happened, and it uses that day's
     reminder slot.
  4. Across all channels, at most 1 contact a day the player did not ask for. Quiet hours in local time. Every message
     has a one tap opt out. Minors and people of unknown age get no reminders or marketing of any kind (ADR-028).
  5. Web push and email first. WhatsApp and SMS cost money per message and wait.
- **Consequences:** Reminders reach few players at first, and that is accepted. Notification work follows these rules:
  CC-147 (inbox), CC-148 (PWA and web push), CC-215 (preferences and quiet hours), CC-229 (dark pattern audit before
  push ships) and CC-208.

### ADR-032 — Launch sequence and the brand domain

- **Status:** Accepted · 2026-10-18 (from [GROWTH.md](GROWTH.md) §3.1 and §7.3)
- **Decision:**
  1. A friends launch by word of mouth, on a date the owner picks once all of these are done: Phase 0 is closed (the
     leaked password rotated, the security batch merged, staging), every open security P0 is closed, CC-123 is live
     (the brand domain, with the 301 from the onrender.com address), CC-232 (the cold start loading screen) is live,
     and Play vs Computer (CC-138) is live. The rematch fixes are already live (PR #53).
  2. The public launch (communities, Product Hunt and similar) is a second, later owner decision, recorded in this
     file after the friends launch has 4 weeks of data in the owner console. Its gate is the growth rule: k of 0.15 or
     more for two weeks running. The day 2 target (about 15 % of new players come back on day 2) is a guide, not the
     gate.
  3. Buy a short brand domain soon (about ₹800 to ₹1,500 a year), so Search Console can be verified by DNS with no
     code and search history starts early (CC-123).
  4. Later: a postal address that is not a home address, as email law requires, before any marketing or recap email
     (transactional email such as password reset is exempt), and a decision on whether to put a card on Render before
     any burst post.

### ADR-029 — Liquidity gates: crowd features switch on only when the crowd is there

- **Status:** Accepted · 2026-10-17 ([PRODUCT_VISION.md](PRODUCT_VISION.md) §6.0, decision D14. Built by CC-228 on
  CC-176)
- **Context.** Nobody has a counted result on production yet. An empty arena, an empty leaderboard or "0 playing
  now" tells a visitor the site is empty.
- **Decision.**
  1. Every feature that needs a crowd has a numeric switch-on threshold, from the table below.
  2. A nightly job (CC-176) checks the thresholds and a small flag table (CC-228) switches the features on and off.
  3. A gate opens after its threshold has held for 2 weeks in a row, and closes after it has stayed below for 4
     weeks in a row.
  4. Before a gate opens, the screen shows the fallback in the table, never an empty list.
  5. Every threshold is an estimate, tuned once data exists. Changing a threshold is a one-line change with a test.

| Feature                                             | Switch-on threshold                                             | Shown before the gate opens                        |
| --------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| "Find a person" as the main button for an hour slot | 60% or more of searches in that slot find a person within 4 s   | A character is the main button                     |
| Search timeout                                      | The 80th percentile wait of successful searches, at most 4 s    | 4 s                                                |
| "N playing now"                                     | Median of 50 or more people online at that hour over 7 days     | Nothing                                            |
| Recent wins row on home                             | 200 or more opted-in adult accounts finishing matches per day   | Nothing                                            |
| Top 5 on a game page                                | 50 or more accounts on that game's weekly board                 | "Your best this week"                              |
| Any leaderboard tab                                 | 25 or more entries                                              | "Your week"                                        |
| Achievement rarity                                  | 500 or more accounts                                            | The achievement without a percentage               |
| Weekly arena per game (CC-210)                      | 30 or more accounts active in that hour slot, two weeks running | A turn-based "arena week" with friends, or nothing |
| Circle weekly board and arena                       | 6 or more members active in that circle that week               | The circle's shared goal only                      |
| Leagues (CC-141)                                    | 250 or more weekly accounts (10 groups of 25)                   | A personal weekly goal                             |
| Season rank (CC-055)                                | Same as leagues                                                 | The free season track only                         |
| Spectating (CC-056)                                 | 100 or more rated chess games at the same time                  | Nothing                                            |

- **Consequences.** Crowd features can be built before the crowd exists and stay hidden. The owner dashboard
  (CC-177) shows each gate and its measured value. The admin console (CC-059) can replace the flag table later.

### ADR-028 — Social graph and minors: friends first, circles second, follow last and adults only

- **Status:** Accepted · 2026-10-17 ([PRODUCT_VISION.md](PRODUCT_VISION.md) §6.8 and §6.10, decision D13)
- **Context.** Retention comes from people you know, and many players may be children. India's DPDP Act bars
  tracking and behavioural monitoring of under 18s, and an open social graph exposes children to strangers.
- **Decision.**
  1. **Unknown age means minor.** Guests and accounts without a stated birth year get the under 18 defaults
     (CC-152). The defaults ship before any social feature.
  2. **Friends (mutual) come first, in Stage 2:** presence for friends only, direct challenge, turn-based games,
     head to head records and a friends filter on leaderboards (CC-139, CC-052, CC-140). Duo Streaks follow in
     Stage 3 (CC-213).
  3. **Circles come second, in Stage 2** (CC-214, replacing CC-068 clubs). A circle is a private group of 2 to 50,
     created and joined by a link that works well in WhatsApp. It has a circle board and a shared goal, with an
     arena behind its gate (ADR-029). There is no public directory of circles.
  4. **Circle safety rules.**
     1. Circle names pass the name filter (ADR-022) and can be reported.
     2. Owners can invite, remove and rename. Owners cannot see members' private profiles or message anyone.
     3. A circle with any minor or unknown age member is a safe circle: members see only display names and
        avatars, emotes are off, and the circle board shows a minor as "Player 4" to anyone who is not already
        their friend.
     4. A minor cannot own a circle of more than 10 people.
     5. Teacher circles (Stage 3) use class codes and collect no student contact details.
  5. **Follow (one way) comes last, in Stage 3, for adults only.** It is opt in per profile and private profiles are
     allowed. Nobody can follow a minor or an unknown age account. CC-206 is cut down to a friends and circles feed,
     and public follow is added only if top adult players ask for it.
  6. Players talk through emotes and challenges, never free text or voice. Emotes are off for minors and guests
     (CC-169).
  7. Share cards never carry a minor's or a guest's username. A minor's card shows the avatar and "a ClassiCade
     player".
  8. Prerequisites, in order: public profile and avatars (CC-034), block, mute and report (CC-044), age signal and
     defaults (CC-152), then challenges, then friends, then circles.
  9. A verifiable parental consent step ships before 13 May 2027, when the remaining DPDP provisions apply.
- **Consequences.** Social features wait for CC-152 and CC-044. Kabir (a minor chess player) is served safely but
  is not a primary persona. The lawyer's review checks these rules against the DPDP Act.

### ADR-027 — Ratings: chess only, Glicko-2, never reset

- **Status:** Accepted · 2026-10-17 ([PRODUCT_VISION.md](PRODUCT_VISION.md) §6.3, decision D12. Built by CC-042
  and CC-221)
- **Context.** Rock Paper Scissors between people is mostly chance and Tic Tac Toe is solved. A rating on either
  would not measure skill and would break the promise that results are fair.
- **Decision.**
  1. Only chess has a rating, using Glicko-2.
  2. Only rated chess games between two people that count under ADR-021 change it. Bot games never do (ADR-025).
  3. A rating is provisional, shown with a "?", for the first 10 games. It is seeded by a one-tap level pick
     (CC-221).
  4. The result card shows the change with its ± and the profile shows a rating graph.
  5. The chess rating is never reset, like Lichess and Chess.com.
  6. Seasons (CC-055) get a separate season rank that resets at the end of each season. The badge for the best
     rank is kept.
  7. Rock Paper Scissors and Tic Tac Toe get XP, series records and head to head results instead of a rating.
- **Consequences.** Stage 1's "ratings" reads "chess rating". Quick match uses the rating window for chess only.
  Anti-cheat signals (CC-060) matter once the rating carries status. The verdict from ADR-021 is reused.

### ADR-026 — Coin economy: cosmetics and name changes only

- **Status:** Accepted · 2026-10-17 ([PRODUCT_VISION.md](PRODUCT_VISION.md) §6.7, decision D4. Built by CC-142,
  CC-143 and CC-156 in Stage 3)
- **Context.** India's Online Gaming Act 2025 bans online money games, and coins that can be turned into money
  count as stakes. Our promise is "No betting. No cash. Ever."
- **Decision.**
  1. Coins are earned by play only.
  2. Coins are spent on cosmetics and name changes only.
  3. Coins are never cashed out, transferred, traded, wagered, given as prizes or used to buy story levels.
  4. No paid random rewards of any kind.
  5. Streak freezes are free and are not a coin sink: one free freeze a week, earned by playing, and a player holds
     at most 2 (CC-145).
  6. Story mode gives no coins (ADR-024).
  7. The lawyer reviews this decision before any payment ships.
- **Consequences.** ROADMAP.md §5 is updated to match. Coins have fewer sinks, so the analytics watch coins earned
  against coins spent, and more cosmetic sinks are added if balances grow too large.

### ADR-025 — Bot identity and rewards

- **Status:** Accepted · 2026-10-17 ([PRODUCT_VISION.md](PRODUCT_VISION.md) §6.2, decision D5. Built by CC-138,
  CC-150 and CC-225)
- **Context.** A solo visitor needs someone to play, so bots must sit in rooms. Bot games must not become an XP
  machine, and no player may ever be fooled into thinking a bot is a person.
- **Decision.**
  1. Bots have their own identity kind and a character name. Every bot is labelled as a bot before the match
     starts and during it. Bots are never disguised as people.
  2. Bot games never count toward a rating or any leaderboard.
  3. Bot games give XP and quest progress, within the ADR-021 caps. Each character counts as one opponent for the
     10 games per pair per day cap, and bot games count toward the 20 games per player per hour cap.
  4. At most 100 XP a day comes from bot matches. This budget is separate from the 150 XP a day quest cap.
  5. Adaptive difficulty (CC-150) is disclosed. A label says "Rocky plays at your level", changes happen only
     between matches, and settings has an off switch. For minors and unknown ages the level adapts only from the
     last few results in the current session, and no profile is stored.
  6. Rock Paper Scissors characters use commit and reveal (CC-225). Before the player chooses, the server sends a
     SHA-256 hash of the character's throw plus a random salt. After the reveal the client checks the hash and
     shows "Lock checked".
- **Consequences.** The owner dashboard reports bot XP per player per day as a North Star guardrail. Whether
  adaptive difficulty counts as behavioural monitoring under the DPDP Act goes to the lawyer's review.

### ADR-024 — Story mode "ClassiCade Quest"

- **Status:** Accepted · 2026-10-17, amended 2026-10-17 (design in [story/STORY_MODE.md](story/STORY_MODE.md), CC-179; built from CC-187)
- **Decision.** A single player story across three districts (Paper Town, Grid City, The Kingdom) against character
  rivals built on the bots, with tutorials, bosses and 1 to 3 stars per level, scored on the server. The owner's
  decisions:
  1. The mascot is named Bit, everywhere (story mode, the CC-153 mascot, empty states, the 404 page).
  2. Story rewards are cosmetic only (avatars, frames, board themes and skins, badges). Nothing affects play,
     nothing is for sale, and Quest gives no coins.
  3. Story XP counts towards the player's level but not towards the weekly leaderboard. Story matches never count on
     any leaderboard.
- **Amended · 2026-10-17** (accepted [PRODUCT_VISION.md](PRODUCT_VISION.md), decision D3).
  1. Story mode ships first as a **two-district slice**: Paper Town levels 1 to 4 as the tutorial, and The Kingdom
     levels 1 to 4 as the real test. Grid City, the rest of The Kingdom and the finale follow in Stage 3, and only
     after the slice meets the targets M1, M4 and M8. If it misses them, story work stops after the slice.
  2. **Star rules reward reading the character, not luck.** For example "win after Rocky switches habit" or "win
     three rounds in a row once you spot his tell". After each level Bit shows the character's habit, so a loss
     teaches something.
  3. Bit is drawn or finished by a person. The other characters may use AI assisted drafts with human cleanup,
     under the licence and credits rules of CC-230.
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

**Amended · 2026-10-17** (accepted [PRODUCT_VISION.md](PRODUCT_VISION.md), decision D8).

1. The caps stay on one server clock and do not move to the player's local time when days do (ADR-013 amendment),
   because abuse limits need one clock. The vision words them as a rolling 24 hours per pair and the clock hour
   per player. Today the pair cap counts per UTC day, and moving it to a rolling 24 hours is a code change for
   CC-138.
2. Bot rules from ADR-025 apply: each character counts as one opponent for the pair cap, bot games count toward
   the hourly cap, and bot matches give at most 100 XP a day.

### ADR-020 — Game shell: one match layout every game plugs into

- **Status:** Accepted · 2026-10-17 (accepted with [PRODUCT_VISION.md](PRODUCT_VISION.md), decision D2)
- **Where:** [ux/MATCH_EXPERIENCE.md](ux/MATCH_EXPERIENCE.md) §2, from the two-browser match experience audit. Tickets
  CC-157 to CC-178.
- **Decision.** Accepted as designed. All three games move onto the shell in Stage 1, which closes the 6 P0 match
  findings.

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

**Amended · 2026-10-17** (accepted [PRODUCT_VISION.md](PRODUCT_VISION.md), decision D7). Weekly boards, and later
leagues, reset on Monday at 00:00 India time instead of 00:00 UTC. The ISO week key ("2026-W42") stays, worked out
in India time. Revisit if players from other regions grow. Built with CC-146. Until then the code uses UTC.

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

**Amended · 2026-10-17** (accepted [PRODUCT_VISION.md](PRODUCT_VISION.md), decision D6). Daily streaks and daily
quests move from the UTC day to the player's local day (CC-146). The time zone comes from the browser, a player can
change it at most once in 7 days so it cannot be gamed, and India time is used when it is unknown. Until CC-146
ships, days stay in UTC. The anti-farm caps stay on the server clock (ADR-021 amendment).

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

### ADR-005 — Hosting

- **Status:** Accepted · 2026-10-17 (with [PRODUCT_VISION.md](PRODUCT_VISION.md), decision D1, which the owner
  changed: the move to paid hosting is deferred until a trigger is met. CC-028 and CC-227 wait for the triggers)
- **Context.** Needs WebSockets, low cost and simple ops. Production runs on Render's free plan in Oregon with
  MongoDB Atlas M0. The free plan sleeps after 15 minutes without traffic and takes about a minute to wake. M0
  allows 100 reads and writes a second before it throttles. Render has no Indian region, and Singapore is the
  nearest. The vision recommended moving now to an always-on instance in Singapore with paid Atlas in the same
  region. The owner chose to wait, because there are no players yet.
- **Decision.**
  1. Stay on Render free (Oregon) and Atlas M0 for now.
  2. The 10 minute uptime monitor (CC-049) keeps the free instance mostly awake.
  3. Nightly encrypted backups (CC-108) cover data safety.
  4. A "Waking up the arcade" loading screen (CC-232) covers the cold starts that remain.
  5. Switch only when one of these triggers is met:
     1. **Always-on Render** when there are more than about 50 daily players, or telemetry shows real players
        hitting cold starts.
     2. **The Singapore region** when the 95th percentile move latency from India passes the 150 ms target (NFR-3).
        The database moves to the same region at the same time.
     3. **Paid Atlas** (CC-227) when the database passes 300 MB or queries are slow.
  6. Hosting in Mumbai elsewhere (for example Fly.io, or Atlas on AWS Mumbai) is the step after Singapore, if the
     latency measured from India still stays above 150 ms a round trip.
  7. The app stays in a container, so a later move stays cheap.
- **Consequences.** No hosting cost for now. Some first visits may still wait while the instance wakes, so the
  loading screen must say what is happening. The triggers need numbers: daily players, cold start hits, move latency
  from India and database size. Telemetry (CC-045, CC-173 to CC-177) and an India latency check give them. CC-028
  and CC-227 sit at the end of phase 1 and start only when a trigger fires. A region move moves the database too,
  so it needs a runbook in DEPLOYMENT.md first.

### ADR-000 — Server-authoritative game model

- **Status:** Accepted · 2026-10-16
- **Decision:** All game rules, move validation, clocks and results run on the server through a common `GameEngine` interface. Clients send intents and render server state.
- **Consequences:** Fixes SEC-04, SEC-09, BUG-04/06/07 by construction; enables bots, replays, anti-cheat. Requires porting TTT and chess logic to the server.
