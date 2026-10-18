# Known Issues (audit 2026-10-16)

Status: 🔴 open · 🟡 in progress · ✅ fixed. Line numbers refer to commit `ab4bdfe`.

## Resolution notes

- **2026-10-18 — docs audit:** findings that merged tickets listed as "found along the way" are now on this
  list. BUG-42 (CC-115, #74): the alerts tests load the chess board before they start. BUG-43 (CC-086, fixed on
  `main` with CC-053): `index.html` is sent relative to the build folder. BUG-44 (CC-101): the test waits for the
  guest name first. BUG-41 (CC-254) is fixed in PR #77 with `useEffectEvent` and is in progress until it merges.
  IDs BUG-30, BUG-31, BUG-40 and SEC-20 to SEC-22 are held by the open PRs #69 and #71.
- **2026-10-18 — CC-115, CC-234:** BUG-20 fixed. Socket.IO does not reconnect after the server ends a socket on
  purpose, and the web app never asked who it was after that, so other tabs and remotely signed out devices kept
  their old screen. A tab now asks `GET /api/session` again when the server ends its socket or refuses it as signed
  out, and after another tab of the browser says (over BroadcastChannel, with no identity in the message) that it
  signed up, logged in, logged out or started a guest (ADR-033).
- **2026-10-17 — CC-204:** BUG-29 fixed. Two races ended in "Room not found":
  1. The closed-room lookup read the record before the room being closed, so a close that finished between the two
     reads was missed. It now reads the closing room first. A shared DAO contract test closes a room at that moment.
  2. A request that found the room's time up tried to close it itself after the sweep already had, and the failed
     close escaped as NotFound. It now reads the room again and answers why it closed. A room component test has
     the sweep close the room between the request's read and its close.
- **2026-10-17 — audit findings added and fixed ones closed:** the ROADMAP audit's findings SEC-12 to SEC-19, BUG-15
  to BUG-23 and DEBT-13 to DEBT-20, and the match experience audit's A1, A2 and A4, A5, A6 and A9
  ([ux/MATCH_EXPERIENCE.md](ux/MATCH_EXPERIENCE.md)) as BUG-24 to BUG-28, are now on this list.
  - BUG-10 was reopened by the audit (rooms were still lost on every restart) and is fixed again by CC-101: rooms are
    stored in MongoDB with explicit lifetimes (ADR-017).
  - BUG-15, SEC-14 (CC-106, CC-110): rate limits key on the real client address through `TRUST_PROXY_HOPS`, and one
    budget covers all of `/api`.
  - BUG-18 (CC-113): seats in finished rooms follow a guest who signs in.
  - SEC-18 (CC-119): reserved names and an abuse filter for usernames, legacy names and guest names (ADR-022).
  - SEC-19 (CC-095): games that end too soon, or pass the daily and hourly limits, give no credit (ADR-021).

- **2026-10-16 — CC-029:** production runs the new stack and the legacy app (`index.js`, `client/`, `models/`, `db.js`,
  `config.js`, `hw.txt`, its dependencies) is deleted. Every finding fixed in the new stack is now closed:
  - SEC-01, SEC-03 (CC-013): identity only from the server-side session; sockets need a valid session and an allowed origin.
  - SEC-04, BUG-03, BUG-04, BUG-06, BUG-07 (CC-019, CC-020): Tic-Tac-Toe and chess are server-authoritative; server clocks.
  - SEC-05 (CC-010, CC-030): Helmet, rate limits, strict CSP with no inline code, CSRF defence (ADR-010).
  - SEC-08, BUG-09, BUG-10, BUG-13, BUG-14 (CC-015): crypto room codes, one room system, disconnect/expiry handling.
  - SEC-09, BUG-02 (CC-018): RPS choices are never sent to the opponent; match-level outcome.
  - BUG-05, BUG-08, DEBT-04 (CC-016, CC-017): one `matches` collection; progression on recorded matches, pushed to every tab.
  - BUG-12, DEBT-03, DEBT-05 (CC-023): one share component; CSS Modules over design tokens.
  - DEBT-01, DEBT-02 (CC-011): layered `apps/server`; no server code under a client folder.
  - DEBT-08 (CC-012): structured logger, `no-console` enforced; `hw.txt` deleted.
  - DEBT-10 (CC-031): only latest stable majors remain (Express 5, Mongoose 9, chess.js 1.4).
  - DEBT-12 (CC-074): the `MONGO_URI_PRODUCTION` fallback is gone with `config.js`; production sets `MONGO_URI`.
- **DEBT-09** ✅ README, `.env.example`, ESLint/Prettier, 967 unit/integration tests (100 % lines), 84 browser tests, and CI on every PR (CC-027).
- Earlier: SEC-02 (CC-008), SEC-06 (CC-006), SEC-07/SEC-11/BUG-11 (CC-009), SEC-10/DEBT-07 (CC-010), BUG-01 (CC-007),
  DEBT-06 (CC-005), DEBT-11 (CC-073).

## Security (`SEC-*`) — must be fixed before any public launch

| ID     | Status | Issue                                                                                                                                 | Location                                                             | Ticket         |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------- |
| SEC-01 | ✅     | Identity spoofing: matches/stats keyed on free-text `playerName`; anyone can type another user's name and inflate their level/history | `index.js` create/join handlers, `updateUserGameCount` callers       | CC-013         |
| SEC-02 | ✅     | Stored XSS: unescaped `<%- JSON.stringify(...) %>` of player-controlled names inside `<script>`                                       | `client/profile.ejs:329-331`                                         | CC-008         |
| SEC-03 | ✅     | Socket.IO connections are unauthenticated; `express-socket.io-session` installed but unused                                           | `index.js`                                                           | CC-013         |
| SEC-04 | ✅     | Client-authoritative results: TTT/chess winners and moves trusted from client                                                         | `index.js` `announceWinner`, `move`                                  | CC-019, CC-020 |
| SEC-05 | ✅     | No rate limiting on login/signup; no CSRF; no security headers (Helmet/CSP)                                                           | `index.js`, `client/routes/auth.js`                                  | CC-010, CC-030 |
| SEC-06 | ✅     | `SESSION_SECRET` / DB URI not validated at boot; dev always uses production DB                                                        | `index.js:25`, `db.js:9`                                             | CC-006         |
| SEC-07 | ✅     | No input validation on signup (username/email/password rules)                                                                         | `client/routes/auth.js`                                              | CC-009         |
| SEC-08 | ✅     | Room codes: 5 chars from `Math.random`, no collision check                                                                            | `index.js` `generateRoomId`                                          | CC-015         |
| SEC-09 | ✅     | RPS choice is sent to the opponent before the result (visible in DevTools)                                                            | `index.js` `player1ChoiceRPS`/`player2ChoiceRPS`, `client/client.js` | CC-018         |
| SEC-10 | ✅     | Logout destroys session without `req.logout()`; session cookie not `secure`/`sameSite`                                                | `client/routes/auth.js`, `index.js` session config                   | CC-010         |
| SEC-11 | ✅     | Login error revealed whether an email is registered ("Incorrect email" vs "Incorrect password")                                       | `client/routes/passport.js`                                          | CC-009         |
| SEC-12 | 🔴     | The MongoDB Atlas username and password are readable in the public git history (owner must rotate them)                               | commits 1156202 and 7e27cf2, legacy `db.js` and `index.js`           | CC-105         |
| SEC-13 | ✅     | Room flooding: any visitor can create rooms and open sockets without a cap and crash the single instance                              | `roomComponent.js` create and join, `gateway.js`                     | CC-107         |
| SEC-14 | ✅     | No rate limit on most API reads (gamification, matches, progress)                                                                     | `routes.js`, gamification, match and progress routes                 | CC-110         |
| SEC-15 | ✅     | No password change and no "sign out everywhere"                                                                                       | `authRoutes.js`, `sessionRoutes.js`, `session.js`                    | CC-116         |
| SEC-16 | ✅     | An attacker can lock a known email out of login                                                                                       | `authRoutes.js` failed-login limit                                   | CC-117         |
| SEC-17 | 🟡     | Signup reveals which emails have accounts (accepted trade-off until email verification)                                               | `accountComponent.js`                                                | CC-118         |
| SEC-18 | ✅     | No reserved-name or abuse filter on public usernames                                                                                  | `credentials.js`, `leaderboardComponent.js`                          | CC-119         |
| SEC-19 | ✅     | Wins and XP can be farmed through instant forfeits and repeated games against the same opponent                                       | `roomComponent.js`, `progression.js`, `leaderboardComponent.js`      | CC-095         |

## Bugs (`BUG-*`)

| ID     | Status | Issue                                                                                                                                                                          | Location                                                               | Ticket         |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------- |
| BUG-01 | ✅     | RPS button sends `"Scissor"`, server checks `"Scissors"` → Scissors never wins                                                                                                 | `client/index2.ejs:63`, `index.js` `determineRPSWinner`                | CC-007         |
| BUG-02 | ✅     | RPS: single `winner` field overwritten each round; every round counts as a played game                                                                                         | `index.js` `determineRPSWinner`                                        | CC-017, CC-018 |
| BUG-03 | ✅     | TTT: `ticTacToeRooms[id]` overwritten, losing `player1`                                                                                                                        | `index.js:264`                                                         | CC-019         |
| BUG-04 | ✅     | TTT: `checkWinner` can announce twice when two lines complete on one move                                                                                                      | `client/script.js`                                                     | CC-019         |
| BUG-05 | ✅     | Chess: `gamesPlayed` incremented on join, not on game end; result never persisted                                                                                              | `index.js` `joinChessGame`                                             | CC-017         |
| BUG-06 | ✅     | Chess: `currentCode` per-connection closure; `move` echoes back to sender; `joinGame` start condition wrong                                                                    | `index.js:493-512`                                                     | CC-020         |
| BUG-07 | ✅     | Chess: clocks run client-side only (drift, trivially manipulable); "Reset" only resets local board                                                                             | `client/public/js/index.js`                                            | CC-020         |
| BUG-08 | ✅     | `levelUp` emitted but no client sends `registerUser` → level-up popups never fire                                                                                              | `index.js:130,146`                                                     | CC-017         |
| BUG-09 | ✅     | Orphan events: client listens for `gameOverDisconnect`, emits `CancelTicTacToe`; server has neither                                                                            | `client/public/js/index.js:429`, `client/script.js:141`                | CC-015         |
| BUG-10 | ✅     | No disconnect handling; rooms never deleted (memory leak); all rooms lost on restart                                                                                           | `index.js`                                                             | CC-015, CC-101 |
| BUG-11 | ✅     | Signup: duplicate username → unhandled Mongo error/500; uses non-standard status `299`                                                                                         | `client/routes/auth.js:65`                                             | CC-009         |
| BUG-12 | ✅     | Share text says "Tic Tac Toe" for every game                                                                                                                                   | `client/client.js`, `client/chessJs.js`, `client/script.js`            | CC-023         |
| BUG-13 | ✅     | `handlers` for missing rooms throw (e.g. `rpsRooms[id]` undefined) — swallowed by try/catch, user gets no feedback                                                             | `index.js`                                                             | CC-015         |
| BUG-14 | ✅     | Joining RPS emits `playersConnectedRPS` twice to the joiner (room broadcast + direct emit)                                                                                     | `index.js` `joinRPSGame`                                               | CC-015         |
| BUG-15 | ✅     | Per-address rate limits keyed on the proxy's address, so real players shared one small budget                                                                                  | `app.js` (`trust proxy 1`), auth, session and leaderboard limiters     | CC-106         |
| BUG-16 | 🔴     | A database blip during the post-game work loses the finished match                                                                                                             | `server.js` post-game tasks, `backgroundTasks.js`                      | CC-111         |
| BUG-17 | 🔴     | A game starts after the host has left the waiting room                                                                                                                         | `roomComponent.js` join                                                | CC-112         |
| BUG-18 | ✅     | A guest who signs up after a game cannot rematch: seats in finished rooms did not follow the identity                                                                          | `roomComponent.js` `transferPlayer`                                    | CC-113         |
| BUG-19 | 🔴     | Logging out on one device gives up waiting seats held on all devices                                                                                                           | `server.js` session end, `roomComponent.js`                            | CC-114         |
| BUG-20 | ✅     | Other tabs go dead after signing in or out                                                                                                                                     | `SessionProvider.jsx`, `socket.js`                                     | CC-115         |
| BUG-21 | 🔴     | The chess clock shows "0:010.0" just under 10 seconds                                                                                                                          | `useChessClocks.js` `formatClock`                                      | CC-120         |
| BUG-22 | 🔴     | Games with an idle opponent never end                                                                                                                                          | `roomComponent.js`, `chessEngine.js`                                   | CC-036         |
| BUG-23 | 🔴     | The comment says a rematch alternates who moves first, but the first mover comes from the seed                                                                                 | `roomComponent.js` `requestRematch`                                    | CC-091         |
| BUG-24 | ✅     | After a game "Play again", the biggest button, opens the lobby: the opponent waiting for a rematch is never told                                                               | `RoomPage.jsx` result (UX audit A1)                                    | CC-162         |
| BUG-25 | 🔴     | Rematch requests and the series score are easy to miss: no countdown on a request, the series hidden during play                                                               | `RematchPanel.jsx`, `RoomRequests.jsx` (UX audit A2, A4)               | CC-160, CC-161 |
| BUG-26 | 🔴     | Your own connection drops or the server restarts: clicks do nothing visible and there is no connection indicator                                                               | `useRoom.js`, `RoomPage.jsx` (UX audit A5)                             | CC-158         |
| BUG-27 | 🔴     | The opponent closes the tab: only "disconnected" in the player list, no countdown and no sound                                                                                 | `Seats`, `RoomPage.jsx` (UX audit A6)                                  | CC-158, CC-036 |
| BUG-28 | 🔴     | A first win fires five toasts at once, covering most of a phone screen including the result                                                                                    | `ProgressToasts.jsx`, `GamificationToasts.jsx` (UX audit A9)           | CC-099         |
| BUG-29 | ✅     | Coming back just as a room closes could answer "Room not found" instead of the reason it closed (two races between closing and reading a room)                                 | `persistence/roomDao.js` closed-room lookup, `roomComponent.js` `load` | CC-204         |
| BUG-32 | ✅     | The three-games-against-computers limit could be passed with many starts at once and with rematches                                                                            | `botComponent.js` playComputer, acceptRematch                          | CC-138         |
| BUG-33 | ✅     | Strong chess searches had no server-wide limit and could block the event loop for every player                                                                                 | `domain/bots/thinkingQueue.js`                                         | CC-138         |
| BUG-34 | ✅     | A dropped computer plan was never made again until something else changed in the room                                                                                          | `botDriver.js` resume, housekeeping sweep                              | CC-138         |
| BUG-35 | ✅     | Bot XP reached the all-time XP board, and quest bonuses from bot games reached both XP boards                                                                                  | `leaderboardComponent.js`, progress `unrankedXp`                       | CC-138         |
| BUG-36 | ✅     | A guest's bot XP moved into an account without the account's 100 XP a day applied                                                                                              | `matchComponent.js` creditAfterMove                                    | CC-138         |
| BUG-37 | ✅     | The browser's lock check did not compare the reveal with the lock shown before the round                                                                                       | `lib/sealCheck.js`, `useSealChecks`                                    | CC-138         |
| BUG-38 | ✅     | Match history did not label computer opponents                                                                                                                                 | `matchComponent.js` listForPlayer, profile                             | CC-138         |
| BUG-39 | ✅     | `useRoom` could replace a newer room view with an older answer                                                                                                                 | `useRoom.js` revision check                                            | CC-138         |
| BUG-41 | 🟡     | Any room update behind an open dialog sent keyboard focus back to the dialog's first button ("Got it"): `Modal` ran its focus effect again on every new `onClose`              | `components/Modal/Modal.jsx` focus effect                              | CC-254         |
| BUG-42 | ✅     | `RoomPage.alerts.test.jsx` waited the default 1 s for the lazily loaded chess board, so busy test runs failed                                                                  | `RoomPage.alerts.test.jsx`                                             | CC-115         |
| BUG-43 | ✅     | Every page answered 500 when the checkout lives under a dot-folder (`~/.worktrees/…`): `res.sendFile` with an absolute path refuses a dot segment. Production was not affected | `service/http/webApp.js` index.html                                    | CC-086, CC-053 |
| BUG-44 | ✅     | The browser test "a guest is invited to keep their name with an account" was flaky on mobile: it opened `/profile` before the guest session existed                            | `e2e/screens.spec.js`                                                  | CC-101         |

## Tech debt (`DEBT-*`)

| ID      | Status | Issue                                                                                                                                                                                                 | Ticket                         |
| ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| DEBT-01 | ✅     | `index.js` monolith (595 lines): routes + sockets + rules + DB + leveling                                                                                                                             | CC-011                         |
| DEBT-02 | ✅     | Server routes live under `client/routes/`; `client/` served statically (templates & server files exposed as static)                                                                                   | CC-011                         |
| DEBT-03 | ✅     | Share-menu code (~150 lines) copy-pasted in 3 files; tooltip CSS injected via JS                                                                                                                      | CC-023                         |
| DEBT-04 | ✅     | Three near-identical models (`ChessData` copied from `RPSData` incl. unused `choice` fields)                                                                                                          | CC-016                         |
| DEBT-05 | ✅     | 5 overlapping CSS files; inline styles; magic IDs (`xyz`, `index2/3/4.ejs`)                                                                                                                           | CC-023, CC-029                 |
| DEBT-06 | ✅     | Unused deps: `archetype`, `ws`, `engine.io`, `nodemailer`, `connect-flash`, `ejs-lint`, `@chrisoakman/chessboardjs` (vendored copy used); `nodemon` in prod deps; `body-parser` used but not declared | CC-005                         |
| DEBT-07 | ✅     | Passport initialized twice (app + auth router)                                                                                                                                                        | CC-010                         |
| DEBT-08 | ✅     | Debug `console.log` everywhere, commented-out code blocks, `hw.txt` TODO file                                                                                                                         | CC-012, CC-029                 |
| DEBT-09 | ✅     | No tests, no README, no `.env.example`, no CI                                                                                                                                                         | CC-003, CC-004, CC-021, CC-027 |
| DEBT-10 | ✅     | Outdated libs: chess.js 0.10, Mongoose 6, Font Awesome 4 & 6 beta mixed                                                                                                                               | CC-031                         |
| DEBT-11 | ✅     | 31 known vulnerabilities in dependencies (1 critical, 11 high), via Mongoose 6 driver deps, `ws`, `connect-mongodb-session@2`, nodemon                                                                | CC-073                         |
| DEBT-12 | ✅     | `MONGO_URI_PRODUCTION` compatibility fallback (now logs a deprecation warning)                                                                                                                        | CC-074                         |
| DEBT-13 | 🟡     | Comments use semicolons, dashes, jargon and ticket IDs as explanations. The rule and its lint check are done (CC-125), and `packages/` is reworded. The other folders are swept in CC-126             | CC-125, CC-126                 |
| DEBT-14 | 🔴     | Result, close-reason, log-kind and XP-source values repeated as strings, two `resultFor` and two `viewerOutcome`                                                                                      | CC-127                         |
| DEBT-15 | 🔴     | The server and the test app wire the domain separately                                                                                                                                                | CC-128                         |
| DEBT-16 | 🔴     | Every web data hook repeats its own loading and error handling                                                                                                                                        | CC-129                         |
| DEBT-17 | 🔴     | Persistence and time helpers duplicated, missing JSDoc, dead code                                                                                                                                     | CC-130, CC-133                 |
| DEBT-18 | 🔴     | `roomComponent`, `server.js`, `ChessBoard` and `RoomPage` are too large                                                                                                                               | CC-131                         |
| DEBT-19 | 🔴     | No `RoomView` typedef and no `checkJs` in CI, so the JSDoc types are not checked                                                                                                                      | CC-132                         |
| DEBT-20 | 🔴     | One very large integration test file and aggregate web test files                                                                                                                                     | CC-134                         |
