# Known Issues (audit 2026-10-16)

Status: 🔴 open · 🟡 in progress · ✅ fixed. Line numbers refer to commit `ab4bdfe`.

## Resolution notes

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
- **DEBT-09** 🟡 README, `.env.example` files, ESLint/Prettier/Vitest and 770 tests exist; CI is still missing (CC-027).
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

## Bugs (`BUG-*`)

| ID     | Status | Issue                                                                                                              | Location                                                    | Ticket         |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------- |
| BUG-01 | ✅     | RPS button sends `"Scissor"`, server checks `"Scissors"` → Scissors never wins                                     | `client/index2.ejs:63`, `index.js` `determineRPSWinner`     | CC-007         |
| BUG-02 | ✅     | RPS: single `winner` field overwritten each round; every round counts as a played game                             | `index.js` `determineRPSWinner`                             | CC-017, CC-018 |
| BUG-03 | ✅     | TTT: `ticTacToeRooms[id]` overwritten, losing `player1`                                                            | `index.js:264`                                              | CC-019         |
| BUG-04 | ✅     | TTT: `checkWinner` can announce twice when two lines complete on one move                                          | `client/script.js`                                          | CC-019         |
| BUG-05 | ✅     | Chess: `gamesPlayed` incremented on join, not on game end; result never persisted                                  | `index.js` `joinChessGame`                                  | CC-017         |
| BUG-06 | ✅     | Chess: `currentCode` per-connection closure; `move` echoes back to sender; `joinGame` start condition wrong        | `index.js:493-512`                                          | CC-020         |
| BUG-07 | ✅     | Chess: clocks run client-side only (drift, trivially manipulable); "Reset" only resets local board                 | `client/public/js/index.js`                                 | CC-020         |
| BUG-08 | ✅     | `levelUp` emitted but no client sends `registerUser` → level-up popups never fire                                  | `index.js:130,146`                                          | CC-017         |
| BUG-09 | ✅     | Orphan events: client listens for `gameOverDisconnect`, emits `CancelTicTacToe`; server has neither                | `client/public/js/index.js:429`, `client/script.js:141`     | CC-015         |
| BUG-10 | ✅     | No disconnect handling; rooms never deleted (memory leak); all rooms lost on restart                               | `index.js`                                                  | CC-015         |
| BUG-11 | ✅     | Signup: duplicate username → unhandled Mongo error/500; uses non-standard status `299`                             | `client/routes/auth.js:65`                                  | CC-009         |
| BUG-12 | ✅     | Share text says "Tic Tac Toe" for every game                                                                       | `client/client.js`, `client/chessJs.js`, `client/script.js` | CC-023         |
| BUG-13 | ✅     | `handlers` for missing rooms throw (e.g. `rpsRooms[id]` undefined) — swallowed by try/catch, user gets no feedback | `index.js`                                                  | CC-015         |
| BUG-14 | ✅     | Joining RPS emits `playersConnectedRPS` twice to the joiner (room broadcast + direct emit)                         | `index.js` `joinRPSGame`                                    | CC-015         |

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
| DEBT-09 | 🟡     | No tests, no README, no `.env.example`, no CI                                                                                                                                                         | CC-003, CC-004, CC-021, CC-027 |
| DEBT-10 | ✅     | Outdated libs: chess.js 0.10, Mongoose 6, Font Awesome 4 & 6 beta mixed                                                                                                                               | CC-031                         |
| DEBT-11 | ✅     | 31 known vulnerabilities in dependencies (1 critical, 11 high), via Mongoose 6 driver deps, `ws`, `connect-mongodb-session@2`, nodemon                                                                | CC-073                         |
| DEBT-12 | ✅     | `MONGO_URI_PRODUCTION` compatibility fallback (now logs a deprecation warning)                                                                                                                        | CC-074                         |
