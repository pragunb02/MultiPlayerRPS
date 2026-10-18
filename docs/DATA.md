# Data inventory

Every place ClassiCade keeps data, what it holds, whether it is personal data, who can read it, how long it is kept
and how it goes away. Checked against the code on `main` at `61b3bb2` on 2026-10-18 (CC-241). Each row names the
file that shows it, so a reviewer can check it.

**Rule:** a pull request that stores something new, or keeps something for a different time, updates this file and
the privacy page (`apps/web/src/pages/LegalPages/PrivacyPage.jsx`) in the same pull request.

Where this file and the privacy page disagreed, the finding is in [tickets/CC-241.md](tickets/CC-241.md#findings).
F1 to F4, F8 and F9 were fixed in CC-248 to CC-250 (2026-10-18), and
`apps/web/src/pages/LegalPages/privacyFacts.test.jsx` now fails when a sentence it checks here changes and the page
does not.

## How to read it

1. **Personal data** means data about a person who can be identified, directly or through other data we hold.
   **Pseudonymous** means it names a random id rather than a person, but the id leads to a person through other data
   (an account's email, a browser's cookie). Pseudonymous data is still personal data under India's DPDP Act and the
   GDPR.
2. **Player ids.** An account is `user_<24 hex>` (the MongoDB id of its `accounts` document, which also encodes the
   moment it was created). A guest is `guest_<uuid>`. Both are pseudonymous personal data
   (`apps/server/src/models/identity.js`).
3. **Who can read it.** "The owner" means through the MongoDB Atlas console or the database connection string. Anyone
   holding `MONGO_URI` (set in Render) can read every collection. Until CC-105 rotates the credential that leaked in
   git history, that includes whoever has the leaked one. There is no owner console on `main` yet (CC-233, PR #64,
   reads aggregates only).
4. **Backups** hold a copy of every MongoDB collection below for 30 days (see [Backups](#backups)). That is not
   repeated in every row.

## Summary

| Store                                                 | Personal data                                                         | Kept for                                                       | Deleted by                               |
| ----------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| [`accounts`](#accounts)                               | yes: username, email, password hash                                   | for ever                                                       | nothing (no deletion yet, CC-035)        |
| [`users` (legacy, read only)](#users-legacy)          | yes: username, email, bcrypt hash, legacy level                       | for ever                                                       | nothing (the new server never writes it) |
| [Other legacy collections](#other-legacy-collections) | yes, if they still exist: names and choices per room                  | unknown                                                        | nothing                                  |
| [`player_sessions`](#player_sessions)                 | pseudonymous: player id, display name                                 | 30 days after the last visit                                   | MongoDB TTL index, logout                |
| [`rooms`](#rooms)                                     | pseudonymous: ids, names, every move, network hash                    | 30 minutes to 24 hours after the last activity (table below)   | the room sweep, every minute             |
| [`closed_rooms`](#closed_rooms)                       | no                                                                    | 24 hours                                                       | the room sweep                           |
| [`matches`](#matches)                                 | pseudonymous: ids, names, every move with its time                    | for ever                                                       | nothing                                  |
| [`player_progress`](#player_progress)                 | pseudonymous: XP and results                                          | for ever (a guest's stays as a marker after moving)            | nothing                                  |
| [`player_stats`](#player_stats)                       | pseudonymous: results, streaks                                        | for ever (a guest's is removed when it moves to an account)    | the guest transfer                       |
| [`player_achievements`](#player_achievements)         | pseudonymous                                                          | for ever (a guest's move to the account)                       | the guest transfer                       |
| [`player_quests`](#player_quests)                     | pseudonymous                                                          | 8 days after the quest day                                     | MongoDB TTL index, the guest transfer    |
| [`leaderboard_entries`](#leaderboard_entries)         | yes for accounts: username, level, score (public)                     | all time boards for ever, weekly boards 28 days after the week | MongoDB TTL index (weekly only)          |
| [`player_transfers`](#player_transfers)               | pseudonymous: guest id, account id and username                       | for ever                                                       | nothing                                  |
| [`accounts.birthYear`](#accountsbirthyear)            | yes: the year of birth, only if the player gave it (CC-152)           | until the player deletes the account                           | account deletion (CC-035)                |
| [`account_deletions`](#account_deletions)             | pseudonymous: the id of a deleted account                             | 30 days                                                        | MongoDB TTL index                        |
| [`legacy_closures`](#legacy_closures)                 | pseudonymous: the id of a legacy row whose player deleted the account | for ever                                                       | nothing                                  |
| [Server memory](#server-memory)                       | yes: IP addresses (rate limits, connections), keyed hashes            | seconds to 30 days, and never past a restart or deploy         | a restart, pruning                       |
| [`cc.sid` cookie](#the-ccsid-cookie)                  | pseudonymous: a random session id                                     | 30 days after the last response                                | the browser, logout                      |
| [`cc.sound`](#ccsound-in-localstorage)                | no                                                                    | until the browser's site data is cleared                       | the browser                              |
| [Server logs](#server-logs)                           | pseudonymous: player ids, room codes; Render's own lines may hold IPs | Render's plan: 7 days on Hobby, 14 on Pro                      | Render                                   |
| [Backups](#backups)                                   | yes: everything in MongoDB                                            | 30 days                                                        | the bucket's lifecycle rule              |

## MongoDB collections

### `accounts`

`apps/server/src/persistence/accountDao.js`

1. **Holds:** `username` as chosen, `usernameKey` (lower case, unique), `email` (normalised to lower case, unique),
   `passwordHash` (scrypt, `utils/passwordHasher.js`), `createdAt`, `sessionVersion` (counted up by a password change
   or "sign out other devices", CC-116).
2. **Personal data:** yes. The email and the username identify a person.
3. **Who can read it:** the player sees their own username. Other players see the username wherever it is the
   display name (rooms, matches, leaderboards). The email and hash are never sent to any client. The owner.
4. **Kept for:** for ever.
5. **Deleted by:** nothing. There is no delete route or script (account deletion is CC-035).

### `users` (legacy)

`apps/server/src/persistence/legacyUserDao.js`, the schema in `git show c9eb13f^:models/User.js`

1. **Holds:** what the legacy app stored: `username`, `email` (as typed), `password` (bcrypt), `gamesPlayed`,
   `level`. The new server reads only `username`, `email` and `password`, by email, when a login finds no account
   (CC-078). It then creates an account with the same email and a new scrypt hash. Legacy XP is not imported.
2. **Personal data:** yes.
3. **Who can read it:** no client. The owner.
4. **Kept for:** for ever. The legacy document stays after its player moved to an account.
5. **Deleted by:** nothing. The DAO has no write method on purpose, so the new server can never change legacy data.

### Other legacy collections

The legacy app (deleted in CC-029) also wrote these. The new code never reads, writes or deletes them. **Checked by
the owner on 2026-10-18:** all four exist in production (database `GameArena`), next to an empty `book` collection, and
`users` holds 8 legacy players. **Owner decision: they are never deleted** (CC-251); they stay as they are and are part
of every nightly backup.

| Collection                                 | Held (from the legacy models)                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `sessions`                                 | legacy express sessions (connect-mongodb-session, cookie age 1 day)                                 |
| `chessdatas`, `rpsdatas`, `tictactoedatas` | per room: `roomUniqueId`, `player1Name`, `player2Name`, the players' choices, `winner`, `createdAt` |
| `book`                                     | empty; origin unknown                                                                               |

### `player_sessions`

`apps/server/src/persistence/sessionStore.js`, `apps/server/src/service/http/session.js`

1. **Holds:** one document per session, keyed by the random session id: the identity (`kind`, `id`, `displayName`),
   for accounts also `sessionVersion` and `signedInAt`, the cookie settings and `expires`.
2. **Personal data:** pseudonymous.
3. **Who can read it:** the player's own browser reads its identity through `GET /api/session`. The owner.
4. **Kept for:** 30 days after the last visit (`SESSION_TTL_SECONDS`, rolling). The stored expiry is rewritten at most
   once an hour (`touchAfter`), so a document can outlive the cookie by up to an hour. An account's session also
   stops working 90 days after signing in (`SESSION_ABSOLUTE_LIFETIME_MS`) and when the account's session version
   moves on. Such a session is replaced the next time that browser asks. If it never asks again, its document waits
   for the TTL.
5. **Deleted by:** MongoDB's TTL index (`autoRemove: "native"`), logout (`DELETE /api/session` destroys it), and every
   sign-in (a new session id, the old one destroyed).
6. **Not stored:** nothing is stored for a visitor who has not chosen to play (`saveUninitialized: false`).

### `rooms`

`apps/server/src/persistence/roomDao.js`, lifetimes in `apps/server/src/domain/rooms/roomLifetimes.js` (CC-101)

1. **Holds:** the room `code`, `gameId`, `options`, `status`, `hostId`, the seats (`playerId`, `displayName`,
   `connected`), the running game (match id, seed, the engine's full state including hidden choices, and a `log` of
   every move and forfeit with the player id and the time), `result`, `rematch` (who asked, who declined, the name of
   a player who left), `series` (wins per player id), `createdAt`, `lastActivityAt`, `dueAt`, `expiresAt`, and
   `network`.
2. **`network`** is a keyed hash of the host's network address: HMAC-SHA-256, cut to 16 hex characters
   (`apps/server/src/utils/networkKey.js`, CC-107). It lets the server count open rooms per network. The address
   itself is never stored. The key is a random key that the server makes in its memory for each UTC day (CC-249).
   It names new rooms during that day. During the next day it is kept only to count the rooms opened under it, so
   midnight does not double the cap, and at the following midnight it is dropped, by a timer even when nobody opens
   a room. The key is never written anywhere and does not come from `SESSION_SECRET` or any other setting. While it
   is held, the running server could test addresses against it, so the hash is pseudonymous personal data for those
   two days at most. After that, nobody can turn the hash back into an address, not from the database, a backup or
   the server's settings. The name is worked out when the room is created, so a socket kept open past midnight gets
   that day's name. A restart forgets every key, so rooms open from before it stop counting for the cap until they
   close. Rooms stored before CC-249 hold a hash keyed with `SESSION_SECRET`. They keep working, stop counting for
   the cap, and are gone within 24 hours, but backups taken before CC-249 keep them for up to 30 days.
3. **Personal data:** pseudonymous.
4. **Who can read it:** everyone who opens the room's link while it is open gets the room view: every seat's player id
   and display name, the host id, and the game view (seated players see their own view, others the spectator view).
   `network` and hidden game state never leave the server. The owner.
5. **Kept for:**

   | Room state                           | Closes                                           | Constant          |
   | ------------------------------------ | ------------------------------------------------ | ----------------- |
   | Waiting, nobody joins                | 30 minutes after the last activity               | `waitingMs`       |
   | Finished                             | 30 minutes after the game ended (rematch window) | `rematchWindowMs` |
   | Playing, every player away           | 2 hours after the last activity                  | `awayMs`          |
   | Playing, a tab open but nobody moves | 24 hours after the last activity                 | `idleGameMs`      |
   | The last player pressed Leave        | at once                                          |                   |

6. **Deleted by:** the room sweep every minute (`ROOM_SWEEP_INTERVAL_MS` in `server.js`). Closing first marks the
   room as closing, writes a `closed_rooms` record, then deletes the room. A room left marked as closing by a stopped
   process is deleted with the closed records after 24 hours.

### `closed_rooms`

`apps/server/src/persistence/roomDao.js`

1. **Holds:** `code`, `gameId`, `reason` (a `ROOM_CLOSE_REASONS` value) and `closedAt`, so whoever opens an old link
   learns why the room is gone.
2. **Personal data:** no.
3. **Who can read it:** anyone who opens the room's link (the GONE answer). The owner.
4. **Kept for:** 24 hours (`closedRecordMs`).
5. **Deleted by:** the room sweep (`deleteClosedBefore`).

### `matches`

`apps/server/src/persistence/matchDao.js`

1. **Holds:** per finished match: `matchId`, `roomCode`, `gameId`, `options`, `seed`, `players` (`playerId`,
   `displayName`), `log` (every move and forfeit with the player id and the time, the same as the room's), `result`
   (result, winners, reason), `startedAt`, `endedAt`, `schemaVersion`, and `credit` (whom the match does not count
   for and why, CC-095).
2. **Personal data:** pseudonymous. The move times describe how a person played.
3. **Who can read it:** the players of that match (`GET /api/matches`, `GET /api/matches/:matchId`, participants
   only). The owner.
4. **Kept for:** for ever. History, replays of a disputed result (`replayGame`) and progression need it.
5. **Deleted by:** nothing. When a guest signs in, their matches are rewritten under the account's id and username
   (ADR-014), so the guest id disappears from them.

### `player_progress`

`apps/server/src/persistence/progressDao.js`

1. **Holds:** `playerId`, `xp`, `matchesPlayed`, `wins`, `losses`, `draws`, `recentMatchIds` (the last 200, so a match
   is counted once), `mergedFrom` (guests merged into an account), `mergedInto` (on a guest that moved), `updatedAt`.
2. **Personal data:** pseudonymous.
3. **Who can read it:** the player (`GET /api/progress`). The level shows next to the name on leaderboards. The owner.
4. **Kept for:** for ever. A guest's document stays as a marker naming the account after the guest signs in
   (ADR-014), so a late match still reaches the account.
5. **Deleted by:** nothing.

### `player_stats`

`apps/server/src/persistence/statsDao.js`

1. **Holds:** `playerId`, `winsByGame`, `matchesByGame`, `checkmateWins`, `questsCompleted`, `winStreak`,
   `dailyStreak` (with the last UTC day played), `recentKeys`, `mergedFrom`, `updatedAt`, `version`.
2. **Personal data:** pseudonymous. The last day played is behavioural.
3. **Who can read it:** the player (`GET /api/streaks`, achievements). The owner.
4. **Kept for:** for ever. A guest's document is removed when it moves to an account, which rebuilds the account's.
5. **Deleted by:** the guest transfer only (`removeStats`).

### `player_achievements`

`apps/server/src/persistence/achievementDao.js`

1. **Holds:** one document per unlock: `playerId`, `achievementId`, `unlockedAt`, `matchId`.
2. **Personal data:** pseudonymous.
3. **Who can read it:** the player (`GET /api/achievements`). The owner.
4. **Kept for:** for ever. A guest's unlocks move to the account (the earlier time kept) and the guest's are deleted.
5. **Deleted by:** the guest transfer only.

### `player_quests`

`apps/server/src/persistence/questDao.js`, retention in `apps/server/src/data/gamificationAccessor.js`

1. **Holds:** per player and UTC day: the day's quests and their progress, `sweepAt`, `recentKeys`, `expiresAt`,
   `version`.
2. **Personal data:** pseudonymous.
3. **Who can read it:** the player (`GET /api/quests`). The owner.
4. **Kept for:** 8 days after the start of the quest day (`QUEST_RETENTION_MS`).
5. **Deleted by:** MongoDB's TTL index on `expiresAt`. A guest's quest days are deleted when the guest moves to an
   account.

### `leaderboard_entries`

`apps/server/src/persistence/leaderboardDao.js`, retention in `apps/server/src/domain/leaderboards/boards.js`

1. **Holds:** per board, period and account: `playerId`, `displayName`, `level`, `score`, `recentKeys`, `updatedAt`,
   and `expiresAt` on weekly entries. Accounts only, never guests (ADR-015).
2. **Personal data:** yes for accounts. The username, level and score are public.
3. **Who can read it:** everyone, without signing in (`GET /api/leaderboards/:boardId`). Player ids are never sent.
   A signed-in player also gets their own rank. The owner.
4. **Kept for:** all time boards for ever. Weekly boards 28 days after the week ends (`WEEKLY_RETENTION_MS`).
5. **Deleted by:** MongoDB's TTL index on `expiresAt` (weekly entries only).

### `player_transfers`

`apps/server/src/persistence/playerTransferDao.js`

1. **Holds:** one document per guest who signed in: `from` (the guest id), `to` (`kind`, account id, username),
   `status`, `createdAt`, `completedAt`, `carriedOver` (XP, matches played, matches moved).
2. **Personal data:** pseudonymous. It links a guest's history to an account.
3. **Who can read it:** no client (the sign-in answer shows `carriedOver` once). The owner.
4. **Kept for:** for ever, so the move is never done twice (ADR-014).
5. **Deleted by:** nothing.

### `accounts.birthYear`

`apps/server/src/persistence/accountDao.js`, the rule in `packages/shared/src/ages.js` (CC-152)

1. **Holds:** a four digit year on the account, only when the player chose one at sign-up or once in settings. Never
   a date. No field means the age is unknown, which counts as a minor (ADR-028).
2. **Personal data:** yes.
3. **Who can read it:** the player (`GET /api/account`, the data export). It decides whether the username shows on
   the public leaderboards: only adults' names show, everyone else's entry reads "Hidden player" (`hidden: true`),
   worked out each time a board is read. The year itself is never sent to anyone else. The owner.
4. **Kept for:** until the account is deleted.
5. **Deleted by:** account deletion.

### `account_deletions`

`apps/server/src/persistence/accountDeletionDao.js`, rules in `apps/server/src/domain/accounts/playerDataComponent.js`
(CC-035)

1. **Holds:** per deleted account: `playerId`, `requestedAt`, `sweepAgainAt` (until the second sweep) and
   `expiresAt`. No username, no email.
2. **Personal data:** pseudonymous at most. The id leads nowhere once the deletion is done.
3. **Who can read it:** no client. The owner.
4. **Kept for:** 30 days, as long as the backups, so a restore can be followed by the same deletions again
   ([runbooks/backup-restore.md](runbooks/backup-restore.md)). Housekeeping erases each deletion once more 5 minutes
   after it was asked, which finishes one the server could not complete.
5. **Deleted by:** MongoDB's TTL index on `expiresAt`.

### `legacy_closures`

`apps/server/src/persistence/accountDeletionDao.js` (CC-035)

1. **Holds:** `legacyId` (the MongoDB id of a legacy `users` row) and `closedAt`, for each legacy player who deleted
   the account made from their row. No email. The legacy row itself is never written.
2. **Personal data:** pseudonymous. It says that the person behind a legacy row deleted their account.
3. **Who can read it:** no client. The owner.
4. **Kept for:** for ever, as long as the legacy row it closes. A login whose email only matches a closed row fails as
   a wrong password would. Signing up with that email makes a new, empty account.
5. **Deleted by:** nothing. It can go with the legacy `users` collection.

### Deletion and export, store by store (CC-035)

`POST /api/account/delete` and `POST /api/account/export`, both with the password, in
`apps/server/src/domain/accounts/playerDataComponent.js`. This table is what each store does. The rows above still
describe the stores as they were before CC-035 and are brought in line by CC-248.

| Store                                       | Account deletion                                          | In the data export                     |
| ------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| `accounts`                                  | deleted                                                   | username, email, created, birth year   |
| `users` (legacy)                            | untouched, its id goes into `legacy_closures`             | no (read only, not the account's data) |
| `player_sessions`                           | every session of the account deleted                      | no                                     |
| `rooms`                                     | seat handed to a stand-in who leaves, a game is forfeited | no (rooms close within 24 hours)       |
| `matches`                                   | anonymised when another person played, else deleted       | every match, others by name only       |
| `player_progress`                           | deleted, with the guest markers naming the account        | yes                                    |
| `player_stats`                              | deleted                                                   | yes                                    |
| `player_achievements`                       | deleted                                                   | yes                                    |
| `player_quests`                             | deleted                                                   | yes                                    |
| `leaderboard_entries`                       | deleted                                                   | yes, without the player id             |
| `player_transfers`                          | deleted                                                   | yes                                    |
| server memory (login throttle, rate limits) | not reached, forgotten at the next deploy or restart      | no                                     |
| server logs (Render)                        | not reached, ids only, 7 or 14 days                       | no                                     |
| backups                                     | not reached, age out within 30 days                       | no                                     |

1. **Anonymised matches.** A match another person played stays in their history. The deleted player's id is replaced
   everywhere in it by a new random stand-in for that match (`deleted_<uuid>`, named "Deleted player"), so the
   anonymous matches cannot be joined back into one history. A stand-in earns nothing (`models/deletedPlayer.js`).
2. **Rooms.** In every room the player sits in, a new stand-in takes the seat and leaves at once, so a game that ends
   later cannot write the player's data back.

## Server memory

Kept in the server process only. A restart, a deploy or the free plan's sleep forgets all of it. Nothing here is
written to MongoDB, except the network hash, which is also stored in `rooms`.

| What                        | Holds                                                                                                                                                                              | Kept for                                                                         | Code                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| HTTP rate limits            | request counts per IP address (`ip:<address>`, IPv6 grouped by /56) or per session id                                                                                              | the window: 1 minute (API), 15 minutes (auth, guest sessions), 1 hour (sign-ups) | `service/http/rateLimits.js`, `authRoutes.js`, `sessionRoutes.js` |
| Login throttle              | failed logins per email and address, failed logins per email, and the addresses that signed in to each email, up to 10. Only keyed hashes are kept, never the email or the address | failures 15 minutes, known addresses 30 days                                     | `service/http/loginThrottle.js` (CC-117)                          |
| Socket admission            | open connections per session id and per address, an event budget per player id                                                                                                     | while connected, and until the budget refills                                    | `service/realtime/socketAdmission.js`                             |
| Network hash                | today's and yesterday's random keys, and the socket's address key, from which a room's hash is worked out when it is created                                                       | a key until the second UTC midnight after its day, the address while connected   | `utils/networkKey.js`, `realtime/gateway.js`                      |
| Session renewals            | session ids being renewed by their own player                                                                                                                                      | 5 seconds                                                                        | `service/http/session.js`                                         |
| Sign-outs                   | per player id, how often they signed out other devices and which session stayed                                                                                                    | the process's life                                                               | `service/realtime/gateway.js`                                     |
| Requests in flight          | per socket, events still being handled                                                                                                                                             | until answered                                                                   | `service/realtime/connections.js`                                 |
| Background tasks and timers | post-game work (match, progression, gamification, leaderboards), the room sweep (1 minute), game deadlines (1 second), transfer resume (1 minute), the room gauge (1 minute)       | until done                                                                       | `utils/backgroundTasks.js`, `server.js`                           |

Personal data: yes. The HTTP rate limits and socket admission hold IP addresses for minutes, or while a socket is
connected. The login throttle holds no email and no address: its keys are HMAC-SHA-256 hashes with a random key made
when the process starts (CC-250). A known address is kept under the hash of the email and address together, so two
emails that signed in from the same place cannot be linked through it. Nobody can read this memory except through
the server's own behaviour (a refusal or a wait).

## Browser

### The `cc.sid` cookie

`apps/server/src/service/http/session.js`

1. **Holds:** the signed random session id. Nothing else.
2. **Set:** only when the player chooses to play (a guest session or a sign-in). HttpOnly, SameSite Lax, Secure in
   production, max age 30 days, renewed on every response.
3. **Personal data:** pseudonymous.
4. **Deleted by:** the browser at expiry, or logout (the server destroys the session it points to).

### `cc.sound` in localStorage

`apps/web/src/lib/sound/soundPreferences.js` (ADR-018)

1. **Holds:** whether sound is on and the volume.
2. **Personal data:** no. It is never sent to the server.
3. **Deleted by:** clearing the browser's site data.

No other cookie, localStorage, sessionStorage or IndexedDB key is used in `apps/web/src`.

## Server logs

`apps/server/src/utils/logger.js`, `apps/server/src/service/http/requestLogger.js`

1. **Holds:** JSON lines on stdout, which Render collects.
   1. Every HTTP request: request id, method, path (no query string), status, duration, the error code, and only the
      **number** of `X-Forwarded-For` entries, never the addresses.
   2. Events with ids: "guest session created", "account created", "logged in", "password changed", "other sessions
      signed out", "session ended by the server" (player id), every socket line (socket id and player id), room
      lines (room code, game, status, close reason), match lines (match id, game, reason, how many players), "socket
      refused" (error code, whether a cookie was sent), the room gauge, and errors with their stack.
   3. Redacted wherever they appear in a logged object: `password`, `token`, `accessToken`, `refreshToken`,
      `sessionId`, `email`, `secret`, and the cookie, authorization and set-cookie headers.
2. **No IP addresses or emails** are written by the app. Redaction works on keys, so a value inside an error message
   would not be caught (finding F10 in the ticket).
3. **Render's own request logs** sit beside ours. Render's documentation lists method, status code, URL, host, path
   and request id, and does not say whether the client IP is included. **Owner check:** a request line in Render,
   Logs.
4. **Personal data:** pseudonymous. A path can hold a room code (`/games/chess/rooms/AB2CD3`).
5. **Who can read it:** whoever can open the Render dashboard.
6. **Kept for:** Render's plan: 7 days on Hobby, 14 on Pro (https://render.com/docs/logging, 2026-10-18).
7. **Deleted by:** Render.

## Backups

`.github/workflows/backup.yml`, `scripts/backup/dump-and-encrypt.sh`, [runbooks/backup-restore.md](runbooks/backup-restore.md) (CC-108)

1. **Holds:** a full `mongodump` of the production database every night at 03:17 UTC: every collection above,
   including the legacy ones and the sessions. The dump is streamed into `age` on a GitHub Actions runner, so it is
   encrypted before it touches the disk.
2. **Personal data:** yes.
3. **Who can read it:** only the holder of the age private key (the owner). The bucket provider and GitHub hold only
   encrypted bytes. Until the owner sets the secrets, no backup is made.
4. **Kept for:** 30 days, by the bucket's lifecycle rule. Data deleted from MongoDB stays in the backups for up to 30
   days more.
5. **Deleted by:** the bucket's lifecycle rule.

## Not stored anywhere

1. Raw IP addresses in MongoDB or in our log lines.
2. Emails or addresses in the login throttle's memory. It keeps keyed hashes only (CC-250).
3. Passwords. Only scrypt hashes, and bcrypt hashes in the legacy `users`.
4. Analytics, page views, presses or funnels. There is no telemetry yet (CC-173 to CC-178, the catalogue in
   [analytics/EVENTS.md](analytics/EVENTS.md) is proposed). ADR-034 decided it will be anonymous counts only, first
   party, with an opt out. No third-party analytics.
5. Chat or any free text from players. Display names are the only text a player chooses, and they pass the name
   filter (ADR-022).

## Coming (not on `main` yet)

1. The owner console (CC-233, PR #64): reads `matches`, `player_transfers`, `accounts`, `player_progress`,
   `player_achievements`, `player_stats`, `player_quests` and `leaderboard_entries`, and shows aggregates only, with
   groups under 5 hidden. Its `ADMIN_ACCOUNT_IDS` allowlist decides who sees it.
2. Room event history (CC-242), 30 days.
3. Telemetry (CC-173 to CC-178): raw events 30 days, daily totals 13 months. Catalogue in
   [analytics/EVENTS.md](analytics/EVENTS.md).
4. Error tracking (CC-049): if it uses a third party, that party is a new row here and on the privacy page.
5. Birth year at sign-up (CC-152).
