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

| Store                                                 | Personal data                                                                                                     | Kept for                                                                                                | Deleted by                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`accounts`](#accounts)                               | yes: username, email, password hash                                                                               | for ever                                                                                                | nothing (no deletion yet, CC-035)                       |
| [`users` (legacy, read only)](#users-legacy)          | yes: username, email, bcrypt hash, legacy level                                                                   | for ever                                                                                                | nothing (the new server never writes it)                |
| [Other legacy collections](#other-legacy-collections) | yes, if they still exist: names and choices per room                                                              | unknown                                                                                                 | nothing                                                 |
| [`player_sessions`](#player_sessions)                 | pseudonymous: player id, display name                                                                             | 30 days after the last visit                                                                            | MongoDB TTL index, logout                               |
| [`rooms`](#rooms)                                     | pseudonymous: ids, names, every move, network hash                                                                | 30 minutes to 24 hours after the last activity (table below)                                            | the room sweep, every minute                            |
| [`closed_rooms`](#closed_rooms)                       | no                                                                                                                | 24 hours                                                                                                | the room sweep                                          |
| [`matches`](#matches)                                 | pseudonymous: ids, names, every move with its time                                                                | for ever                                                                                                | nothing                                                 |
| [`player_progress`](#player_progress)                 | pseudonymous: XP and results                                                                                      | for ever (a guest's stays as a marker after moving)                                                     | nothing                                                 |
| [`player_stats`](#player_stats)                       | pseudonymous: results, streaks                                                                                    | for ever (a guest's is removed when it moves to an account)                                             | the guest transfer                                      |
| [`player_achievements`](#player_achievements)         | pseudonymous                                                                                                      | for ever (a guest's move to the account)                                                                | the guest transfer                                      |
| [`player_quests`](#player_quests)                     | pseudonymous                                                                                                      | 8 days after the quest day                                                                              | MongoDB TTL index, the guest transfer                   |
| [`leaderboard_entries`](#leaderboard_entries)         | yes for accounts: username, level, score (public). Guests: pseudonymous, the server-given name                    | accounts: all time for ever, weekly 28 days after the week. Guests: 30 days after the last counted game | MongoDB TTL index, the guest transfer, account deletion |
| [`player_transfers`](#player_transfers)               | pseudonymous: guest id, account id and username                                                                   | for ever                                                                                                | nothing                                                 |
| [`player_blocks`](#player_blocks)                     | pseudonymous: both player ids, the blocked player's name then                                                     | until unblocked, or either account is deleted                                                           | unblocking, account deletion                            |
| [`feedback`](#feedback)                               | the message as typed, and a reply email from an adult who gave one                                                | 180 days after it was sent                                                                              | MongoDB TTL index, the owner's Delete in the inbox      |
| [`accounts.birthYear`](#accountsbirthyear)            | yes: the year of birth, only if the player gave it (CC-152)                                                       | until the player deletes the account                                                                    | account deletion (CC-035)                               |
| [`account_deletions`](#account_deletions)             | pseudonymous: the id of a deleted account                                                                         | 30 days                                                                                                 | MongoDB TTL index                                       |
| [`legacy_closures`](#legacy_closures)                 | pseudonymous: the id of a legacy row whose player deleted the account                                             | for ever                                                                                                | nothing                                                 |
| [Server memory](#server-memory)                       | yes: IP addresses (rate limits, connections), keyed hashes                                                        | seconds to 30 days, and never past a restart or deploy                                                  | a restart, pruning                                      |
| [`cc.sid` cookie](#the-ccsid-cookie)                  | pseudonymous: a random session id                                                                                 | 30 days after the last response                                                                         | the browser, logout                                     |
| [`cc.sound`](#ccsound-in-localstorage)                | no                                                                                                                | until the browser's site data is cleared                                                                | the browser                                             |
| [Server logs](#server-logs)                           | pseudonymous: player ids, room codes; Render's own lines may hold IPs                                             | Render's plan: 7 days on Hobby, 14 on Pro                                                               | Render                                                  |
| [Backups](#backups)                                   | yes: everything in MongoDB                                                                                        | 30 days                                                                                                 | the bucket's lifecycle rule                             |
| [Operations telemetry](#operations-telemetry)         | no: counts, timings and the names of warnings, never an id, name, email, IP address, room code, cookie or session | 14 days (Grafana Cloud free tier)                                                                       | Grafana Cloud                                           |

## Identifiers

Every identifier the code makes or keeps, what it gives away, which routes and socket events send it to a client,
and where it is stored. Built for CC-297 on 2026-10-20 by reading every `res.json`, every socket emit and answer, and
every `exportPlayer` in `apps/server/src`, not from a list. "Own" means the player it belongs to.

**Rule:** every new feature checks itself against this table before it ships. A pull request that adds or changes a
response, a socket payload, an export field or a stored identifier updates this table in the same pull request.
**No client ever receives another person's player id.** Another player is named by a keyed id made for that place
(one new label in `apps/server/src/utils/keyedIds.js`, ADR-057) or by display name only, and the feature gets a test
that crawls what it sends for any `guest_` or `user_` id that is not the viewer's own (as
`apps/server/src/service/http/matchHistoryIds.test.js` does for matches).

| Identifier                    | Format                                                                                                                                                           | What it gives away                                                                                                                              | Who receives it (routes and sockets)                                                                                                                                                                                                                                                                                                                                                                    | Stored in                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guest player id               | `guest_<uuid v4>` (`models/identity.js`)                                                                                                                         | Nothing by itself. It is the same for the guest's whole session (up to 30 days), so anyone holding it could link everything the guest did       | Own only: `GET /api/session`, `POST /api/session/guest`, `identity:get`, `GET /api/progress` (`progress.playerId`), `progress:updated` (`progress.playerId`), and the export's `guestTransfers` (the player's own former guest ids)                                                                                                                                                                     | `player_sessions`, `rooms`, `matches`, `pending_matches`, `player_progress`, `player_stats`, `player_achievements`, `player_quests`, `player_transfers`, `player_blocks`, `leaderboard_entries` (guest rows and `mergedFrom`, ADR-060), `account_deletions.formerIds`, server memory (socket admission), log lines |
| Account player id             | `user_<24 hex>`: the MongoDB ObjectId of the `accounts` document                                                                                                 | **When the account was made**, to the second (the ObjectId's first 4 bytes). The same for ever, so it would link a player everywhere            | Own only: as the guest id, plus the sign-up and login answers (`identity`)                                                                                                                                                                                                                                                                                                                              | as the guest id, plus `accounts._id` and the `ADMIN_ACCOUNT_IDS` setting                                                                                                                                                                                                                                           |
| Computer player id            | `bot_<character>_<level>` (`models/botIdentity.js`)                                                                                                              | Which character and level, which the view shows anyway                                                                                          | Nobody as an id. Room views carry `seats[].bot { character, level }`                                                                                                                                                                                                                                                                                                                                    | `rooms`, `matches`, `pending_matches`                                                                                                                                                                                                                                                                              |
| Deleted player's stand-in     | `deleted_<uuid v4>`, new for each match and room (`models/deletedPlayer.js`)                                                                                     | Nothing. Each one is new, so they cannot be joined                                                                                              | Nobody as an id. Room views mark the seat `deleted: true`. History names it by a match player id, "Deleted player"                                                                                                                                                                                                                                                                                      | `matches`, `rooms`, `pending_matches`                                                                                                                                                                                                                                                                              |
| Seat id                       | 22 base64url characters: HMAC-SHA-256 of `[roomCode, room createdAt, playerId]` under the "classicade room seat ids" key (`domain/rooms/seatIds.js`, ADR-057)    | Nothing without the server's key. The same for one player in one room, rematches included, unrelated in every other room                        | Everyone in the room: every room view (answers of `room:create`, `room:join`, `room:request`, `room:answer`, `room:claim-win`, `game:move`, `room:play-computer`, and every `room:updated`) in `hostId`, `seats[].playerId`, `you`, requests, winners, series, fairness and the game's own view. `request:updated` (`you`, `names` keys, requests). Sent back in `POST /api/blocks` (`seatId`)          | Nowhere. Worked out for each view                                                                                                                                                                                                                                                                                  |
| Match player id               | 22 base64url characters: HMAC-SHA-256 of `[matchId, playerId]` under the "classicade match player ids" key (`domain/matches/matchPlayerIds.js`, ADR-057 amended) | Nothing without the server's key. The same for one player in one match for both participants, unrelated in every other match and to the seat id | The match's participants: `GET /api/matches` and `GET /api/matches/:matchId`, in `you`, `players[].playerId`, `result.winners` and every log entry                                                                                                                                                                                                                                                      | Nowhere. Worked out on every read                                                                                                                                                                                                                                                                                  |
| Display name                  | A guest's `Guest-<suffix>`, or an account's username (passes the name filter, ADR-022)                                                                           | The name the player chose. An account's username is the same everywhere, so it links a player on purpose, like a handle                         | Own: the session answers. Everyone in a room: `seats[].displayName`, `request:updated` `names`, `rematch.leftName`. Match participants: history and the export. Everyone: leaderboards (`GET /api/leaderboards/:boardId` `entries`), an adult account's username or a guest's server-given name, "Hidden player" for everyone else (ADR-048.10, ADR-060). The blocker: `GET /api/blocks` and the export | `player_sessions`, `accounts.username`, `rooms`, `matches`, `leaderboard_entries`, `player_blocks.blockedName`, `player_transfers`                                                                                                                                                                                 |
| Room code                     | 6 characters from `ROOM_CODE_ALPHABET` (`packages/shared/src/rooms.js`)                                                                                          | Nothing about a person. Whoever has it can open the room while it is open                                                                       | Anyone with the link: the room page URL and its page head, every room view, `room:closed`, `request:updated`, `GONE` answers. Match participants: `GET /api/matches/:matchId` (`roomCode`)                                                                                                                                                                                                              | `rooms`, `closed_rooms`, `matches.roomCode`, log lines (paths)                                                                                                                                                                                                                                                     |
| Match id                      | UUID v4, made when a game starts                                                                                                                                 | Nothing about a person. Both players of the match know it                                                                                       | The match's players: room views (`game.matchId`), `progress:updated` (`matchId`, `key`), history, the export. Sent back in `POST /api/blocks` (`matchId`)                                                                                                                                                                                                                                               | `matches`, `pending_matches`, `rooms.game.matchId`, `player_progress.recentMatchIds`, `player_achievements.matchId`, log lines                                                                                                                                                                                     |
| Fairness label                | 16 hex characters: SHA-256 of `fairness:<matchId>` (`domain/bots/botTurns.js`)                                                                                   | Nothing more than the match id                                                                                                                  | The room, in `fairness.game` during a game against a computer player                                                                                                                                                                                                                                                                                                                                    | Nowhere                                                                                                                                                                                                                                                                                                            |
| Block id                      | UUID v4 (`domain/blocks/blockComponent.js`)                                                                                                                      | Nothing                                                                                                                                         | The blocker only: `GET /api/blocks`, `POST /api/blocks`, `DELETE /api/blocks/:blockId`. Never the blocked player                                                                                                                                                                                                                                                                                        | `player_blocks`                                                                                                                                                                                                                                                                                                    |
| Feedback id                   | UUID v4 (`domain/feedback/feedbackComponent.js`)                                                                                                                 | Nothing                                                                                                                                         | The sender, in the 201 answer of `POST /api/feedback`. Admins: the inbox, `GET`, `PATCH` and `DELETE /api/admin/feedback/:feedbackId`                                                                                                                                                                                                                                                                   | `feedback`                                                                                                                                                                                                                                                                                                         |
| Session id                    | Random, signed, in the `cc.sid` cookie                                                                                                                           | Nothing, but it is the key to the session: whoever holds it is that player                                                                      | Own browser only, as an HttpOnly cookie. Never in a body, a URL or a log line                                                                                                                                                                                                                                                                                                                           | `player_sessions`, server memory (socket admission, renewals)                                                                                                                                                                                                                                                      |
| Socket id                     | Socket.IO's own id per connection                                                                                                                                | Nothing                                                                                                                                         | Own connection only                                                                                                                                                                                                                                                                                                                                                                                     | Server memory, log lines                                                                                                                                                                                                                                                                                           |
| Request id                    | UUID v4, or the caller's `X-Request-Id` when well formed                                                                                                         | Nothing                                                                                                                                         | The caller: the `X-Request-Id` header and `error.requestId`                                                                                                                                                                                                                                                                                                                                             | Log lines                                                                                                                                                                                                                                                                                                          |
| Email                         | As typed, lower case                                                                                                                                             | Who the person is                                                                                                                               | Own only, in the export (`POST /api/account/export`, with the password)                                                                                                                                                                                                                                                                                                                                 | `accounts.email`, legacy `users.email`. The login throttle keeps keyed hashes only                                                                                                                                                                                                                                 |
| Password hash                 | scrypt (`utils/passwordHasher.js`), bcrypt in legacy `users`                                                                                                     | Nothing usable without heavy guessing                                                                                                           | Nobody, ever                                                                                                                                                                                                                                                                                                                                                                                            | `accounts.passwordHash`, legacy `users.password`                                                                                                                                                                                                                                                                   |
| Birth year                    | Four digits, optional (CC-152)                                                                                                                                   | Roughly how old the player is                                                                                                                   | Own only: `GET /api/account`, `PUT /api/account/birth-year`, the export. Others see only whether a name is hidden on the leaderboards                                                                                                                                                                                                                                                                   | `accounts.birthYear`                                                                                                                                                                                                                                                                                               |
| Legacy row id                 | MongoDB ObjectId of a legacy `users` row                                                                                                                         | When the legacy account was made                                                                                                                | Nobody                                                                                                                                                                                                                                                                                                                                                                                                  | `legacy_closures.legacyId`                                                                                                                                                                                                                                                                                         |
| Network hash                  | 16 hex characters, HMAC of the host's address under a daily random key (CC-107, CC-249)                                                                          | The network, for two days at most, to the running server only                                                                                   | Nobody                                                                                                                                                                                                                                                                                                                                                                                                  | `rooms.network`, server memory                                                                                                                                                                                                                                                                                     |
| Admin flag                    | `admin: true`                                                                                                                                                    | That the player is an owner                                                                                                                     | Own only, `GET /api/session`, for allowlisted accounts                                                                                                                                                                                                                                                                                                                                                  | The `ADMIN_ACCOUNT_IDS` setting                                                                                                                                                                                                                                                                                    |
| Catalogue keys                | Game ids, achievement and quest ids, quest keys `quest:<day>:<id>`, board and week ids                                                                           | Nothing about a person                                                                                                                          | Public, or own (quest keys in `progress:updated`)                                                                                                                                                                                                                                                                                                                                                       | `player_achievements`, `player_quests`, `leaderboard_entries`                                                                                                                                                                                                                                                      |
| Leaderboard rank and standing | `entries[]`: `rank`, `displayName` (or "Hidden player" with `hidden: true`), `level`, `score`. `you`: `{ listed, rank, score }` or `{ listed: false, reason }`   | A player's level and score next to their public name. No row holds a player id, so a row cannot be joined to a room or a match                  | Everyone: `GET /api/leaderboards`, `GET /api/leaderboards/:boardId`, guests' rows included (ADR-060). Own only: `you`, sent with `Cache-Control: private, no-store`. The profile's rank card reads the same `you`                                                                                                                                                                                       | `leaderboard_entries`                                                                                                                                                                                                                                                                                              |

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
4. **Who can read it:** everyone who opens the room's link while it is open gets the room view: every seat's display
   name and seat id, which seat is the host, and the game view (seated players see their own view, others the
   spectator view). A seat id is a keyed hash of the room and the player (ADR-057, CC-253), so no player id, and no
   account's creation time, reaches anyone through a room. The seat ids are worked out for each view and never
   stored. Player ids, `network` and hidden game state never leave the server. The owner.
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
   only). Every player, the reader too, is named there by a match player id, a keyed hash of the match and the
   player worked out on every read (CC-297, ADR-057), so no player id and no account's creation time reaches anyone
   through history, and one opponent cannot be followed from match to match. The export names them `you` and
   `player-2` (ADR-048.6). The owner.
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

1. **Holds:** per board, period and player (accounts and guests, ADR-060): `playerId`, `displayName`, `level`,
   `score`, `recentKeys`, `updatedAt`, and `expiresAt` on weekly entries and on every guest entry. An account's
   weekly entry that a guest's was added to also holds `mergedFrom` (the guest ids) and `mergedKeys` (the match and
   quest keys the guest's entry had counted, at most 200), so nothing is counted twice.
2. **Personal data:** yes for accounts. The username, level and score are public. A guest's entry is pseudonymous:
   its public name is the server-given `Guest-XXXX`, which the player did not choose.
3. **Who can read it:** everyone, without signing in (`GET /api/leaderboards/:boardId`). Player ids are never sent.
   A signed-in player also gets their own rank. The owner.
4. **Kept for:** an account's all time entries for ever, and its weekly entries 28 days after the week ends
   (`WEEKLY_RETENTION_MS`). A guest's entries 30 days after its latest counted game or quest bonus
   (`GUEST_ROW_LIFETIME_MS`, the guest session's lifetime), and a weekly one never past its week's 28 days.
5. **Deleted by:** MongoDB's TTL index on `expiresAt`. The guest transfer deletes a guest's entries once they are
   added to the account (ADR-060). Account deletion deletes the account's entries and those of every guest id it
   had.

### `player_transfers`

`apps/server/src/persistence/playerTransferDao.js`

1. **Holds:** one document per guest who signed in: `from` (the guest id), `to` (`kind`, account id, username),
   `status`, `createdAt`, `completedAt`, `carriedOver` (XP, matches played, matches moved).
2. **Personal data:** pseudonymous. It links a guest's history to an account.
3. **Who can read it:** no client (the sign-in answer shows `carriedOver` once). The owner.
4. **Kept for:** for ever, so the move is never done twice (ADR-014).
5. **Deleted by:** nothing.

### `player_blocks`

`apps/server/src/persistence/blockDao.js`, rules in `apps/server/src/domain/blocks/blockComponent.js` (CC-044,
ADR-053)

1. **Holds:** one document per block: `blockId` (random), `blockerId`, `blockedId`, `blockedName` (the display name
   the blocked player had at that moment) and `createdAt`. At most 500 per blocker: the oldest goes. Guests and
   accounts alike. Indexes: unique on `blockerId` and `blockedId`, on `blockedId`, unique on `blockId`.
2. **Personal data:** pseudonymous, plus a display name. It says that one player chose not to meet another.
3. **Who can read it:** the blocker, as a list of names and dates without ids (`GET /api/blocks`, the profile, the
   data export). The blocked player never: no answer, list or export tells them, and a room refuses them with the
   same words as a full room. The server reads it before it seats or rematches two players. The owner.
4. **Kept for:** as long as the block lasts. Kept until the blocker unblocks, or either account is deleted. A guest's
   blocks move to the account they sign in to, and the blocks on a guest move with them, keeping the name the
   blocker saw (ADR-014). A guest who never signs in keeps their blocks as long as other guest data (CC-098).
5. **Deleted by:** unblocking (`DELETE /api/blocks/:blockId`), and account deletion, on either side.

### `feedback`

`apps/server/src/persistence/feedbackDao.js`, rules in `apps/server/src/domain/feedback/feedbackComponent.js` and
`apps/server/src/service/http/feedbackRoutes.js` (CC-290, ADR-059)

1. **Holds:** one document per item sent with the Feedback button: `feedbackId` (random), `type` (bug, idea or
   other), `message` (plain text, at most 1000 characters, control characters other than new lines and tabs
   removed, digits of any script stored as plain digits, and every email address and phone number in it replaced
   by `[email removed]` or `[phone removed]` before it is stored, `domain/feedback/maskContacts.js`), `replyEmail` (only when an adult account gave one), `page` (the route pattern such as
   `/games/chess/rooms/:code`, never a room code, a name, a query or a hash), `build` (the web build, such as
   `0.1.0+3f9c2ab`), `device` (phone, tablet or desktop), `kind` (visitor, guest or account, from the session),
   `status` (new, read or done), `createdAt` and `updatedAt`. Indexes: unique on `feedbackId`, TTL on `createdAt`,
   and `createdAt` with `feedbackId` for the newest first list.
2. **Not stored:** the player id, the session id, the IP address or any hash of it, the user agent, the screen size,
   the language or the referrer. Nothing joins an item to a player.
3. **Personal data:** whatever the player types in the message (the dialog asks them to leave out names, phone
   numbers and passwords), and the reply email when given. A reply email is taken only from an account whose birth
   year makes it an adult (ADR-028.1, ADR-048.8): the server refuses it from anyone else.
4. **Who can read it:** no client except an admin, through the owner console's inbox (`ADMIN_ACCOUNT_IDS`,
   ADR-036). The list (`GET /api/admin/feedback`) never carries a reply email, only whether there is one. The
   reply email is sent only for one item at a time, when the owner opens its details
   (`GET /api/admin/feedback/:feedbackId`). This is the console's first view of content about one person (ADR-059
   amends ADR-036.3). The owner, in the database.
5. **Kept for:** 180 days after it was sent (`FEEDBACK_KEEP_DAYS`), then MongoDB's TTL index removes it (within about
   a minute). Marking an item read or done does not change when it goes.
6. **Deleted by:** MongoDB's TTL index on `createdAt`, and the owner's Delete in the inbox
   (`DELETE /api/admin/feedback/:feedbackId`), for anything that holds personal details. Because no player id is stored, account deletion and the data
   export cannot find a player's feedback and do not take part (ADR-048.2 covers stores kept by player id). A
   request to delete one sooner goes through the privacy contact, and the owner deletes it in the inbox.

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

1. **Holds:** per deleted account: `playerId`, `formerIds` (the guest ids the player had before signing up, worked
   out once so every sweep can erase under them too), `requestedAt`, `sweepAgainAt` (until the last sweep) and
   `expiresAt`. No username, no email.
2. **Personal data:** pseudonymous at most. The id leads nowhere once the deletion is done.
3. **Who can read it:** no client. The owner.
4. **Kept for:** 30 days, as long as the backups, so a restore can be followed by the same deletions again
   ([runbooks/backup-restore.md](runbooks/backup-restore.md)). Housekeeping erases each deletion again every 5
   minutes for 30 minutes after it was asked: that finishes one the server could not complete, and outlasts the
   match pipeline's retries (about 13 minutes), so a game that was ending at that moment cannot write the player back.
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
| `pending_matches`                           | every record naming the player gets a stand-in            | no (it holds the same games)           |
| `player_progress`                           | deleted, with the guest markers naming the account        | yes                                    |
| `player_stats`                              | deleted                                                   | yes                                    |
| `player_achievements`                       | deleted                                                   | yes                                    |
| `player_quests`                             | deleted                                                   | yes                                    |
| `leaderboard_entries`                       | deleted                                                   | yes, without the player id             |
| `player_transfers`                          | deleted                                                   | yes                                    |
| `player_blocks`                             | deleted on either side                                    | the blocks the player made, by name    |
| `feedback`                                  | not reached: no player id is stored, the TTL removes it   | no (nothing joins it to the player)    |
| server memory (login throttle, rate limits) | not reached, forgotten at the next deploy or restart      | no                                     |
| server logs (Render)                        | not reached, ids only, 7 or 14 days                       | no                                     |
| backups                                     | not reached, age out within 30 days                       | no                                     |

1. **Anonymised matches.** A match another person played stays in their history. The deleted player's id is replaced
   everywhere in it by a new random stand-in for that match (`deleted_<uuid>`, named "Deleted player"), so the
   anonymous matches cannot be joined back into one history. The guest id the fair play credit may name
   (`credit.*.withdrawnFrom`) is dropped for the same reason. A stand-in earns nothing (`models/deletedPlayer.js`).
   The match pipeline's outbox (`pending_matches`, ADR-047) gets the same stand-ins, under the account id and every
   guest id the player had, in pending, done and failed records alike.
2. **Rooms.** In every room the player sits in, a new stand-in takes the seat and leaves at once, so a game that ends
   later cannot write the player's data back.

## Server memory

Kept in the server process only. A restart, a deploy or the free plan's sleep forgets all of it. Nothing here is
written to MongoDB, except the network hash, which is also stored in `rooms`.

| What                        | Holds                                                                                                                                                                                             | Kept for                                                                                                                                                                                 | Code                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| HTTP rate limits            | request counts per IP address (`ip:<address>`, IPv6 grouped by /56) or per session id, feedback per network (`net48:<address>`, IPv6 grouped by /48) and one count of feedback for the whole site | the window: 1 minute (API), 15 minutes (auth, guest sessions), 1 hour (sign-ups), 1 hour (feedback), 1 day (feedback per network, and the site's feedback count, which holds no address) | `service/http/rateLimits.js`, `authRoutes.js`, `sessionRoutes.js` |
| Login throttle              | failed logins per email and address, failed logins per email, and the addresses that signed in to each email, up to 10. Only keyed hashes are kept, never the email or the address                | failures 15 minutes, known addresses 30 days                                                                                                                                             | `service/http/loginThrottle.js` (CC-117)                          |
| Socket admission            | open connections per session id and per address, an event budget per player id                                                                                                                    | while connected, and until the budget refills                                                                                                                                            | `service/realtime/socketAdmission.js`                             |
| Network hash                | today's and yesterday's random keys, and the socket's address key, from which a room's hash is worked out when it is created                                                                      | a key until the second UTC midnight after its day, the address while connected                                                                                                           | `utils/networkKey.js`, `realtime/gateway.js`                      |
| Session renewals            | session ids being renewed by their own player                                                                                                                                                     | 5 seconds                                                                                                                                                                                | `service/http/session.js`                                         |
| Sign-outs                   | per player id, how often they signed out other devices and which session stayed                                                                                                                   | the process's life                                                                                                                                                                       | `service/realtime/gateway.js`                                     |
| Requests in flight          | per socket, events still being handled                                                                                                                                                            | until answered                                                                                                                                                                           | `service/realtime/connections.js`                                 |
| Background tasks and timers | post-game work (match, progression, gamification, leaderboards), the room sweep (1 minute), game deadlines (1 second), transfer resume (1 minute), the room gauge (1 minute)                      | until done                                                                                                                                                                               | `utils/backgroundTasks.js`, `server.js`                           |

Personal data: yes. The HTTP rate limits and socket admission hold IP addresses for minutes (a day for feedback per network), or while a socket is
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
      refused" (error code, whether a cookie was sent), "player blocked" and "player unblocked" (the blocker's id
      only, never who was blocked), "feedback received" (the feedback type only, never the message or who sent it), the room gauge, and errors with their stack.
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

## Operations telemetry

`apps/server/src/dependency/telemetry/`, ADR-055, CC-286. Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set in Render.

1. **Holds:** what ADR-055 point 1 lists, and nothing else (the allowlist is `telemetrySchema.js`):
   1. Metrics: request time by route template (`/api/matches/:matchId`, never the path), method and status class;
      socket event time by event name and outcome; open rooms by game and status; connections; match pipeline
      attempts and failures by step name; event-loop delay; memory; and two counters about telemetry itself
      (values scrubbed, log lines held back).
   2. Log records: only the named lines in `telemetrySchema.js` (warnings, errors and the start and stop of the
      server), at most 30 of the same line a minute, with only these fields: `errorCode`, `event`, `route`, `game`,
      `step`, `attempts`, `status`, `error.type` (the error's class). Never the error's message or stack.
   3. Resource: `service.name`, `service.version` (the commit), `service.instance.id` (a random id made at each
      start) and `deployment.environment.name`.
2. **Personal data:** no. No player id, display name, email, IP address (or a count of them), user agent, cookie,
   session id, socket id, room code, match id, raw path, query string or request id. A scrubber checks every key
   and value again before export, and `telemetryPrivacy.integration.test.js` plants each kind and checks the bytes
   that would leave.
3. **Who can read it:** the owner, in the Grafana Cloud stack (two-factor sign-in, nobody else invited).
4. **Kept for:** 14 days (Grafana Cloud free tier), https://grafana.com/pricing/, 2026-10-20.
5. **Deleted by:** Grafana Cloud. Account deletion (CC-035) has nothing to delete there.

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
   [analytics/EVENTS.md](analytics/EVENTS.md) is proposed). Operations telemetry (above) is about how the server
   runs and holds nothing about players. ADR-034 decided it will be anonymous counts only, first
   party, with an opt out. No third-party analytics.
5. Chat or any free text between players. Display names are the only text other players see, and they pass the name
   filter (ADR-022). The only other free text is feedback to the owner (`feedback` above), which no other player
   ever sees.

## Coming (not on `main` yet)

1. The owner console (CC-233, PR #64): reads `matches`, `player_transfers`, `accounts`, `player_progress`,
   `player_achievements`, `player_stats`, `player_quests` and `leaderboard_entries`, and shows aggregates only, with
   groups under 5 hidden. Its `ADMIN_ACCOUNT_IDS` allowlist decides who sees it.
2. Room event history (CC-242), 30 days.
3. Telemetry (CC-173 to CC-178): raw events 30 days, daily totals 13 months. Catalogue in
   [analytics/EVENTS.md](analytics/EVENTS.md).
4. Error tracking (CC-049): warning and error names already go to Grafana Cloud as
   [operations telemetry](#operations-telemetry). Stack traces stay in Render only. A tool that sends stacks would be
   a new row here and on the privacy page.
5. Birth year at sign-up (CC-152).
