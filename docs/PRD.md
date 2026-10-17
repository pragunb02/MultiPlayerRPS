# Product Requirements Document — ClassiCade

|                  |                                                              |
| ---------------- | ------------------------------------------------------------ |
| Status           | Draft v0.2                                                   |
| Last updated     | 2026-10-17                                                   |
| Business context | [BRD.md](BRD.md)                                             |
| Product vision   | [PRODUCT_VISION.md](PRODUCT_VISION.md) (accepted 2026-10-17) |

Requirement IDs: `FR-<area>-<n>` functional, `NFR-<n>` non-functional. Each has a target **stage** (S0–S4).
Backlog tasks in [BACKLOG.md](BACKLOG.md) reference these IDs.

The accepted [PRODUCT_VISION.md](PRODUCT_VISION.md) sets the personas, the order of work, the phases and the targets.
Its decisions D9, D10 and D11 are applied below. Our promise to players: **No betting. No cash. Ever.**

## 1. Personas

The primary personas for phases 1 and 2 are in [PRODUCT_VISION.md](PRODUCT_VISION.md) §2: Riya (an adult friend
group), Meena (a family on one phone) and the drop-in searcher. The list below is the original sketch.

- **Casey (casual):** opens a link from a friend on mobile, plays without signing up.
- **Riya (competitive):** wants ratings, history, leaderboards, replays.
- **Mr. Sharma (organizer):** runs a class/office tournament with a private leaderboard.

## 2. Core user journeys

1. **Invite & play:** Create room → share link → friend opens link → both in game → result → rematch. _(S1)_
2. **Quick match:** Pick a game. A labelled character is the main Play button, and "Find a person" searches in parallel for at most 4 seconds. _(S1)_
3. **Play a bot:** Pick game + difficulty → play instantly. _(S1)_
4. **Guest → account:** Guest plays 3 games → prompted to save progress → signs up, history preserved. _(S1)_
5. **Review:** Open profile → see history & ratings → replay a chess game. _(S1/S2)_

## 3. Functional requirements

### 3.1 Accounts & identity

| ID       | Requirement                                                               | Stage |
| -------- | ------------------------------------------------------------------------- | ----- |
| FR-ACC-1 | Email/password signup & login; unique username and email; validated input | S0    |
| FR-ACC-2 | Guest play with auto-generated name; guest identity persists via session  | S1    |
| FR-ACC-3 | Upgrade guest → account, keeping history                                  | S1    |
| FR-ACC-4 | Password reset via email                                                  | S1    |
| FR-ACC-5 | Social login (Google, later Apple)                                        | S2    |
| FR-ACC-6 | Profile: avatar, display name, public URL `/u/:username`                  | S1    |
| FR-ACC-7 | Account deletion & data export                                            | S1    |

### 3.2 Rooms & matches (shared by all games)

| ID        | Requirement                                                              | Stage |
| --------- | ------------------------------------------------------------------------ | ----- |
| FR-ROOM-1 | Create private room → unique, unguessable code + shareable URL           | S0    |
| FR-ROOM-2 | Join via code or URL; clear errors for invalid/full/expired rooms        | S0    |
| FR-ROOM-3 | Player identity on a room comes from session, never from client input    | S0    |
| FR-ROOM-4 | Disconnect handling: grace period for reconnect, then forfeit            | S1    |
| FR-ROOM-5 | Rooms expire and are cleaned up when idle/finished                       | S0    |
| FR-ROOM-6 | Rematch with one click (both accept)                                     | S1    |
| FR-ROOM-7 | Spectators (read-only)                                                   | S2    |
| FR-ROOM-8 | Every match persisted with players (user IDs), moves, result, timestamps | S0    |

### 3.3 Games

| ID         | Requirement                                                                                                        | Stage |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ----- |
| FR-GAME-1  | All rules and results computed on the server via a common engine interface                                         | S0    |
| FR-GAME-2  | **RPS:** best-of-N (1/3/5), simultaneous hidden choices, round history                                             | S0/S1 |
| FR-GAME-3  | **Tic-Tac-Toe:** standard 3×3; alternating first player on rematch                                                 | S0    |
| FR-GAME-4  | **Chess:** full rules (chess.js), server clocks, time controls (blitz/rapid), resign, offer draw, promotion choice | S0/S1 |
| FR-GAME-5  | Chess move list, PGN export, replay viewer                                                                         | S1    |
| FR-GAME-6  | Ludo (2–4 players), with characters and pass and play                                                              | S3    |
| FR-GAME-7  | Additional games (Connect Four, Checkers, Dots & Boxes, …)                                                         | S4    |
| FR-GAME-8  | Pass and play on one phone for all three games. Results are not counted                                            | S1    |
| FR-GAME-9  | Ultimate Tic Tac Toe as a permanent mode                                                                           | S2    |
| FR-GAME-10 | Turn-based Tic Tac Toe, Ultimate Tic Tac Toe and chess, with "your move" in the inbox                              | S2    |

### 3.4 Bots & AI

| ID      | Requirement                                                                                                                 | Stage |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | ----- |
| FR-AI-1 | Bot interface: a bot is a server-side player implementing `chooseMove(state)`                                               | S1    |
| FR-AI-2 | RPS bots: random, pattern-learning (Markov)                                                                                 | S1    |
| FR-AI-3 | TTT bots: easy (random), medium, unbeatable (minimax)                                                                       | S1    |
| FR-AI-4 | Chess bots: Stockfish with difficulty levels                                                                                | S1    |
| FR-AI-5 | Quick match: a labelled character for each game is the main Play button, with a parallel search for a person of at most 4 s | S1    |
| FR-AI-6 | Post-game coach / analysis (chess first)                                                                                    | S4    |
| FR-AI-7 | Anti-cheat signals (engine-correlation, abnormal win patterns)                                                              | S3    |
| FR-AI-8 | Every bot is labelled as a bot. Bot games never count for ratings or leaderboards (ADR-025)                                 | S1    |
| FR-AI-9 | Rock Paper Scissors characters lock in their throw first with a commitment the client checks (ADR-025)                      | S1    |

### 3.5 Progression & competition

| ID        | Requirement                                                                                           | Stage |
| --------- | ----------------------------------------------------------------------------------------------------- | ----- |
| FR-PROG-1 | XP & levels from completed matches (not rounds, not joins)                                            | S0    |
| FR-PROG-2 | Chess rating (Glicko-2) for rated human matches only. Provisional for 10 games, never reset (ADR-027) | S1    |
| FR-PROG-3 | Leaderboards: global, per game, weekly                                                                | S2    |
| FR-PROG-4 | Achievements & badges; win streaks                                                                    | S2    |
| FR-PROG-5 | Seasons with a free track and a season rank separate from the chess rating                            | S3    |
| FR-PROG-6 | Tournaments (swiss/knockout), private for clubs                                                       | S4    |

### 3.6 Social

| ID       | Requirement                                                                       | Stage |
| -------- | --------------------------------------------------------------------------------- | ----- |
| FR-SOC-1 | Share result card / room link (correct game name per game)                        | S1    |
| FR-SOC-2 | Emotes / quick chat in game                                                       | S1    |
| FR-SOC-3 | Friends, online presence, direct challenge                                        | S2    |
| FR-SOC-4 | Block, mute, report player                                                        | S1    |
| FR-SOC-5 | Circles: private groups of 2 to 50 with a circle board, safe for minors (ADR-028) | S2    |

### 3.7 Monetization

| ID       | Requirement                                                           | Stage |
| -------- | --------------------------------------------------------------------- | ----- |
| FR-MON-1 | Plus subscription (payments provider, entitlements)                   | S3    |
| FR-MON-2 | Cosmetics store (themes, piece sets, emotes)                          | S3    |
| FR-MON-3 | No ads in Stages 1 and 2. If ads ever come, between matches only (D9) | S3+   |

### 3.8 Admin & operations

| ID       | Requirement                                                               | Stage |
| -------- | ------------------------------------------------------------------------- | ----- |
| FR-ADM-1 | Admin console: users, bans, reports queue, live rooms                     | S2    |
| FR-ADM-2 | Feature flags, including the liquidity gates (ADR-029)                    | S1    |
| FR-ADM-3 | Product analytics events (match_started, match_completed, invite_sent, …) | S1    |

### 3.9 Legal & marketing pages

| ID       | Requirement                                      | Stage |
| -------- | ------------------------------------------------ | ----- |
| FR-LEG-1 | Privacy policy, Terms of Service, cookie consent | S1    |
| FR-MKT-1 | Landing page + SEO page per game                 | S1    |

## 4. Non-functional requirements

| ID     | Requirement                                                                                                               | Stage |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ----- |
| NFR-1  | **Security:** no XSS (escaped output, CSP), CSRF protection, rate-limited auth, Helmet headers, secrets validated at boot | S0    |
| NFR-2  | **Integrity:** server-authoritative state; clients cannot see opponent's hidden info                                      | S0    |
| NFR-3  | **Performance:** p95 move round-trip < 150 ms; time-to-first-match < 10 s                                                 | S1    |
| NFR-4  | **Reliability:** 99.5% uptime; reconnect within 30 s restores the match                                                   | S1    |
| NFR-5  | **Scalability:** stateless app servers; room state in Redis + Socket.IO adapter                                           | S2    |
| NFR-6  | **Quality:** unit tests for every game engine (≥ 90% coverage), integration tests for room flows, CI on every push        | S0    |
| NFR-7  | **Observability:** structured logs, metrics, error tracking, alerts                                                       | S1    |
| NFR-8  | **Accessibility:** WCAG 2.1 AA, keyboard play, colour-blind safe                                                          | S1    |
| NFR-9  | **Responsive:** mobile-first, works on 360 px width                                                                       | S1    |
| NFR-10 | **Privacy:** minimal PII, data deletion, environment separation (dev/staging/prod)                                        | S0/S1 |

## 5. Stage 1 exit criteria (amended by D11)

Public URL, 3 polished games in the game shell, a labelled character for each game as the main Play button, pass
and play, invite links, guest play, chess rating, legal pages and monitoring. The full phase 1 exit list, with its
measured targets, is in [PRODUCT_VISION.md](PRODUCT_VISION.md) §8.1.

## 6. Metrics

North Star: **Weekly Returning Players (WRP)**, players with a day of real play on 3 or more different local days
in a week, with the person share, account share and bot XP guardrails. Day 1, day 7 and day 30 return targets for
phases 1 and 2 are in [PRODUCT_VISION.md](PRODUCT_VISION.md) §7.2. The day 7 target of 20% or more is a Stage 3
stretch goal (D10).

## 7. Open questions

See [DECISIONS.md](DECISIONS.md) → "Open decisions".
