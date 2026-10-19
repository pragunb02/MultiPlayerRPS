# Decision Log (ADRs)

Format: each decision gets an ID, status (`Open` · `Accepted` · `Accepted by default (owner may change)` ·
`Superseded`), date, context, decision, consequences. Newest first within each section. IDs are permanent and never
reused; the next free ID is **ADR-054** (ADR-052 is taken by PR #98). A later change to a decision is a dated
**Amended** paragraph under it. "Accepted by default" means the builders chose and the owner has not decided yet;
the owner may change it.

## Open decisions

### ADR-046 — Our own screen in front of Render's cold start page

- **Status:** Open · 2026-10-18 (from [CC-232](tickets/CC-232.md), owner to decide)
- **Context.** On a true cold start the browser first gets Render's own loading page, before our process can send
  any HTML, and Render offers no way to brand it. The "Waking up the arcade" screen (CC-232) shows only once our
  server answers.
- **Options.** (1) Leave it as it is. (2) Serve the web app from static hosting or a CDN (with CC-028 or CC-123), so
  our screen loads at once and waits for the API. (3) A service worker that shows the screen on repeat visits.
- **Recommendation.** Decide with CC-123 (brand domain and CDN). Until then option 1.

### ADR-045 — Keep the previous build's files online after a deploy

- **Status:** Open · 2026-10-17 (from [CC-181](tickets/CC-181.md), owner to decide)
- **Context.** Render builds every deploy from scratch, so a tab opened before a deploy asks for script files that
  no longer exist. Since CC-181 such a tab reloads once instead of showing an error, so nobody is stuck.
- **Options.** (1) Leave it: the reload is enough. (2) Keep the old files for a while (storage for old files, for
  example a bucket or a CDN, and a rule for when to drop them).
- **Recommendation.** Option 1 until a CDN exists (CC-123), then revisit.

### ADR-003 — Database: stay on MongoDB vs move to PostgreSQL

- **Status:** Open
- **Context:** Ratings, leaderboards, friends, payments are relational; matches/moves fit documents.
- **Recommendation:** Stay on MongoDB through Stage 1 (lower migration risk); revisit before Stage 3 payments.

## Accepted decisions

### ADR-053 — Blocks: silent, both ways, only people you played with, and the rules later features follow

- **Status:** Accepted by default (owner may change) · 2026-10-19 ([CC-044](tickets/CC-044.md) research §3.1 and
  the addendum §4, following the plan accepted in ADR-051). Reports are CC-044's second pull request.
- **Context.** Block must exist before any feature that lets a player meet a stranger (ADR-028.8): quick match
  (CC-051) first. Players cannot talk, so blocking is about never being put together again. Every player counts as a
  minor until CC-152, and the repository is public, so nothing may tell a player who blocked them.
- **Decision.**
  1. **A block is silent and works both ways**, for guests and accounts alike. The blocked player is never told.
  2. **Effects.** A blocked pair is never seated together: joining a room where the other sits is refused with
     exactly the full room answer ("This room is full"). A rematch between them is refused with "A rematch is not
     possible now", which gives no reason. A game in progress is not stopped. Quick match (CC-051) never pairs them,
     and every later feature that brings two players together (challenges, friends, presence, invitations, circles)
     checks the same rule through `blockComponent.blockedWith` or `eitherBlocked` before it acts.
  3. **Only people you played with.** The client names the other player by a room code or a match id and a seat,
     never by a player id. The server checks that both sat in that open room or played that stored match. Any
     reference it cannot confirm, including yourself, a computer character or a deleted player, gets the same 404.
  4. **Unblock by the record's own random id**, only by the player who made it, from the profile. The list shows the
     name at the time of the block and the date, never an id.
  5. **At most 500 blocks per player**, the oldest dropped. Blocking and unblocking: 20 per 10 minutes per player and
     100 per 10 minutes per network address.
  6. **Data.** `player_blocks` (`blockId`, `blockerId`, `blockedId`, `blockedName`, `createdAt`), kept until
     unblocked or the account is deleted. Both sides move with a guest who signs in (ADR-014), keeping the name the
     blocker saw. Deletion erases both sides. The export lists only the blocks the player made (ADR-048.2).
  7. **Mute is not stored.** It ships with emotes (CC-169) as "Mute <name>" for that room, in the browser only.
- **Consequences.** CC-051 must call `blockedWith` when it pairs. A blocked player who sees a free seat in a room
  can still guess why they were refused, as on Lichess. That is accepted. A blocked guest who clears their cookies is
  a new guest, which no block can follow.

### ADR-051 — The Social and sharing domain: scope, safety inside it, and the answers to #86

- **Status:** Accepted · 2026-10-19 (owner). Proposed in [domains/SOCIAL_AND_SHARING.md](domains/SOCIAL_AND_SHARING.md),
  PR #97. Two points stay open: the Hinglish share lines and an adult's own name on a share card.
- **Context.** The owner asked for the domains to be defined, Social and sharing first among two. Its tickets were
  spread over the board, some twice (CC-043 beside CC-217 and CC-169, CC-068 beside CC-214), and three questions
  from #86 were still open.
- **Decision.**
  1. **Scope and boundaries** as in the domain file §1 and §2: the line with Match experience is the room, Growth
     measures what Social builds, Accounts owns the age signal that Social reads.
  2. **Safety and moderation live inside this domain** (block, mute, report, the reports queue, the grievance
     contact), not as their own, until there is free text, a second moderator or about 20 reports a week.
  3. **Board moves.** CC-043 and CC-068 are closed as replaced (by CC-217 and CC-169, and by CC-214). CC-149
     (referral rewards) is cut. CC-056 (spectating) moves to Match experience. New tickets CC-277, CC-278 and CC-279.
  4. **Grievance Officer: the owner, by name**, published on the terms and privacy pages, with
     `grievance@<domain>` once CC-123 brings the domain. Until then the contact is GitHub private vulnerability
     reporting (SECURITY.md) besides the in-app report. 24 hours to acknowledge, 15 days to close (IT Rules 2021).
  5. **"Find a person" is shown at every hour**, with the honest "Nobody is free" fallback (CC-051).
  6. **One chess quick match pool, 3+2**, while the crowd is small.
  7. **Minors and friends.** A minor may have friends only by mutual accept, only with people met through a link or
     pass and play, never from quick match, and a minor is never findable by name.
  8. **Challenge again (CC-277).** A minor, or a player whose opponent is a minor, can challenge again only someone
     met in a room joined by a link, never a quick match stranger.
  9. **What a quick match stranger sees:** the chosen, filtered username, with opaque per-room seat ids (CC-253).
  10. **No free text in reports** for now. Revisit with point 2.
- **Still open.** The Hinglish share lines (CC-217, the owner writes them). An adult's own name on their share card
  after CC-152 (recommended: off by default, a choice per share, never the opponent's name).
- **Consequences.** The domain file's ticket list and build order are the plan for these tickets. CC-044 publishes
  the owner's name as Grievance Officer. CC-051 builds one chess pool and no hour limit. CC-052 and CC-278 enforce the
  minors' friend rule.

### ADR-050 — Rewards one beat at a time, outcome moments, Bit and the empty screens

- **Status:** Accepted · 2026-10-18 (owner accepted every recommendation in [CC-099](tickets/CC-099.md),
  [CC-163](tickets/CC-163.md), [CC-153](tickets/CC-153.md) and [CC-259](tickets/CC-259.md), with two choices below)
- **Decision.**
  1. Rewards play one beat at a time from a pure queue in the result card (result, series, XP, level up, up to 3
     achievements, quests, streak, save progress, summary), automatically, tap or key to skip, capped at 6 s. One
     effect on screen at a time; confetti only for a real win; at most 3 sounds (result, level up, one chime), XP
     silent; no reward toasts on the room page while the result shows; under reduced motion the summary shows at
     once. The server adds `matchId` to achievement and quest updates.
  2. Outcome moments: four tones (win, quiet win for forfeit, idle or claim with no confetti, gentle loss, even);
     kind loss lines (at most 8 words, no "!", no shaming), no red, no shake, no flashing.
  3. Bit, the mascot: **a placeholder SVG in our own style for now** (owner), swapped for an artist's version later
     under a written copyright assignment; never AI drafts for Bit; outside art only under CC0, CC BY 4.0 or MIT,
     every asset credited in `docs/CREDITS.md` with a test (CC-230). After a loss Bit is "thinking" with a tip.
  4. Page transitions use the browser's View Transitions through React Router (no added bundle); ADR-016 noted.
  5. Win cards are made in the browser now; guests and minors get an unnamed card.
  6. Empty screens (CC-259) first: grid and card CSS fixes, a visitor profile preview, a "how to get on the board"
     panel, a lobby "how to play" strip, and **on phones a one-row header with Log in and Sign up both in a menu**
     (owner).
  7. Order: CC-259 and CC-163 first, CC-099 after #67 (inside today's result section if CC-157 is not ready),
     CC-153 in eight PRs.

### ADR-049 — The game shell, the series scoreboard and the match layout

- **Status:** Accepted · 2026-10-18 (owner accepted every recommendation in [CC-157](tickets/CC-157.md),
  [CC-161](tickets/CC-161.md) and [CC-172](tickets/CC-172.md))
- **Decision.**
  1. CC-157 starts after #67 merges. Order: CC-157, CC-161, CC-172, then CC-166, CC-167, CC-168 move each game onto
     the shell.
  2. One `MatchShell` with slots (request banner, match bar, presence, board, side panel, action bar, result,
     announcer). Games plug in through optional fields on the existing `GAME_VIEWS` registry; game actions are data
     the shell renders, and the shell's confirm dialog replaces per-game ones (chess resign).
  3. Shell animations use CSS keyframes, not Motion, so the RPS and Tic-Tac-Toe downloads stay small.
  4. Series history is stored with the room (`series.history`, the last 20 games, oldest first). Amends ADR-015
     point 7; DATA.md gets the field. The score counts wins, draws are half dots with no "½" in the numbers, and it
     shows from game 1. For RPS the series counts matches; rounds are a second line. Head-to-head across rooms is
     out of scope.
  5. Layout: the match frame uses `svh` (with `vh` fallback) and a board sized by container queries; desktop puts
     presence, clocks and moves in a side column; phones get a compact match header, the request banner takes the
     match bar's row while open, and the result is a non-blocking bottom sheet. 360x800 is added as a design and
     test viewport, `viewport-fit=cover` with safe-area padding everywhere.

### ADR-048 — Account deletion, data export and the age signal

- **Status:** Accepted · 2026-10-18 by the owner, all points, including hiding every existing name on the public
  boards until its owner sets a birth year ([CC-035](tickets/CC-035.md), [CC-152](tickets/CC-152.md)).
- **Context.** Players must be able to leave and take their data with them (FR-ACC-7, the app stores, the DPDP Act
  from 13 May 2027, the GDPR). ADR-028.1 says unknown age means minor, and the public leaderboards showed every
  account's username to anyone. The research, with sources, is in the two tickets.
- **Decision.**
  1. **Deletion is immediate**, with the password again and a confirmation that lists what goes and what stays. No
     grace period: we have no confirmed email to warn the player with (CC-033), and a grace period keeps everything
     longer.
  2. **Every store of DATA.md takes part**, as ADR-014 does for guests: each component that stores data by player id
     exposes `erasePlayer` (and `exportPlayer`), and `playerDataComponent` runs them in the order the composition
     root lists them: rooms, the match pipeline's outbox (ADR-047), sessions, matches, progress, gamification,
     leaderboards, guest transfers. Each runs under the account id and then under every guest id the player had
     before signing up: those ids are worked out once, before anything is erased, and kept on the deletion record,
     because a game can be stored under a guest id after its history moved. The player's sockets are
     cut as soon as the account itself is closed, before the stores are erased, so no device plays on under it.
  3. **Shared matches are anonymised, not deleted.** The opponent keeps the game. The deleted player's id becomes a
     new random stand-in for each match (`deleted_<uuid>`, "Deleted player"), and the guest id the fair play credit
     may name (`withdrawnFrom`) is dropped, so nothing joins the anonymous matches back together. A match read
     before its verdict is only replaced while it still has none, so the opponent's verdict is never lost. A match no other
     person played is deleted. In open rooms a stand-in takes the seat and leaves, so a running game is forfeited to the opponent. A
     stand-in earns nothing.
  4. **The legacy row stays read only and is closed.** Its id goes into `legacy_closures`, so the old password cannot
     make the account again. The email can sign up afresh.
  5. **A record of each deletion is kept 30 days** (`account_deletions`: the player id and times only), the same as
     the backups. Housekeeping erases each deletion again every 5 minutes for 30 minutes, longer than the match
     pipeline's retries (about 13 minutes), so a game that was ending at that moment cannot write the player back.
     A restore uses the records to delete those accounts again. If erasing fails halfway, the account is closed all
     the same and the sweeps finish the rest.
  6. **Export needs the password too**, because it carries the email, which no client sees otherwise. Every player
     id anywhere in an exported match becomes "you" or "player-2" and so on. At most 3
     exports given an hour per account, and at most 5 wrong passwords in 15 minutes for export and deletion
     together. Neither limit counts the other's refusals. Other people appear by display name only, never by id.
  7. **Only a year of birth, optional, from a neutral picker** that starts at "I'd rather not say" and lists every
     year back 100 years. No date, no hint at any age.
  8. **Age groups from the year alone.** Adult only when surely 18 (this year minus the birth year is 19 or more).
     Turning 18 this year, a minor, or no year: the minor defaults. Under 13 for the whole year: no account, refused
     in the page before anything is sent and again by the server.
  9. **The year is set once.** A correction goes through the owner, so a minor cannot unlock the adult defaults with
     one click. **The year is stored, not only the group**: a minor becomes an adult on a date the year gives, without
     being asked again, and the parental consent step (ADR-028.9) needs the age. A child's year (under 13) is never
     sent: the sign-up page and the profile both refuse it before any request.
  10. **The default that exists today:** leaderboards show "Hidden player" for every account that is not an adult,
      worked out when the board is read. Every later social feature reads the same age group.
- **Consequences.** On release every existing account is of unknown age, so every name on the public boards is
  hidden until its owner gives a year. Rule 8(3) of the DPDP Rules (a year of processing logs) is for the lawyer's
  review before 13 May 2027. Guests are not covered by deletion (no password): CC-098 removes old guest data.

### ADR-047 — Finished games go through a stored outbox with named steps and retries

- **Status:** Accepted · 2026-10-18 (proposed in [CC-111](tickets/CC-111.md), merged in PR #78)

**Context.** After a game ended, the match was recorded and XP, quests and boards applied in nested background
tasks that ran once (CC-017). A database blip or a crash in between lost the match or its rewards for good (BUG-16).
We run one instance on Atlas M0, and every step can already run twice without counting twice.

**Decision.**

1. Every finished game is added to `pending_matches` (one record per `matchId`) and run through five named steps:
   record match, judge, apply progression, apply gamification, apply leaderboards. Each step declares the steps it
   needs, and a done step is remembered, so a game resumes where it stopped.
2. Delivery is at least once. Exactly once comes from the steps, which already change nothing the second time
   (the idempotent consumer pattern). The leaderboard step now reads the stored match and progress instead of what
   progression just answered, so it is safe to repeat too.
3. A failed attempt waits 2 s, doubling up to 5 minutes, for at most 10 attempts. Then the record is marked failed and
   `match pipeline failed` is logged at error level, the line to alert on.
4. The finished room is the record of a game until its outbox entry exists (the "outbox as a field on the record"
   variant). Before any change to a finished room (a rematch, someone leaving, the room closing) the room component
   adds its game if missing, and refuses the change while it cannot. At startup and every minute, the game of every
   finished room is added if missing too. That covers a crash or a blip between saving the room and adding the
   entry, without a transaction across two collections.
5. Done records expire after 2 days (TTL index), longer than any room lives. Failed records are kept.

**Why not a MongoDB transaction.** It would make the room save and the outbox entry one write, but every room write
would need a session, the integration tests a replica set, and the room DAO already chose single document writes
(ADR-017). For one instance the finished room gives the same guarantee for as long as it can matter.

**Consequences.** About five more small writes per finished game and one indexed query every 5 seconds, far below
M0's 100 operations a second. One new collection with three indexes. A second instance (CC-061) needs a lease in the
record, because today one process keeps the games it is running in memory.

### ADR-044 — Backups: age-encrypted mongodump to an S3-compatible bucket, from GitHub Actions

- **Status:** Accepted · 2026-10-17 (proposed in [CC-108](tickets/CC-108.md), merged in PR #45. Runbook:
  [runbooks/backup-restore.md](runbooks/backup-restore.md))
- **Context.** The repository and its Actions logs and artifacts are public. The database is a free Atlas cluster,
  which has no Atlas backups. We have no servers of our own and want no paid services.
- **Decision.**
  1. The backup runs in GitHub Actions on a nightly schedule. It is free, already trusted with the code, and the
     secrets stay in GitHub.
  2. `mongodump --gzip --archive` is piped into `age`, so there is one file per night and it is never on disk
     unencrypted. A restore uses the standard `mongorestore`.
  3. age, not gpg: one small public key as the secret, no keyring, modern defaults, and a spare key as a second
     recipient. Only the owner's private key decrypts.
  4. Any S3-compatible bucket, chosen by the owner through secrets. Cloudflare R2 is the suggested default (10 GB
     free, no egress fees).
  5. Old backups are removed by the bucket's lifecycle rule, not by the workflow. The workflow's key has no delete
     right, so a leaked key can add junk but cannot wipe the history.
  6. Each run checks the database user's real privileges and refuses to dump with a user that can write.
- **Alternatives.** Atlas cloud backups (paid tier). Encrypted dumps in a private repository (git is a poor store for
  large files, and it is another credential). Actions artifacts (public on this repository). A cron job on Render
  (free instances sleep and have no disk).
- **Consequences.** The owner must keep the private key in two safe places, or every backup is unreadable. If the
  nightly runs stop for 30 days, the lifecycle rule leaves no backup, so failed-run emails must be acted on. The
  Atlas access list must let GitHub's runners in. The job skips until the owner sets its secrets.

### ADR-043 — Uptime monitoring: a GitHub Actions schedule, incidents as GitHub issues

- **Status:** Accepted · 2026-10-17 (proposed in [CC-049](tickets/CC-049.md), merged in PR #45)
- **Decision.** A scheduled workflow checks the site every 10 minutes and can be run by hand. It needs no secrets
  and rides out a cold start (retries with backoff for up to about 90 seconds). It keeps no state of its own: it
  reads whether the previous run failed from that run's "Site is down" step. Two failed checks in a row open an
  issue labelled `incident` (or update the open one), and the issue closes when the site is healthy again. Only
  issues carrying the monitor's hidden marker are ever edited or closed.
- **Alternatives.** An outside free monitor such as UptimeRobot (another account, and incidents would live outside
  the repository). State in the Actions cache or a repository variable (a new cache entry every 10 minutes, or a
  token with admin rights). Failing the run while the site is down (an email every 10 minutes for the whole outage).
- **Consequences.** GitHub's schedule is best effort, often a few minutes late and sometimes skipped. A test pins
  the step name, because renaming it would break the "twice in a row" rule. The pings also keep the free Render
  instance awake (ADR-005). The owner watches the repository's issues to be told of an incident. Error tracking,
  metrics and alerts are still open in CC-049.

### ADR-042 — Head tags and link previews: one page list, written into index.html by the server

- **Status:** Accepted · 2026-10-16 (proposed in [CC-047](tickets/CC-047.md), merged in PR #44)
- **Context.** Crawlers and link-preview bots do not run JavaScript, but the server sent the same HTML for every
  address.
- **Decision.**
  1. Page titles and descriptions live once, in `@classicade/shared` (`describePage`). At boot the server reads the
     built `index.html`, removes its default tags, and writes each page's own tags into every answer. The same list
     decides the status code, so an address the app has no page for is a real 404. The web app renders its tags from
     the same list.
  2. A room preview names the game from the address alone. It never looks the room up, so a preview says nothing
     about whether a room exists or who is in it. Rooms are `noindex` and never in the sitemap, but they are not
     blocked in `robots.txt`, because some preview bots obey it and would then show no preview for an invite.
  3. The site's public address (for canonical links, previews and the sitemap) is the first `ALLOWED_ORIGINS` entry,
     not a new setting. Revisit if the site ever serves several public hosts.
  4. Preview images are PNGs drawn from the app's own art by a script (Vite and the Playwright Chromium the browser
     tests already install), and committed. The production build needs no browser and no image library. A test fails
     if a game has no image or an image has the wrong size.
- **Alternatives.** A server-side rendering framework (a large change for a few tags). A second copy of the texts
  on the server (they would drift apart).
- **Consequences.** `site.js` must agree with the URL shapes in `paths.js` (ADR-011), and a test checks that they
  do. The PNGs are about 300 KB each, which some apps find large; compressing them is a follow-up.

### ADR-041 — Our own small chess engine for the bots; chess.js stays the referee

- **Status:** Accepted · 2026-10-17 (proposed in [CC-040](tickets/CC-040.md), merged in PR #47)
- **Context.** The board title assumed Stockfish. Our levels top out at "Strong", and a bot must be pure and give
  the same moves for the same seed (ADR-040). chess.js is already a dependency, but it lists moves too slowly for a
  search (about 0.5 ms per position).
- **Options.** (1) Stockfish in WebAssembly: far stronger than needed, a large binary, worker plumbing, and not
  deterministic with threads. (2) A search over chess.js: too slow for anything above Beginner. (3) A small board
  and search of our own, checked against chess.js.
- **Decision.** Option 3. About 800 lines (`board.js`, `search.js`) and no new dependency. chess.js remains the
  referee: the chess engine still decides whether every move is legal. Tests prove the bot's board agrees with
  chess.js (published move counts for six positions, legal move lists and check status in over 1,000 random
  positions, and replays of random games).
- **Budgets count positions, not milliseconds**, so a level plays the same on every machine and every replay:
  Club looks at most 3 moves deep and 20,000 positions, Strong at most 8 deep and 60,000 positions. On an Apple M4
  Pro, Strong averages about 140 ms a move and stays under the 300 ms target.
- **Consequences.** Fast enough for three levels with no binary. The strength is limited (no transposition table,
  a simple evaluation). If players want more than Strong, Stockfish can be added later behind the same bot contract
  without touching rooms. Bot moves run on the server's event loop, limited by ADR-025's thinking queue.

### ADR-040 — Bots are pure strategies that see only their own seat's view

- **Status:** Accepted · 2026-10-17 (proposed in [CC-038](tickets/CC-038.md), merged in PR #47. Seated in rooms by
  CC-138, PR #61)
- **Context.** FR-AI-1 asks for a server-side bot with `chooseMove`. Some game states hold secrets: in Rock Paper
  Scissors the state has the opponent's pending choice.
- **Decision.**
  1. A bot's decision is a pure function in `packages/games`, next to the engines and under the same purity lint
     rules: `chooseMove({ view, botId, rng, difficulty, history })`. The server decides when and where a bot plays,
     never how.
  2. Bots get `engine.viewFor(state, botId)`, never the state. A bot cannot cheat, even by accident, and it sees
     exactly what a person's browser sees.
  3. One bot per game with named levels, rather than one bot per level. Levels of one game share code.
  4. A bot answers with a raw move that the engine validates like any other. There is no trusted path for bots.
  5. Determinism comes from the injected random number generator and, for chess, from position budgets instead of
     clocks (ADR-041).
  6. Every bot passes the contract kit: always legal, the same moves for the same seed, never throws over many random
     games, finishes games, and refuses unknown levels.
- **Consequences.** Bots are unit-testable without a server, replayable from a seed and fair by construction. A bot
  that legitimately needs hidden information (none is planned) would need a contract change. How the bots play, in
  plain words: [games/BOTS.md](games/BOTS.md).

### ADR-039 — Working agreement and CI policy

- **Status:** Accepted · 2026-10-17 and 2026-10-18 (owner. The binding text is the working agreement and workflow
  rule 7 in [CLAUDE.md](../CLAUDE.md); this record keeps the reasons)
- **Context.** Many builder agents work at the same time and merging to `main` deploys to production. The browser
  suite grew to 20 to 30 minutes (CC-236), so every merge waited half an hour, and `main` went red twice in one day
  after pairs of PRs that were each green (CC-247, CC-257).
- **Decision.**
  1. **Feature freeze** until every ticket on the board is closed. New ideas go to [IDEAS.md](IDEAS.md), not to the
     board. Only security (P0 by default), testing and bug tickets may be added.
  2. **Research before code** in every ticket, and everything decided goes in this file, never only in chat.
  3. **At most six builders** at once, only on work that shares no files. Builders run lint, format, coverage and
     their own browser tests locally. CI runs the whole browser suite.
  4. **Two reviewers on every PR**, in parallel: a code reviewer and a security reviewer. A third agent, the
     skeptic, tries to refute each finding. Confirmed findings are fixed, or written down with a reason, before the
     merge.
  5. **Required checks:** lint, format, audit, unit and integration tests with coverage gates, and the Docker build.
     Since 2026-10-18 the browser tests still run on every PR and on `main` but are not a required check, until
     CC-236 brings the suite under 6 minutes.
  6. **Every 10th merge, or at once when `main` is red**, merging stops until `main`, browser tests included, is
     green again.
- **Why.** A 30-minute required check made builders queue up and rebase again and again. Six builders keep
  reviews and rebases manageable. The skeptic cuts false findings (in PR #61, 12 findings survived it). The stop
  every 10th merge bounds how long a browser test failure can sit on `main` unnoticed.
- **Consequences.** A merge can break a browser test without being blocked. The 10th-merge stop and the red-`main`
  rule catch it. The browser tests become required again with CC-236.
- **Amended · 2026-10-18 (lesson of CC-247 and CC-257).** Twice in one day two PRs that were each green broke
  `main` together. CC-247: #62 changed the page template's call and #64 still used the old one. CC-257: #74 made
  `SessionProvider` need a `sessionBroadcast` service, and #75's celebration tests built their services without
  it, so 13 tests failed. Branch protection did not require a PR to be up to date with `main`, so a green check
  could be a check against an older `main`. **Rule (owner, 2026-10-18):** branch protection now requires a PR to be
  up to date with `main` for the fast checks, so every PR runs them again on top of the newest `main` before it can
  merge. The cost is that a PR is updated and checked again after every merge ahead of it. Until the setting was on,
  the coordinator re-ran the fast checks against the current `main` before each merge when another PR had merged
  since.
- **Amended · 2026-10-18 (CC-236, owner's rule: faster only by running in parallel).** The Chromium and Firefox
  browser suites each run as four parts on separate machines, plus one job for the restart tests, one at a time.
  The parts are lists of whole spec files balanced by measured CI time (`e2e/shards.js`), not Playwright's
  `--shard`, which splits by test count. A last job per engine keeps the old check name, merges the reports, and
  passes only when every part passed and every test `playwright test --list` finds ran exactly once. Nothing checks
  less: no fake clocks, shorter game timings, retries or skipped tests. Each commit on `main` gets its own CI
  concurrency group (`github.sha`; pull requests keep one group per branch and cancel older runs), so no run on
  `main` is cancelled or replaced by the next merge's and the every-10th-merge stop sees every result. Turning off
  `cancel-in-progress` alone was not enough: a group keeps only its newest waiting run (PR #88 review). The
  cost is more jobs per pull request against the account's 20 runners at once, so parts are added only when the
  measured times call for them.
- **Amended · 2026-10-18 (owner, fast mode, PR #89).** The up-to-date rule above is **not in force** while fast mode
  lasts: branch protection's "require branches to be up to date before merging" (`strict`) is turned off, so a PR
  can merge without being updated onto the newest `main`. In its place the coordinator runs `main`'s checks after
  each merge and fixes a clash at once (CLAUDE.md working agreement rule 6). Builders run only lint, format and the
  tests of the files they touch locally; docs-only PRs merge without review, code PRs get one combined reviewer plus
  the skeptic, and PRs touching auth, sessions, sockets, input validation or personal data keep both reviewers (rule
  8). The strict setting and the full reviews return when the feature phase ends.

- **Amended 2026-10-18 (owner): fast mode ended.** Branch protection requires eight checks with branches up to date: lint/unit/coverage, Docker, the merged browser jobs (Chromium desktop + mobile, Firefox), the backup round trip, actionlint, and CodeQL for JavaScript and for Actions; every PR gets both reviewers and the skeptic again; builders run lint, format, coverage and their own browser tests locally. WebKit stays advisory until its open flakes (CC-273) are fixed.

### ADR-038 — Button feedback: every press answers, waiting says so

- **Status:** Accepted · 2026-10-17 (CC-164, PR #53, merged behaviour. Design in
  [ux/MATCH_EXPERIENCE.md](ux/MATCH_EXPERIENCE.md) §2 ("What the shell provides", item 7) and [ENGINEERING.md](ENGINEERING.md))
- **Decision.** Every control is the app's `Button`, and work that waits for the server goes through `useAction`.
  1. Pressed: a visible press within 100 ms and the click sound.
  2. Waiting: a spinner and "Sending…", the button keeps its width, `aria-busy` is set.
  3. Done: the change itself, or a check mark with a word such as "Copied" for 600 ms.
  4. Cannot act: `aria-disabled` with a reason shown on hover, focus and press, never a silent `disabled`.
  5. Failed: the reason under the button, with Retry only for network, timeout and server errors.
  6. Every control has a stable `data-cc-control` name, and the browser tests press each one in every state (CC-170).
- **Amended · 2026-10-18** (CC-239, PR #71. **Accepted by default (owner may change); in effect since #71 merged
  on 2026-10-18.** Before that the code showed "Sending…" after 150 ms). "Sending…" appears after 400 ms, above the 250 to
  350 ms round trip from India to the Oregon server, so a normal answer never flashes it. Once shown, it stays at
  least 300 ms. An answer that arrives during that hold is shown when the hold ends, but the action itself resolves
  at once, so pages navigate without waiting. The values follow the Epic Stack's `useDelayedIsPending` (400/300),
  `spin-delay` and Nielsen's response-time limits; sources in the CC-239 ticket file (PR #71).

### ADR-037 — Email identity: one spelling, equal work on every login

- **Status:** Accepted by default (owner may change) · 2026-10-18 · **pending PR #69** (CC-245, CC-238). Nothing
  below is on `main` until #69 merges.
- **Context.** Emails were only trimmed and lower-cased (SEC-21), login time told kinds of email apart (SEC-20), and
  legacy rows stored with spaces or in two cases could be squatted or locked out (SEC-22, BUG-30).
- **Decision.**
  1. **One spelling.** `normaliseEmail` applies NFKC, trim, lower-case and NFKC again. It is the one spelling for
     sign-up, login, the legacy lookup and the login limits (ADR-035). Control and invisible characters (`\p{C}`)
     are refused.
  2. **Gmail dots and plus are not folded.** Folding is right only for some providers, nobody can tell a Google
     Workspace domain from its address, plus addresses are how people keep accounts apart on purpose, and without
     email verification anyone can type any address anyway. Revisit with CC-033.
  3. **Equal login work.** Every login reads the account and legacy stores at the same time and runs exactly one
     scrypt and one bcrypt (cost 10) at the same time, with dummy hashes where a real one is missing, so the time
     taken does not say whether an email has an account.
  4. **Legacy lookup** ignores case and spaces around the stored email and returns every matching row. The login
     checks exactly one: the row in the capitals the player types, otherwise the oldest.
  5. **One message** for every email that cannot be used: "That email can't be used. If it's yours, log in or reset
     your password.", with "log in" linking to `/login` and keeping `next` (CC-238).
  6. **Old spellings heal in place.** At boot the server reads the stored emails outside plain ASCII (accounts and
     legacy rows, email field only) and keeps, in memory, those the one spelling changes, by the spelling they
     become. It logs one line with only the counts: "accounts with non-normal email: N, legacy users with
     non-normal email: M". Login and sign-up look these up too, in the same single read, so such an account still
     logs in and its email is still refused at sign-up through either spelling. At its next successful login the
     account's stored email is rewritten to the one spelling, never onto an email another account already has (that
     case is logged as a warning, without the email). Every path still runs one scrypt and one bcrypt at the same
     time, so the fallback adds no timing difference. No owner check is needed before merging: anything left heals
     at login.
  7. **Production counts, checked by the owner on 2026-10-18:** accounts with a non-normal email 0, legacy users
     with a non-normal email 0, legacy users in total 8. The full scan of `users` at each login costs nothing at
     that size.
- **Known limit.** Legacy case twins: one address gets one account. Once either twin has opened it, the other twin's
  old row can no longer be used, because checking every row would cost one bcrypt per row and bring back the timing
  leak. A twin who is really a different person is helped by hand, and by password reset once CC-033 exists.
- **Consequences.** About 50 to 100 ms more CPU per account login. Every login scans the small, frozen legacy
  `users` collection with a case-insensitive match (it may not get an index, CC-078). SEC-17 (sign-up says an email
  cannot be used) stays open until CC-033 sends email.

### ADR-036 — Owner console: allowlist access, small groups hidden, no new tracking

- **Status:** Accepted · 2026-10-18 (draft in [CC-233](tickets/CC-233.md), merged in PR #64. Owner steps:
  [DEPLOYMENT.md](DEPLOYMENT.md#owner-console-cc-233))
- **Context.** The owner needs to see how the site is played (PRODUCT_VISION.md §7). Accounts have no roles, the
  console must not be visible or even detectable to anyone else, and totals of small groups can point at one person.
- **Decision.**
  1. **Access by allowlist, not roles.** `ADMIN_ACCOUNT_IDS` lists the account ids (`user_…`) that may use the
     console. It is validated at boot (a malformed or guest id stops the boot), and empty means nobody. The server
     checks it on every `/api/admin/*` request and every `/admin` page. Everyone else gets the same 404 as any
     unknown address. `GET /api/session` says `admin: true` only to an admin. Pages and API answer
     `Cache-Control: no-store` and `noindex, nofollow`.
  2. **Small groups hidden.** Any count of 1 to 4 people, and any share or median of fewer than 5, becomes `"<5"` on
     the server and never leaves it. Heatmap cells of 1 to 4 matches are hidden too.
  3. **Differencing accepted.** A total next to its hidden parts could in theory reveal a hidden cell. That is
     accepted because only admins see the console and no id, name, email or room code leaves the database. Revisit
     before any of these numbers is shown to players or shared.
  4. **No new tracking.** The console reads only what gameplay already stores. Reports are cached in memory for 5
     minutes per range, and nothing about who looked is logged.
- **Why not roles.** One owner today, so a role model, an admin table and screens to manage it would be work with no
  user. Changing who is an admin is a setting and a restart. Revisit when moderators (CC-059) need access.
- **Consequences.** Adding an admin is a Render setting change. Telemetry (CC-173 to CC-178) follows ADR-034 and
  rule 2 when its numbers join the console. The per-player read scans every match by design and should move to the
  nightly rollup (CC-176) at about 500,000 matches.

### ADR-035 — Abuse limits: rooms, connections, sign-ups and failed logins

- **Status:** Accepted · 2026-10-17 (CC-107, CC-117, CC-118, merged in PR #57. The values are named rules in
  `domain/rooms/roomLimits.js`, `service/http/loginThrottle.js` and `service/http/authRoutes.js`)
- **Context.** One small free instance serves everyone. Guests cost nothing to make, so a single visitor could open
  rooms and connections until it fell over (SEC-13). The old per-email login limit let anyone lock a known email out
  (SEC-16).
- **Decision.**
  1. **Rooms.** At most 3 waiting rooms per player ("You already have 3 rooms waiting; close one first"), 2000 open
     rooms on the server ("The server is busy, try again in a minute", `SERVER_BUSY`), and 30 open rooms per network.
  2. **Network** means a keyed hash of the rate-limit key (the client address found like Express `req.ip` with
     `TRUST_PROXY_HOPS`). The room stores only that opaque hash, never an address.
  3. **Connections.** At most 5 realtime connections per session and 30 per address. Each player has one budget of
     events shared by all their tabs (bursts of 20, refilled at 10 a second), so more tabs buy no more events.
  4. **Sign-ups.** At most 10 an hour per address, on top of 20 sign-up and login requests per 15 minutes per address.
     Sign-up hashes the password first, so a legacy email and an account email are refused with the same answer
     after the same work.
  5. **Failed logins.** 5 wrong passwords for one email from one address in 15 minutes block that address for that
     email, even with the right password. Other addresses are not affected, so the real player can still sign in
     from home. When one email gets 10 wrong passwords in 15 minutes from all addresses together, addresses that
     have not signed in to it in the last 30 days wait 2 seconds per attempt. Nobody else is refused.
  6. A `room gauge` log line every minute (rooms per status, connections, players).
- **Why these numbers.** Three waiting rooms is one invite each for a few friends. Thirty rooms or connections per
  address is a school computer room. Two thousand rooms is about four thousand players, far above what one small
  instance is sized for.
- **Consequences.** If `TRUST_PROXY_HOPS` is too low, every player behind Render's proxy shares the per-address
  limits ([DEPLOYMENT.md](DEPLOYMENT.md#client-addresses-and-rate-limits)). Login counts live in the process and a restart forgets
  them, so a second instance (CC-061) needs shared counters. Rooms stored before the change have no network and do
  not count. SEC-17 (sign-up says an email cannot be used) is an accepted trade-off until CC-033 sends email.
- **Amended · 2026-10-18** (CC-249, CC-250, [tickets/CC-249.md](tickets/CC-249.md)). The network hash in point 2 is
  keyed with a random key made in memory for each UTC day, no longer with `SESSION_SECRET`. A key names new rooms
  for its day, is kept the next day only to count them (like Plausible's current and previous salt, so midnight does
  not double the cap), and is dropped at the following midnight by a timer. The name is worked out when a room is
  created, not when a socket connects. Once a key is dropped, nobody can turn its hashes back into addresses. A
  restart forgets the keys, so rooms open from before it stop counting for the 30 until they close. The failed login
  counts in point 5 are kept under keyed hashes of the email and address (a random key per process), never the plain
  values. No new env var. A second instance (CC-061) would need a shared key, derived with HKDF from a new secret.

### ADR-034 — Analytics: anonymous counts, India days, player statuses, and the CC-036 time limits

- **Status:** Accepted · 2026-10-18 (owner, answering the open questions in [analytics/EVENTS.md](analytics/EVENTS.md))
- **Context.** CC-244 proposed the event catalogue with open questions. The owner was asked about the analytics
  tier, the definition of an active player, the day boundary, where the opt-out lives, and the CC-036 timings.
- **Decision.**
  1. **Anonymous counts for everyone.** Every event is in the counts tier: no player, session or device id, for
     every player. The adult tier (a keyed hash of the account id) is not built. Revisit only with a lawyer's
     reading of the event list and after CC-152.
  2. **India days.** Daily totals and every "day" in the console follow Asia/Kolkata.
  3. **Opt-out in the browser.** One allowlisted web storage key, `cc.telemetry`, plus Global Privacy Control and
     Do Not Track. Not stored on the account.
  4. **Player statuses instead of one active number.** Worked out each India day from `matches`, for guests and
     accounts alike, with no tracking: New (first game in the last 7 days), Casual (played 1 day of the last 7),
     Regular (2 to 3 days), Core (4 or more days), Returning (played today after 14 or more days away), Lapsing
     (last game 8 to 14 days ago), Dormant (15 or more days). **North Star: Regular plus Core each week.** The
     console shows each status as a weekly trend and how players move between them (CC-255).
  5. **CC-036 time limits.** 60 s before a win can be claimed against a disconnected player, 30 s per Rock Paper
     Scissors throw, 60 s per Tic-Tac-Toe move, 60 s for a first move (otherwise the game is cancelled and nothing
     is recorded).
- **Consequences.** Counts can say how many presses, visits and waits there were, never which person made them,
  so per-person funnels across visits are not possible; the browser works out per-visit sequences itself (rage
  clicks, time to first move) and sends only the result. Retention, cohorts and statuses come from game records,
  which already exist. EVENTS.md becomes Accepted with these answers; CC-173 writes the privacy page wording.
- **Amended 2026-10-18 (CC-255, accepted by default, owner may change).** How point 4 is built, research in
  [CC-255](tickets/CC-255.md). (1) A day of play is an India day with a match that counted under ADR-021, against a
  person or a character. Bots are not players. (2) Days are counted back with today as day 1, so the windows do not
  overlap: last game on day 1 to 7 is active, 8 to 14 Lapsing, 15 or more Dormant. Returning means 14 or more days
  without a game in between (Dormant yesterday). (3) When two fit, New wins, then Dormant, Lapsing, Returning,
  Core, Regular, Casual, so a busy first week counts towards the North Star only from day 8. (4) The weekly trend
  is each status on the week's last day. Returning and turning Dormant are counted over the week ("came back",
  "went dormant"). The Dormant total is not shown, because it needs every match ever. (5) The North Star headline
  is Regular plus Core on the last full week's Sunday against the Sunday before, and the console shows the moves
  between those two days. The 3-day weekly returning players number (PRODUCT_VISION.md 7.1) stays on the
  Overview without the North Star label, and 7.1 needs the owner's rewording (CC-268).

### ADR-033 — Every tab follows the session: server disconnects and a message without identity

- **Status:** Accepted · 2026-10-18 (CC-234, CC-115; research in `docs/tickets/CC-115.md`)
- **Context:** All tabs of a browser share one session cookie, and the server decides who it is. When the session
  changes (signing in, logging out, signed out from another device), the server cuts the affected sockets, and
  Socket.IO does not reconnect after that. Tabs without a socket hear nothing at all. Web storage may hold only
  allowlisted preferences (CC-103).
- **Decision:**
  1. A tab asks `GET /api/session` again when the server ends its socket (`"io server disconnect"`) or refuses its
     handshake with `UNAUTHORIZED`. A network drop or restart is left to Socket.IO's own reconnect.
  2. A tab that signs up, logs in, logs out or starts a guest posts the word `"changed"` on the BroadcastChannel
     `cc.session`. Every other tab of the origin then asks `GET /api/session` again.
  3. The message carries no identity data. A tab takes its identity only from the server's answer.
  4. Nothing is written to web storage, so the `storage` event is not used.
- **Alternatives:** The `storage` event (needs a web storage write that outlives the tab). Polling the session
  (costs a request per tab every few seconds for an event that happens rarely). A server event with the new identity
  over the socket (does not reach tabs without a socket, and puts identity on a channel that does not need it).
- **Consequences:** One extra `GET /api/session` per tab when the session changes. A browser without BroadcastChannel
  (none we support) still recovers its tabs that have a socket.

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

### ADR-030 — Session lifetime and revocation

- **Status:** Accepted · 2026-10-17 (proposed in [CC-116](tickets/CC-116.md), merged in PR #57. The owner decided on
  2026-10-17 that guests have no 90-day limit. The rest is merged behaviour. The rolling 30 days came from CC-096,
  PR #36)
- **Context.** Sessions live in MongoDB (`player_sessions`) and nothing could end one except logging out on that
  device. A stolen session cookie stayed valid for as long as it was used (SEC-15), and a player could neither
  change their password nor sign out a lost phone.
- **Decision.**
  1. **Rolling 30 days for everyone.** Every visit moves the session's end to 30 days later (the stored end is
     rewritten at most once an hour). A session nobody uses for 30 days ends.
  2. **90 days absolute for accounts.** A signed-in session ends 90 days after signing in, however often it is
     used. That bounds a stolen cookie to three months and asks for the password about four times a year. A
     password change starts the 90 days again; signing out other devices does not.
  3. **Guests have no absolute end.** A guest has no password to sign in with again, so ending the session would
     lose their progress. Their rolling 30 days stay.
  4. **Session versions.** Each account has a `sessionVersion`, and a session stores the version it was made at
     and when it signed in. Every `/api` request (after the app-wide rate limit) and every socket handshake checks
     it with one primary-key read. A session whose version is old is replaced by an empty one (the request goes on
     as a visitor) and its sockets are disconnected. A refused handshake answers `UNAUTHORIZED`.
  5. **Password change and "Sign out other devices"** count the version up (password reset will too, CC-033). The
     browser that asked stays signed in under a **new session id** with the new version, so a copy of its old cookie
     stops working. Its sockets stay connected, and every other socket of the account is disconnected.
  6. **5 seconds of grace for the renewing id.** A request from the same browser that is already on its way while
     the version moves on still carries the old id. For 5 seconds such a request passes (`RENEWAL_GRACE_MS`), so the
     browser that asked to stay is not signed out by its own other tab. The old id is destroyed in the store at the
     same moment, so it cannot be used after that.
  7. Sessions and accounts from before this change count as version 0, and their 90 days start when first seen.
- **Alternatives.** Deleting every session of an account from the store (needs an index on the session data, and
  misses sessions being written at that moment). Short-lived tokens with refresh (a new client protocol, for no gain
  on a same-origin app).
- **Consequences.** One small read per signed-in request. Other tabs and devices learn of the change through
  ADR-033. A list of signed-in devices is not built (it needs a session index per account). Ended sessions stay in
  the store until its TTL removes them; they are refused on their next request.

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
     shows the result in plain words, "✓ Fair: Rocky's choice didn't change", with the hashes one press away in
     "How we keep it fair" (worded by CC-254, the check is unchanged).
- **Consequences.** The owner dashboard reports bot XP per player per day as a North Star guardrail. Whether
  adaptive difficulty counts as behavioural monitoring under the DPDP Act goes to the lawyer's review.

**Amended · 2026-10-18** (built by CC-138, CC-221 and CC-225 in PR #61, with the fixes from its review. Merged
behaviour, so Accepted. How the bots play, in plain words: [games/BOTS.md](games/BOTS.md)).

1. **Characters.** Rocky plays Rock Paper Scissors, Pip plays Tic-Tac-Toe and Queen Vee plays chess. Their ids are
   `bot_<character>_<level>` and every level of a character counts as one opponent for the pair cap.
2. **At most 3 games against computers** going per player. Starting a fourth ends the oldest. New games and the
   rematches a computer accepts both count, and the count is taken again after every start, so many starts at once
   cannot pass it (BUG-32).
3. **One computer move is chosen at a time on the whole server**, and after each the server rests as long as the
   search took (`thinkingQueue.js`). Computer players therefore use at most half of the event loop (BUG-33).
4. **100 bot XP a day** (`BOT_DAILY_XP`, per UTC day like the other fair-play caps), stored in the verdict as
   `credit.botXp`. When a guest's computer games move into an account (ADR-014), only what the account has left of
   that day's 100 XP moves; the rest is stored as `withdrawnXp` and taken out before the merge (BUG-36).
5. **`unrankedXp` is kept off every board.** Progress keeps `unrankedXp`: XP from computer games and the quest
   bonuses they earned. Every XP board shows `xp - unrankedXp`, and computer games never move anyone on any
   leaderboard (BUG-35). Computer players themselves get no progress, stats or quests.
6. **The sealed throw.** The seal is SHA-256 of `move JSON:salt`, and the salt is an HMAC of the turn under a
   secret derived from `SESSION_SECRET` (no new setting). A computer move that differs from its seal is refused.
   The browser **remembers the first lock it shows** for each game and turn, and says the round was fair only when
   the reveal's lock is that remembered one, the throw is the one in the round's result and the hash matches. A page
   opened after the lock was shown says it cannot check (BUG-37). Plain wording for players: CC-254.
7. **Behaviour.** A human-like pause of 400 to 900 ms before every action. Computers decline a chess draw offer,
   accept a person's rematch and never ask for one. A room where only computers are still connected closes after
   the 2-hour away lifetime. Plans are made again for every stored room at start-up and every minute, so a restart
   mid-game resumes.
8. **Accepted by default (owner may change):** Rocky offers two levels (Easy, random, and Hard, the pattern reader),
   not three, because the RPS bot has two. The pattern reader sees only the current game of a room, not earlier
   games of the series, until CC-190.

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
- **Amended · 2026-10-17** (owner, PR #52). The owner kept the cookie line of PR #44. Privacy questions go to a
  GitHub issue that says only that it is a privacy request, with no personal details, and the owner replies
  privately. This is replaced by an email address once the owner has one for the site. The policy names the one
  browser setting (`cc.sound`) instead of saying "no browser storage".

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

**Amended · 2026-10-18** (PR #61, merged behaviour). The pair cap now counts **any 24 hours** instead of the UTC
day, as the 2026-10-17 amendment planned. The hourly cap per player still counts the UTC clock hour.

**Open questions from CC-095, accepted by default (owner may change):**

1. When a guest moves into an account, the guest's opponent is not judged again. If Bob played 10 games with guest
   Riya and 10 with account Riya on one day, Riya ends with 10 counted games and Bob keeps 20. Judging Bob again
   would take XP from a player who did nothing wrong.
2. Quest bonus XP a guest earned from games later withdrawn in a merge stays in the totals. The quest was completed
   and paid that day, and it is at most one day's quest bonus.

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

**Amended · 2026-10-18** (owner decision recorded in PR #67, CC-159. **In effect since #67 merged on 2026-10-18**;
the rules above no longer run). Requests come from a server-side `room.requests` list instead of being worked out
from the view. Each request has a type, who asked, who is asked, times and a state (open, accepted, declined,
withdrawn or expired), and the last answer stays for 10 s. A rematch request lasts 60 s and a chess draw offer 30 s,
and both expire through the existing deadline sweep. Only one request of a type is open at a time, asking again
after a no waits 10 s, and each player can offer at most 3 draws a game. Two socket events, `room:request` and
`room:answer`, replace the old rematch events and chess draw actions.

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

**Amended · 2026-10-18** (owner decision recorded in PR #67, CC-208. **In effect since #67 merged**). Point 4:
`cc.sound` stays the one key and gets an extended shape: `muted` and `volume` as before, plus `categories`, an
on or off switch and a volume for each of the six notification categories. Old values without `categories` still
read. The checker in the storage allowlist (`e2e/fixtures.js`) follows the new shape, and no new key is added.

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

**Amended · 2026-10-18** (owner). **Stay on Motion** for all interaction animation.

1. No GSAP, no react-spring, no AutoAnimate, and no canvas-heavy React Bits backgrounds. Each would be a second
   animation system, and full-screen canvas effects drain batteries and stutter on the low-end phones many of our
   players use.
2. Lottie only if a designer makes real After Effects art for the characters (CC-194, CC-230). Not for effects that
   Motion or CSS already do.
3. Video (a "how to play" clip or a trailer) is an idea in [IDEAS.md](IDEAS.md), not part of this decision.

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

### ADR-012 — Visual identity: "neon arcade"

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

#### Where the brief and the repo rules differ

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

### ADR-008 — Dependency policy: latest stable, minimal, zero known vulnerabilities

- **Status:** Accepted · 2026-10-16
- **Decision:** Latest stable releases only (no pre-releases), Node Active LTS, prefer built-ins over packages, `npm audit` 0 high/critical before merge, majors upgraded via their own ticket. Details: [ENGINEERING.md §5](ENGINEERING.md).
- **Consequences:** Replaced nodemon with `node --watch`; upgraded `connect-mongodb-session` 2 → 5; applied same-major legacy updates. Audit went from 31 vulnerabilities (1 critical, 11 high) to 0.

### ADR-007 — Layered server architecture, design patterns and engineering standards

- **Status:** Accepted · 2026-10-16
- **Context:** The legacy server mixed transport, rules and storage in one file, which caused most audit findings. The product must grow (more games, bots, storage changes, new APIs) without rewrites.
- **Decision:** Five layers (service → domain logic → domain data → persistence | dependency) plus shared immutable models and utils, wired in a single composition root. Adjacent, top-down, request/response interactions only — enforced by ESLint and pinned by `architecture.test.js`. Patterns, principles, coding and testing standards in [ENGINEERING.md](ENGINEERING.md).
- **Consequences:** More files per feature, but each change touches one layer; everything is unit-testable with fakes; games/bots/storage are plug-ins (open/closed).

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
- **Checked · 2026-10-18.** Still current, with no change. The uptime monitor (ADR-043) and the "Waking up the
  arcade" screen (CC-232, PR #62) are live, and the nightly backup job (ADR-044) is built and waits for the owner's
  secrets. No trigger has fired. Daily players can now be read in the owner console (ADR-036). Cold-start hits and
  move latency from India still need telemetry (CC-173 to CC-177), so those two triggers cannot be measured yet.

### ADR-004 — Rewrite strategy: new code alongside legacy

- **Status:** Accepted · 2026-10-16
- **Decision:** Build the new structure next to the legacy app, port game by game, delete legacy files once each game reaches parity.
  Legacy app stays runnable throughout. Only security/bug quick-fixes (CC-007..CC-010) touch legacy code.

### ADR-002 — Frontend: React SPA (Vite)

- **Status:** Accepted · 2026-10-16
- **Context:** Current UI is EJS + jQuery with duplicated scripts; target needs a rich realtime, mobile-first UI.
- **Decision:** React, built with Vite, served by the same Node server in production (single deploy). Styling approach decided at CC-022.
- **Consequences:** EJS views are retired as each game is ported. Legacy CSP stays relaxed until the React app replaces inline scripts.

### ADR-001 — Language: JavaScript

- **Status:** Accepted · 2026-10-16
- **Context:** Rewrite of server, game engines and shared event contracts.
- **Decision:** Plain JavaScript (owner's choice). New code uses ES modules. Types and contracts are documented with JSDoc
  (`@typedef`, `@param`) so editors still give autocomplete; event names live in one shared constants module, never as string literals.
- **Consequences:** No build step for the server. Protocol safety comes from shared constants + tests instead of a compiler.

### ADR-000 — Server-authoritative game model

- **Status:** Accepted · 2026-10-16
- **Decision:** All game rules, move validation, clocks and results run on the server through a common `GameEngine` interface. Clients send intents and render server state.
- **Consequences:** Fixes SEC-04, SEC-09, BUG-04/06/07 by construction; enables bots, replays, anti-cheat. Requires porting TTT and chess logic to the server.
