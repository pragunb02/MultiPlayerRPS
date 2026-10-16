# ClassiCade Roadmap

Written 2026-10-16. Based on a read-only audit of `main` at 9560048 (security, bugs, code quality, product and platform). Every security and bug item below was checked a second time against the code. Ticket IDs start at the next free ID on the board, **CC-105**. CC-101 to CC-104 are already reserved. New finding IDs start at SEC-12, BUG-15 and DEBT-13. New ADRs start at ADR-016.

## 1. Where we are

1. **Live:** the new stack runs at https://nocapgaming.onrender.com (Render free plan, MongoDB Atlas M0). It has three server-authoritative games (Rock Paper Scissors, Tic Tac Toe, Chess with server clocks), guest play that carries over to an account, accounts, XP and levels, 15 achievements, streaks, daily quests, public leaderboards, rematch with a series score, and the arcade visual identity.
2. **Solid:** identity always comes from the server session (HTTP and sockets). The CSRF guard and CSP have no exceptions. Passwords use scrypt with a dummy hash for unknown emails. Socket payloads are validated and the engines check every move. Progression is exactly-once. Logs redact secrets. The layering is enforced by lint, tests cover 100% of lines, and `npm audit` reports 0. No NoSQL injection was found.
3. **Biggest risk 1:** the full MongoDB Atlas username and password are readable in the public git history (commits 1156202 and 7e27cf2). Nothing says they were ever rotated. There are also no database backups, so a wipe would be permanent.
4. **Biggest risk 2:** any anonymous visitor can crash the single instance by flooding it with rooms. Every deploy or restart also wipes all live games.
5. **Biggest risk 3:** rate limits count proxy IPs, not real players. At launch, real players will share small budgets and get "too many attempts".
6. **Biggest risk 4:** a script can farm unlimited wins and XP through instant forfeits, and the leaderboards are public.
7. **Biggest product gap:** you cannot play alone. There are no bots, no quick match, and invite links die after 30 minutes. The production overall leaderboard is empty, which means no account has finished a match on the new stack. Bots come before every social or economy feature.
8. **Process gap:** `main` has no branch protection and Render deploys every commit, even when CI is red.

## 2. Fix now

The list is ordered highest first. "Extend" means reuse the existing ticket and widen its scope.

| #   | Ticket                                      | Item                                                                     | Where                                                                                                                 | Fix                                                                                                                                                                                                                                                                                                    | Size |
| --- | ------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 1   | **CC-105** (new, SEC-12)                    | Leaked Atlas password in the public git history                          | commits 1156202 and 7e27cf2, legacy `db.js` and `index.js`                                                            | **Owner action today.** In Atlas, rotate or delete that user and create a least-privilege `readWrite` user for the app database only. Update `MONGO_URI` in Render. Check the Atlas access logs. Rotation is the fix; rewriting history is optional.                                                   | S    |
| 2   | **CC-107** (new, SEC-13)                    | Room flooding crashes production                                         | `roomComponent.js:138-162`, `gateway.js:12,109`, `inMemoryRoomDao.js` list, `server.js:192-197`                       | At most 3 waiting rooms per player. At most 5 sockets per session and a cap per IP. Rate-limit budget per player, not per socket. A global room ceiling with a "server busy" error. `expireDue` walks a deadline index of PLAYING rooms instead of cloning every room. Add a gauge for the room count. | M    |
| 3   | **CC-106** (new, BUG-15)                    | Per-IP limits key on proxy IPs                                           | `app.js:60` (`trust proxy 1`), limiters in auth, session and leaderboard routes                                       | Log `req.ips` and the XFF, CF-Connecting-IP and True-Client-IP headers once in production. Then set the exact hop count, or key on the trusted header. Pin it with a test that uses a multi-hop chain, and document it in DEPLOYMENT.md.                                                               | S    |
| 4   | **CC-108** (new)                            | No database backups                                                      | Atlas M0                                                                                                              | Nightly GitHub Actions `mongodump --gzip` with a read-only user. Encrypt the dump and upload it to a private bucket with 30-day retention. Never use workflow artifacts, which are public on this repo. Write a restore runbook and rehearse it once. Move to Atlas Flex or M10 before launch.         | M    |
| 5   | **CC-109** (new)                            | Unprotected `main` and repo security settings off                        | GitHub settings, Render Auto-Deploy                                                                                   | Ruleset on `main`: PR required, checks, e2e and docker jobs required, no force-push. Set Render to deploy only after CI checks pass. Add a post-deploy smoke step. Turn on secret scanning, push protection, Dependabot security updates and CodeQL.                                                   | S    |
| 6   | **CC-095** (extend, raise P2 to P0, SEC-19) | Farming wins and XP through instant forfeits                             | `roomComponent.js:213-224`, `progression.js:5`, `leaderboardComponent.js:183-203`, guest merge in `server.js:227-242` | A forfeit before a minimum number of moves or seconds is recorded as "abandoned" and gives no win, XP or quest credit. Daily caps per opponent pair, guests included. A cap on matches per player per hour. Apply the same caps when guest data merges into an account.                                | M    |
| 7   | **CC-101** (extend, in progress)            | Every deploy wipes live games, and BUG-10 is wrongly marked fixed        | `inMemoryRoomDao.js`, `server.js:389-394`, `useRoom.js`, `RoomPage.jsx`                                               | Rooms in MongoDB, as already planned. Also send a "server restarting" event on SIGTERM so players see an honest message instead of "Room not found". Reopen BUG-10.                                                                                                                                    | M    |
| 8   | **CC-036** (extend, raise to P0, BUG-22)    | Games with an idle opponent never end                                    | `roomComponent.js:326-340`, `chessEngine.js:70-71`                                                                    | Turn deadlines through the existing `deadline` and `expire` hooks: an RPS choice timeout, a TTT move timeout, and a 30 s chess first-move abort that records nothing. An idle limit for PLAYING rooms that ends the game as abandoned. Plus the planned reconnect countdown.                           | M    |
| 9   | **CC-111** (new, BUG-16)                    | A database blip loses finished matches                                   | `server.js:89-141`, `backgroundTasks.js:16-22`                                                                        | Keep finished games in a durable `pending_matches` outbox. Housekeeping retries them with backoff, keyed by matchId (every step can already be safely re-run). Flatten the pipeline into named steps. Alert on "background task failed".                                                               | M    |
| 10  | **CC-110** (new, SEC-14)                    | No rate limit on most API reads                                          | `routes.js:38-52`, gamification, match and progress routes                                                            | One limiter for all of `/api`, per session and per IP, about 300 requests a minute, with the standard 429 body. Keep the stricter limits on individual routes.                                                                                                                                         | S    |
| 11  | **CC-113** (new, BUG-18)                    | A guest who signs up after a game cannot rematch                         | `roomComponent.js:368-372` and `:174-176`                                                                             | Transfer seats in FINISHED rooms too (seat, winners, series, `rematch.requestedBy`). A clear "This game is over" error. Test the flow of signing up from the result screen. This blocks a good CC-097.                                                                                                 | S    |
| 12  | **CC-115** (new, BUG-20)                    | Other tabs go dead after signing in or out                               | `SessionProvider.jsx:22-36`, `socket.js:13`                                                                           | Handle the `disconnect` event with reason "io server disconnect", and handle `connect_error`. Re-fetch `/api/session` and reconnect. Sync tabs with BroadcastChannel. Playwright test with two tabs.                                                                                                   | S    |
| 13  | **CC-112** (new, BUG-17)                    | A game starts after the host has left                                    | `roomComponent.js:169-186`                                                                                            | Start only when every seat is connected, otherwise show "Host is away". Leave the waiting room when the room page unmounts.                                                                                                                                                                            | S    |
| 14  | **CC-116** (new, SEC-15)                    | No password change and no "sign out everywhere"                          | `authRoutes.js`, `sessionRoutes.js:70`, `session.js:28,33`                                                            | A `sessionVersion` on each account, checked on every request and socket. `POST /api/auth/password`. "Sign out other devices". A 90-day absolute session lifetime. CC-033's reset also bumps the version.                                                                                               | M    |
| 15  | **CC-114** (new, BUG-19)                    | Logging out on one device empties waiting rooms on all devices           | `server.js:233-235`, `roomComponent.js:349-357`                                                                       | Give up seats only when the player has no other live sockets. This is a regression from CC-085.                                                                                                                                                                                                        | S    |
| 16  | **CC-119** (new, SEC-18)                    | No reserved-name or abuse filter on public usernames                     | `credentials.js:3`, `leaderboardComponent.js:104-118`                                                                 | Case-insensitive reserved list and denylist with simple leetspeak normalisation, in `parseUsername`.                                                                                                                                                                                                   | S    |
| 17  | **CC-117** (new, SEC-16)                    | An attacker can lock a known email out of login                          | `authRoutes.js:78-89`                                                                                                 | Hard block keyed on email plus IP. Only a soft delay per email. A correct password always gets through.                                                                                                                                                                                                | S    |
| 18  | **CC-118** (new, SEC-17)                    | Signup reveals which emails have accounts                                | `accountComponent.js:9,90-92`                                                                                         | Record the trade-off in KNOWN_ISSUES now and lower the signup limit per IP. After CC-033, signup always answers "check your email".                                                                                                                                                                    | M    |
| 19  | **CC-033** (widen)                          | No email verification, so anyone can squat on an email                   | `credentials.js:5`, `accountComponent.js:83-100`                                                                      | Retitle to "Email verification and password reset". Add an `emailVerified` flag. A verified claim can take over an unverified account older than N days. Reset tokens are single-use and hashed.                                                                                                       | M    |
| 20  | **CC-120** (new, BUG-21)                    | The chess clock shows "0:010.0"                                          | `useChessClocks.js:35-42`                                                                                             | Round first, then choose the format. Add a boundary test.                                                                                                                                                                                                                                              | S    |
| 21  | **CC-091** (extend, BUG-23)                 | The comment says the rematch alternates who moves first, but it does not | `roomComponent.js:251-279`                                                                                            | Fix the comment now. Build the `starter` option as planned.                                                                                                                                                                                                                                            | S    |
| 22  | **CC-093** (extend)                         | Toasts and weekly XP missed during a guest sign-in                       | `progressionComponent.js:71-95`, `leaderboardComponent.js:196-199`                                                    | Use `after.playerId` in the update. Add the guest's weekly XP once instead of raising the total to match-only XP.                                                                                                                                                                                      | S    |

CC-035 (account deletion and export), CC-046 (privacy policy) and CC-098 (guest data retention) are confirmed gaps but already ticketed. They are scheduled in Batch 3.

## 3. Recommended order

### Batch 1: Stop the bleeding (weeks 1 to 2)

The tickets are CC-105 (on day one), CC-107, CC-106, CC-109, CC-108, CC-095, CC-110, the CC-101 finish, CC-113, CC-115 and CC-120. Hosting comes in through **CC-028**: resolve ADR-005 by moving to an always-on paid instance (Render Starter, about 7 USD a month) in Singapore, with the Atlas cluster in the same region. Until that move, show a "waking up the arcade" screen. Code quality starts here too, with CC-125 (rule and lint) and sweep PR 1.

**Why first:** an anonymous visitor can crash production today, the database password is public, and there are no backups. Nothing else matters until that is fixed. Anti-farming has to land before the boards gain any players. The move to Singapore removes about 280 ms from every request for an India audience. Without it, the 150 ms move target (NFR-3) is impossible and the 10-second first-match promise breaks on cold starts.

### Batch 2: Someone to play with (weeks 3 to 4)

The tickets are CC-138 (bot identity and ADR-016 bot rewards), CC-039 (TTT bots), CC-038 (RPS bots), CC-036 extended, CC-112, CC-111, then CC-051 (quick match: a human queue grouped by level, with a labelled bot of matching strength after 10 s), CC-049 (observability), the CC-097 finish, CC-099 (reward queue) and sweep PRs 2 and 3.

**Why this order:** nobody has finished a match on the new stack, so every retention feature already built is unreachable for a solo visitor. Bots fix that and also feed quick match. Quick match depends on CC-036, because fair abandonment rules must exist before strangers get paired. CC-099 has to be the single entry point for rewards before coins arrive. Observability turns every silent failure in Batch 1 into an alert.

### Batch 3: Launch readiness, Stage 1 exit (weeks 5 to 6)

The tickets are CC-046 (privacy and terms), CC-035 (deletion and export, built from the same per-collection participants as ADR-014), CC-098, CC-123 (custom domain), CC-033 widened (needs the domain for SPF, DKIM and DMARC), CC-116, CC-119, CC-040 (chess bot: a small JS engine on the server for casual games, Stockfish in the browser for practice), CC-042 (Glicko-2 for chess only, ADR-018), CC-045 (analytics after consent), CC-047 (SEO, real 404s, invite preview cards), CC-048 (accessibility), CC-122 (staging), CC-050 (launch checklist and runbooks) and sweep PRs 4 and 5.

**Why here:** these are the Stage 1 exit criteria (bots for each game, ratings, legal pages, monitoring). Email needs the domain first. Analytics needs consent first. Ratings need anti-farming and abandonment rules first, both done in Batches 1 and 2. Analytics must run before any reward tuning or ML work.

### Batch 4: The social loop (weeks 7 to 8)

The tickets are CC-034 (public profile `/u/:username` and preset SVG avatars), CC-044 (block, mute, report), CC-152 (age signal and under-18 defaults), CC-139 (persistent challenges), CC-052 (friends and presence), CC-140 (friends filter on the boards and head-to-head records), CC-147 (notifications inbox), CC-150 (adaptive bot difficulty), CC-127 and CC-128 (shared contracts and one wiring), and sweep PR 6, which turns the comment rule on everywhere.

**Why this order:** the profile is where every social feature lands. Block and the child-safety defaults must exist before any new way to contact a stranger. Challenges come before friends because a challenge link already works without a friends graph, and it fixes the "invite link died" problem at once. Friends are the strongest retention lever once bots and quick match have given people opponents to befriend.

### After Batch 4, in this order

1. **Economy (Stage 2):** CC-142 (coin ledger, ADR-017), CC-143 (unlocks), CC-145 (streak freeze), CC-144 (daily puzzle), CC-141 (weekly leagues), CC-146 (local-time days).
2. **Chess depth:** CC-102, CC-041, CC-069.
3. **More games:** CC-066, starting with Connect Four, then Ultimate TTT, Dots and Boxes and Checkers, each shipped with a bot. Then CC-057 (Ludo), CC-067 (tournaments) and CC-068 (clubs).
4. **Scale:** CC-061 with its widened scope.
5. **Monetization (Stage 3):** CC-062 and CC-063.

## 4. Feature catalogue

### Play: bots, games, matchmaking, spectating

| ID              | Item                                                                                                                                                                                    | Pri | Size | Depends on                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- | ------------------------------ |
| CC-138          | Bot identity kind and server-side Bot contract `chooseMove({ view, legalMoves, rng, now })`. ADR-016 on bot rewards: reduced XP, no leaderboard wins, quests count within the daily cap | P0  | S    | none                           |
| CC-039          | TTT bots: easy, medium, minimax                                                                                                                                                         | P0  | S    | CC-138                         |
| CC-038          | RPS bots: random and Markov                                                                                                                                                             | P0  | S    | CC-138                         |
| CC-040          | Chess bot: small JS engine on the server, Stockfish WASM in the browser for unrated practice                                                                                            | P1  | M    | CC-138                         |
| CC-036          | Reconnect grace, turn deadlines, chess first-move abort, idle limit for playing rooms, abandon rate per account                                                                         | P0  | M    | none                           |
| CC-112          | Start a game only when every seat is connected                                                                                                                                          | P1  | S    | none                           |
| CC-051          | "Play now" quick match with bot fallback after 10 s                                                                                                                                     | P1  | M    | CC-038, CC-039, CC-040, CC-036 |
| CC-042          | Glicko-2 ratings, chess only (ADR-018). RPS and TTT keep XP and wins                                                                                                                    | P1  | M    | CC-095, CC-036                 |
| CC-102          | Chess experience (already on the board)                                                                                                                                                 | P1  | L    | none                           |
| CC-041          | Chess time controls, draw offer, PGN, replay viewer                                                                                                                                     | P1  | L    | CC-102                         |
| CC-091          | Alternate who moves first in a rematch                                                                                                                                                  | P2  | S    | none                           |
| CC-103 / CC-104 | Sound effects; opponent request popups                                                                                                                                                  | P2  | M    | none                           |
| CC-144          | Daily puzzle: chess mate-in-N from the CC0 Lichess set, TTT "win in 2". Checked on the server, its own streak                                                                           | P2  | M    | CC-099                         |
| CC-066          | More games: Connect Four, Ultimate TTT, Dots and Boxes, Checkers, each with a bot (raise to P2)                                                                                         | P2  | L    | CC-138                         |
| CC-057          | Ludo for 2 to 4 players                                                                                                                                                                 | P3  | L    | CC-036, CC-138                 |
| CC-056          | Spectating                                                                                                                                                                              | P3  | M    | CC-101                         |
| CC-067          | Tournaments                                                                                                                                                                             | P3  | L    | CC-042, CC-052                 |

### Social: friends, following, challenges, invites, presence, notifications

| ID     | Item                                                                                                                      | Pri | Size | Depends on             |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | --- | ---- | ---------------------- |
| CC-034 | Public profile `/u/:username`, preset SVG avatars, privacy toggle, "Challenge" button                                     | P1  | M    | CC-119                 |
| CC-119 | Reserved-name and denylist filter for usernames                                                                           | P1  | S    | none                   |
| CC-044 | Block, mute, report (report queue for CC-059)                                                                             | P1  | M    | none                   |
| CC-152 | Birth year at signup and under-18 defaults                                                                                | P1  | M    | CC-046                 |
| CC-139 | Persistent challenges at `/challenge/:id` (24 h to 7 d), room created when accepted, expired link offers a challenge back | P1  | M    | CC-101                 |
| CC-052 | Mutual friends, "add recent opponent", friend link, presence for friends only (scope reduced to graph and presence)       | P2  | L    | CC-034, CC-044, CC-152 |
| CC-147 | Notifications inbox (challenges, friend requests, streak at risk, league results), then an email digest                   | P2  | M    | CC-052, CC-033         |
| CC-148 | PWA manifest and opt-in web push (VAPID, CSP review)                                                                      | P3  | M    | CC-147                 |
| CC-140 | Friends filter on every board, lifetime head-to-head record per pair                                                      | P2  | M    | CC-052                 |
| CC-043 | Fixed emote set, share result cards made in the browser                                                                   | P2  | M    | CC-044                 |
| CC-149 | Referral rewards (cosmetic plus coins) after the invitee finishes 3 matches, capped, same IP not paid                     | P3  | S    | CC-142, CC-095         |
| CC-068 | Clubs                                                                                                                     | P3  | L    | CC-052                 |

One-way "following" (for streamers) is deliberately left out until there are streamers.

### Progression and economy: coins, rewards, unlocks, cosmetics, seasons

| ID              | Item                                                                                                                                                                    | Pri | Size | Depends on     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- | -------------- |
| CC-095          | Anti-farming: minimum length for forfeits, caps per opponent pair, hourly cap, caps on guest merge                                                                      | P0  | M    | none           |
| CC-099          | Reward queue and one summary card on the result screen                                                                                                                  | P1  | M    | none           |
| CC-097          | "Save your progress" prompts (in progress)                                                                                                                              | P1  | S    | CC-113         |
| CC-093          | Guest carry-over follow-ups (extended)                                                                                                                                  | P2  | S    | none           |
| CC-094          | Backfill from older match history                                                                                                                                       | P2  | M    | CC-130         |
| CC-142          | Soft-coin ledger that only grows (each entry written once, keyed like quests), cached balance, guest transfer participant, admin revoke (ADR-017)                       | P2  | L    | CC-095, CC-099 |
| CC-143          | Unlocks by level, achievement or coins: board themes, piece sets, RPS hand skins, avatar frames, emotes, victory animations, game variants. Base games are never locked | P2  | M    | CC-142         |
| CC-145          | Streak freeze (200 coins, hold at most 2) and a coin bonus for the day's first match                                                                                    | P2  | S    | CC-142         |
| CC-146          | Days in local time (revisit ADR-013). Show the reset time in local time right away                                                                                      | P2  | M    | none           |
| CC-141          | Weekly leagues of 20 to 30 players, Bronze to Legend, top 5 move up, bottom 5 move down                                                                                 | P2  | M    | CC-095, CC-142 |
| CC-055          | Seasons                                                                                                                                                                 | P3  | M    | CC-141         |
| CC-063 / CC-062 | Cosmetics store; Plus subscription                                                                                                                                      | P3  | L    | CC-142, CC-046 |

### AI and ML in the background

| ID     | Item                                                                                                                    | Pri | Size | Depends on     |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | --- | ---- | -------------- |
| CC-038 | RPS Markov bot: learns each player's habits within a match                                                              | P0  | S    | CC-138         |
| CC-150 | Adaptive bot difficulty: a hidden bot level per player that aims for about a 50% win rate                               | P2  | S    | bots           |
| CC-051 | Matchmaking on level, then Glicko, with a window that widens over time. No ML below thousands of daily players          | P1  | M    | bots           |
| CC-060 | Anti-cheat signals: farming heuristics now. Engine comparison for chess later, only on flagged games, as an offline job | P2  | M    | CC-095, CC-045 |
| CC-069 | Post-game analysis with Stockfish in a Web Worker (no server cost)                                                      | P3  | L    | CC-041         |
| CC-151 | Game recommendations, rules first                                                                                       | P3  | S    | CC-045         |

Churn prediction gets no ticket until CC-045 has 3 months of data. Until then, the rule "streak at risk" in CC-147 does that job. There will be no free-text chat, so no toxicity ML is needed.

### Platform and ops

| ID                                             | Item                                                                                                                                                                      | Pri      | Size   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| CC-105, CC-106, CC-107, CC-108, CC-109, CC-110 | Fix-now security and platform items (section 2)                                                                                                                           | P0 to P1 | S to M |
| CC-028                                         | Resolve ADR-005: always-on paid instance in Singapore, Atlas in the same region (scope reduced to production hosting)                                                     | P0       | S      |
| CC-122                                         | Staging environment with its own Atlas cluster and secrets, persona e2e suite after each deploy (split from CC-028)                                                       | P1       | M      |
| CC-123                                         | Custom brand domain, 301 redirect from onrender, update ALLOWED_ORIGINS                                                                                                   | P1       | S      |
| CC-049                                         | Sentry for server and browser, log sink with alerts, uptime monitor, gauges (sockets, rooms, heap, p95 move ack, 429s, failed connects), Atlas alerts, hidden source maps | P1       | M      |
| CC-050                                         | Launch checklist, incident runbooks, status page, support email                                                                                                           | P1       | S      |
| CC-033, CC-116, CC-117, CC-118                 | Email verification and reset, session revocation, lockout fix, enumeration                                                                                                | P1 to P2 | S to M |
| CC-046, CC-035, CC-098                         | Legal pages, deletion and export, guest data retention, legacy collections dropped, storage alert at 70%                                                                  | P1       | M      |
| CC-045                                         | About 15 analytics events kept on the server, weekly retention query                                                                                                      | P1       | M      |
| CC-047                                         | robots.txt, sitemap, real 404s, per-route titles, OG cards, server-rendered head for invite links                                                                         | P1       | M      |
| CC-048                                         | Route announcer, axe gate in e2e                                                                                                                                          | P1       | M      |
| CC-059                                         | Admin console and feature flags (rename, hide, revoke)                                                                                                                    | P2       | L      |
| CC-061                                         | Redis rooms plus adapter, pub/sub for domain events, a lock so only one instance runs housekeeping, Redis rate-limit store (widened)                                      | P2       | L      |
| CC-135                                         | Lazy-load routes, bundle-size budget                                                                                                                                      | P3       | S      |
| CC-136                                         | `createIndexes` at boot, index drops as explicit migrations                                                                                                               | P3       | S      |

### Quality

| ID     | Item                                                                                                                                                                                  | Pri | Size |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| CC-125 | Comment rule in ENGINEERING.md, `classicade/comment-style` lint rule, CSS check, script proving a PR changes comments only                                                            | P1  | S    |
| CC-126 | Comment sweep in 6 PRs: punctuation, jargon, ticket IDs used as explanations, descriptions inside JSDoc braces                                                                        | P1  | M    |
| CC-111 | Match pipeline as flat named steps (with the outbox)                                                                                                                                  | P1  | M    |
| CC-127 | Shared contracts: `MATCH_RESULTS`, `END_REASONS`, `ROOM_CLOSE_REASONS`, `ROOM_LOG_KINDS`, `XP_SOURCES`, an explicit quest `kind` in the payload, one `resultFor`, one `viewerOutcome` | P2  | S    |
| CC-128 | One `wireDomain` used by both `server.js` and `testApp.js`                                                                                                                            | P2  | M    |
| CC-131 | Split `roomComponent`, `server.js`, `ChessBoard` and `RoomPage` (alongside CC-102)                                                                                                    | P2  | M    |
| CC-132 | `RoomView` typedef, no `any`, `Function` or loose `object`, `tsc --noEmit --checkJs` in CI (amend ADR-001)                                                                            | P2  | M    |
| CC-129 | One `useAsyncData` behind every data hook, one test per hook                                                                                                                          | P2  | M    |
| CC-130 | Shared helpers: `isDuplicateKey`, `retryOnConflict`, one time module, one match history iterator                                                                                      | P3  | S    |
| CC-133 | `curly` and `id-length` lint rules, `assertFunction` convention, 9 missing JSDoc blocks, delete dead `unauthorized`, pin `questsFor` output                                           | P3  | S    |
| CC-134 | Split the large integration test and the aggregate web test files                                                                                                                     | P3  | M    |
| CC-137 | PROGRESS.md: remove the stale next-ID field, derive stage counts from the board                                                                                                       | P2  | S    |

## 5. Economy design

1. **One soft currency: coins.** There is no paid currency before Stage 3. Coins are earned only by playing, never bought at first, never cashed out, traded or gifted. Gifting is a route for fraud.
2. **Where coins come from.** Every payment is a ledger entry written exactly once, and each day has a cap.
   1. First completed match of the day: +20.
   2. Human match: +5 for a win, +2 for a draw or a loss.
   3. Bot match: +2, at most 10 a day.
   4. Quest: +10 to 25. Daily sweep: +20.
   5. Puzzle: +10. Level-up: +50.
   6. Achievement: +25 to 200 by tier.
   7. League finish: +50 to 500. Referral: +200 each.
   8. An active day earns about 60 to 100 coins.
3. **Where coins go.**
   1. Board themes cost 300 to 800 and piece sets 500 to 1500.
   2. Avatar frames, emote packs and victory animations.
   3. Streak freeze costs 200, and a player can hold at most 2.
   4. A name change after the first free one costs 500.
   5. Early access to a variant before its level unlock.
4. **Never pay-to-win.**
   1. Coins never buy rating, rating protection, hints in rated games or XP boosts in ranked play.
   2. Base games are never locked, and nothing reached from an invite link is ever locked.
   3. No paid random boxes, because of gambling law and child players.
   4. Every item gated by level stays earnable for free.
   5. Plus (CC-062) may add a cosmetic bonus or a monthly coin stipend, never power.
5. **Abuse.**
   1. Caps per opponent pair (CC-095) apply to coins as well.
   2. Matches below the minimum length pay nothing.
   3. Guest coins move to the account through a transfer participant.
   4. Admins can revoke coins (CC-059).
   5. Analytics watches coins earned against coins spent, and more sinks are added if balances inflate.

## 6. Social design

1. **Identity:** a public `/u/:username` with level, rank badge, achievements, wins per game and a Challenge button. Preset SVG avatars only, so there are no uploads to moderate. A toggle hides match history.
2. **Friends:** mutual request and accept, capped at about 200. Friends come from "Add friend" on the result screen and in match history, from profiles, and from a friend link. Block overrides everything: no challenges, no requests, no pairing, and presence is hidden in both directions.
3. **Presence:** online, in a game of X, or offline, worked out from socket connections. Only friends can see it, players can opt out, and it is off by default for under-18s.
4. **Challenges and asking friends to play:**
   1. A challenge is stored in MongoDB at `/challenge/:id` and lasts 24 h to 7 d. It can be addressed to one friend or be an open link.
   2. Its states are pending, accepted, declined and expired. A player can have at most 10 pending.
   3. The room is created when the challenge is accepted, so the link survives deploys.
   4. "Looking for a game" pings online friends with a toast, and falls back to the share sheet.
5. **Notifications:**
   1. The in-app inbox comes first. Opt-in web push follows, then an email digest.
   2. Every type has quiet hours, a rate limit and one-tap unsubscribe.
   3. Nothing is ever sent to a player who blocked the sender.
6. **Competing with friends:**
   1. A friends filter on every board.
   2. Lifetime head-to-head records, for example "You lead Riya 7 to 5".
   3. Weekly leagues, then clubs and tournaments.
7. **Safety:**
   1. Communication is emote-only. There is no free-text chat.
   2. Reports go to the admin queue.
   3. Under-18 defaults: friends only by mutual request, no presence, no push.
   4. CC-046 and CC-035 ship before friends go live.

## 7. Code quality

### Proposed rule: docs/ENGINEERING.md §3, new item 14

> **14. Comments are for people.** Write a comment where the code cannot speak for itself: a business rule, a decision that is not obvious, or an order that matters. Say why, not what. Write in plain words for a new teammate who knows JavaScript but not this codebase. Avoid jargon and shorthand such as idempotent, upsert, observer pattern, e.g., i.e., and arrows in prose. Say what happens instead, for example "running it twice changes nothing". Use short sentences that end with a full stop. Do not use semicolons. Do not use dashes as punctuation (a spaced hyphen, a double hyphen, an en dash or an em dash). Use a full stop, comma, colon or brackets instead. Hyphens inside a word are fine (best-of-3, read-only, CC-089). Write lists as numbered items or as separate sentences, not as hyphen bullets. Anything inside backticks is code and is exempt. Put a ticket or ADR ID at the end in brackets only when the reader needs the background, and never as the only explanation, for example "(see ADR-014)". Every exported function, hook and component has a JSDoc block. Parameter descriptions go after the type, never inside the braces. Checked by `npm run lint` (rule `classicade/comment-style`).

The rule is enforced by a local ESLint rule in `eslint.config.js`. It reads every comment, skips lint and Prettier directives, removes code spans, JSDoc types and URLs, and then reports semicolons, en and em dashes, spaced hyphens, double hyphens, hyphen bullets and the denylisted words. It has no autofix, because rewording needs a person. `scripts/check-comments.mjs` runs the same check over CSS and is part of `npm run lint`. The sweep is recorded as DEBT-13.

### Measured violations

The counts come from real comment parsing, not text search, and lint is clean today (0 errors, 0 warnings).

1. **apps/ and packages/:** 958 comments in 334 files (677 are JSDoc). **246 break the rule (25.7%)**, spread over 144 files (43%).
   1. 159 contain a semicolon.
   2. 113 contain an en or em dash.
   3. 5 contain a spaced hyphen or a hyphen bullet.
   4. 41 of the 246 are in test files (24 of 119 test files).
2. **Including e2e/:** 1044 comments, 260 breaking the rule, in 151 files.
3. **CSS:** 4 of 74 comment lines break the rule.
4. **Worst files:** `roomComponent.js` (8 of 25), `progressDao.js` (7 of 17), `server.js` (6 of 19), `progressAccessor.js` (5 of 8), `gamificationComponent.js` (5), `leaderboardComponent.js` (5), `events.js` (4), `chessEngine.js` (4).
5. **Jargon and references:**
   1. Ticket or ADR IDs appear in 104 comments (11%).
   2. "e.g.", "i.e." or "etc." appear in 19.
   3. "idempotent", "upsert" or "exactly-once" appear about 60 times.
   4. Descriptions sit inside JSDoc type braces in 5 places.
   5. 9 of 225 exports have no JSDoc.
6. **Allowed:** 149 comments use hyphens inside words. There is no commented-out code and no TODO.
7. **Overall:** comment coverage is good. Only 7 functions of 25 or more lines have no comment. The problem is wording and punctuation, not missing comments.

### Sweep plan (CC-125, then CC-126)

1. **PR 1 (CC-125):** the rule text, the lint rule, the CSS check and the comment-only proof script. It also cleans `packages/games` and `packages/shared` (38 comments) and turns the rule on there.
2. **PR 2:** server domain, models and config (50).
3. **PR 3:** server data, persistence, utils and `server.js` (42), including the JSDoc brace fixes in `server.js:252-254` and `app.js:30`.
4. **PR 4:** server service, testing and integration tests (36).
5. **PR 5:** web app, hooks, lib and pages (43).
6. **PR 6:** web components, art, games, testing, CSS and e2e (about 55). It turns the rule on globally.

Each PR is comment-only, which the token-comparison script proves. Each one turns the rule on for the folders it cleaned, so a cleaned area cannot slip back. Merge them between feature merges, and ahead of the CC-102 and CC-131 refactors, to avoid conflicts.

## 8. New tickets

These rows are ready to paste into BACKLOG.md. Afterwards, set **Next free ID: `CC-153`**. Also apply these edits to existing tickets:

1. **CC-095:** raise P2 to P0 and add SEC-19.
2. **CC-036:** raise P1 to P0, extend the scope, add BUG-22.
3. **CC-101:** add the restart notice and reopen BUG-10.
4. **CC-033:** retitle to "Email verification and password reset".
5. **CC-028:** reduce to production hosting (the region choice is part of ADR-005).
6. **CC-052:** reduce to friends graph and presence.
7. **CC-042:** chess only (ADR-018).
8. **CC-061:** widen the scope.
9. **CC-066:** raise to P2.
10. **CC-091:** add BUG-23.
11. **CC-093:** extend.

| ID     | Title                                                                                                                                              | Type     | Pri | Stage | Links                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --- | ----- | ------------------------ |
| CC-105 | Rotate the leaked Atlas credential from git history, least-privilege DB user, check access logs                                                    | security | P0  | S0    | SEC-12                   |
| CC-106 | Rate limits use the real client IP behind Cloudflare and Render (trust proxy hop count or trusted header)                                          | bug      | P0  | S0    | BUG-15                   |
| CC-107 | Room flood: cap waiting rooms per player, sockets per session and IP, rate budget per player, global ceiling, deadline index for the clock tick    | security | P0  | S0    | SEC-13                   |
| CC-108 | Nightly encrypted MongoDB backups to a private bucket, restore runbook and drill                                                                   | infra    | P0  | S0    | NFR-4                    |
| CC-109 | Protect `main` (required PR and checks), Render deploys after CI, post-deploy smoke, secret scanning, push protection, Dependabot security, CodeQL | infra    | P0  | S0    |                          |
| CC-110 | App-wide API rate limit per session and IP                                                                                                         | security | P1  | S0    | SEC-14                   |
| CC-111 | Match pipeline outbox with retries, flat named steps, alert on failure                                                                             | bug      | P1  | S0    | BUG-16, CC-049           |
| CC-112 | Start a game only when every seat is connected, leave waiting rooms on unmount                                                                     | bug      | P1  | S0    | BUG-17, CC-036           |
| CC-113 | Transfer seats in finished rooms on sign-in, "This game is over" error                                                                             | bug      | P1  | S0    | BUG-18, CC-097           |
| CC-114 | Logging out on one device must not give up seats held on other devices                                                                             | bug      | P2  | S0    | BUG-19, CC-085           |
| CC-115 | Recover other tabs after sign-in or sign-out (server disconnect handling, BroadcastChannel)                                                        | bug      | P1  | S0    | BUG-20                   |
| CC-116 | Password change, sign out other devices, session version check, 90-day absolute lifetime                                                           | security | P1  | S1    | SEC-15, CC-033           |
| CC-117 | Login lockout keyed on email plus IP, correct password always passes                                                                               | security | P2  | S1    | SEC-16                   |
| CC-118 | Signup account enumeration: document now, uniform response after email ships                                                                       | security | P2  | S1    | SEC-17, CC-033           |
| CC-119 | Reserved and denylisted usernames                                                                                                                  | security | P1  | S1    | SEC-18, CC-044, CC-059   |
| CC-120 | Chess clock shows "0:010.0" just under 10 seconds                                                                                                  | bug      | P2  | S0    | BUG-21                   |
| CC-121 | (spare, not used)                                                                                                                                  |          |     |       |                          |
| CC-122 | Staging environment with its own Atlas cluster, e2e after each deploy                                                                              | infra    | P1  | S0    | ADR-005, CC-028          |
| CC-123 | Custom brand domain, redirect from onrender, ALLOWED_ORIGINS                                                                                       | infra    | P1  | S1    | CC-033, CC-047           |
| CC-124 | (spare, not used)                                                                                                                                  |          |     |       |                          |
| CC-125 | Comment rule in ENGINEERING.md §3.14, `classicade/comment-style` lint rule, CSS check, comment-only proof script                                   | docs     | P1  | S0    | DEBT-13                  |
| CC-126 | Comment sweep in 6 PRs (punctuation, jargon, IDs used as explanations, JSDoc braces), rule on globally                                             | debt     | P1  | S0    | DEBT-13, CC-125          |
| CC-127 | Shared result, close-reason, log-kind and XP-source constants, one `resultFor`, one `viewerOutcome`, explicit quest kind                           | debt     | P2  | S1    | DEBT-14, ADR-001         |
| CC-128 | One `wireDomain` shared by the server and the test app                                                                                             | debt     | P2  | S1    | DEBT-15                  |
| CC-129 | One `useAsyncData` for every web data hook, a test per hook                                                                                        | debt     | P2  | S1    | DEBT-16                  |
| CC-130 | Shared persistence and time helpers, one match history iterator                                                                                    | debt     | P3  | S1    | DEBT-17, CC-094          |
| CC-131 | Split `roomComponent`, `server.js`, `ChessBoard` and `RoomPage`                                                                                    | debt     | P2  | S1    | DEBT-18, CC-102          |
| CC-132 | `RoomView` typedef, real JSDoc types, `checkJs` in CI                                                                                              | debt     | P2  | S1    | DEBT-19, ADR-001         |
| CC-133 | `curly` and `id-length` rules, `assertFunction` convention, missing JSDoc, dead code, pin `questsFor` output                                       | debt     | P3  | S1    | DEBT-17                  |
| CC-134 | Split the large integration test and the aggregate web test files                                                                                  | test     | P3  | S1    | DEBT-20                  |
| CC-135 | Lazy-load route pages, bundle-size budget in CI                                                                                                    | infra    | P3  | S1    | CC-049                   |
| CC-136 | `createIndexes` at boot instead of `syncIndexes`, index drops as migrations                                                                        | infra    | P3  | S1    |                          |
| CC-137 | PROGRESS.md: remove the stale next-ID field, derive stage counts from the board                                                                    | docs     | P2  | S0    |                          |
| CC-138 | Bot identity kind and Bot contract, bot reward rules                                                                                               | feature  | P0  | S1    | ADR-016, FR-AI-1, CC-038 |
| CC-139 | Persistent challenges at `/challenge/:id` that survive restarts, honest expired-link page                                                          | feature  | P1  | S1    | FR-SOC-3, CC-052, CC-101 |
| CC-140 | Friends filter on leaderboards, lifetime head-to-head records                                                                                      | feature  | P2  | S2    | CC-052                   |
| CC-141 | Weekly leagues (20 to 30 players, tiers, up and down)                                                                                              | feature  | P2  | S2    | CC-055, CC-095           |
| CC-142 | Soft-coin ledger and balance, guest transfer participant                                                                                           | feature  | P2  | S2    | ADR-017, CC-095, CC-099  |
| CC-143 | Unlocks: cosmetics and game variants by level, achievement or coins (never base games)                                                             | feature  | P2  | S2    | CC-142, CC-063           |
| CC-144 | Daily puzzle (chess and TTT) with its own streak                                                                                                   | feature  | P2  | S2    | CC-099                   |
| CC-145 | Streak freeze and a coin bonus for the day's first match                                                                                           | feature  | P2  | S2    | CC-142                   |
| CC-146 | Days in local time, reset time shown in local time                                                                                                 | feature  | P2  | S2    | ADR-013                  |
| CC-147 | Notifications inbox, then an email digest                                                                                                          | feature  | P2  | S2    | CC-052, CC-033           |
| CC-148 | PWA manifest and opt-in web push                                                                                                                   | feature  | P3  | S2    | CC-147                   |
| CC-149 | Referral rewards with abuse caps                                                                                                                   | feature  | P3  | S2    | CC-142, CC-095           |
| CC-150 | Adaptive bot difficulty aiming at a 50% win rate                                                                                                   | feature  | P2  | S2    | CC-038, CC-039, CC-040   |
| CC-151 | Rule-based game recommendations                                                                                                                    | feature  | P3  | S2    | CC-045                   |
| CC-152 | Birth year at signup and under-18 social defaults                                                                                                  | security | P1  | S1    | CC-046, CC-052           |

Findings to add to KNOWN_ISSUES.md:

1. **Security:** SEC-12 to SEC-19.
2. **Bugs:** BUG-15 to BUG-23, and reopen BUG-10 under CC-101.
3. **Debt:** DEBT-13 to DEBT-20.

ADRs to write first:

1. **ADR-016:** bot identity and rewards.
2. **ADR-017:** coin economy.
3. **ADR-018:** ratings only for skill games.
4. **ADR-005 (resolve):** hosting and region.
5. **ADR-013 (revisit):** local-time days.
6. **ADR-001 (amend):** `checkJs` in CI.

CC-121 and CC-124 were left unused when I merged duplicates. Either reassign them or mark them "unused" on the board, because IDs are never reused.

Main open risk: the database password must be rotated in the Atlas console today. I could not check whether the leaked password still works, because I did not try to connect. The Atlas region and network access list are also unverified.

Sources: `/Users/prgbhtn/workplace/volumes/MultiPlayerRPS/docs/BACKLOG.md` (this branch: next free ID CC-105, CC-101 to CC-104 reserved), `docs/KNOWN_ISSUES.md` (highest IDs SEC-11, BUG-14, DEBT-12), `docs/DECISIONS.md` (highest ADR-015).
