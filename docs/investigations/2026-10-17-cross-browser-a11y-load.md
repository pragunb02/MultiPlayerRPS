# Investigation 2026-10-17: cross-browser, accessibility, load, bundle

Read-only investigation of `origin/main` at 931fca8. That includes CC-101 durable rooms, #40 (CC-106, CC-110 rate limits and the graceful-shutdown fix) and #45 (CC-108, CC-049 backups and uptime). Everything ran in a scratch copy at `/tmp/investigation/repo` on ports 4975-4978. The real checkout was not touched. Production got only a handful of read-only `curl` GETs. A Playwright script against production was blocked by the permission classifier, so no browser ran against production.

## Method and scratch changes (copy only)

- **Cross-browser:** Playwright 1.64.1 with seven projects: Chromium desktop, Pixel 7, Firefox 157, WebKit desktop, iPhone 14 (WebKit), plus the restart projects for each engine. Configs are `e2e/xb*.config.js` in the copy. Runs:
  - `/tmp/investigation/xb/` (raw)
  - `/tmp/investigation/xb2/` (WebKit, after the two environment fixes below)
  - `/tmp/investigation/xb4/` (all browsers on the current main)
  - `/tmp/investigation/xb5/` (restart specs on every engine)
- **Scratch flags, all marked `// SCRATCH` in the copy:**
  - `E2E_NO_UIR` drops `upgrade-insecure-requests` (`requestGuards.js:57`).
  - `E2E_INSECURE_COOKIE` drops the Secure cookie flag on http://localhost (`server.js:381`, `fixtures.js:112`).
  - `XB_IGNORE_WEBKIT_SELECT` and `XB_IGNORE_WEBKIT_CANCEL` count WebKit-only console noise instead of failing on it (`fixtures.js`).
- **Accessibility:** @axe-core/playwright 4.14 (axe 4.14.0) with tags wcag2a/aa, 2.1 a/aa, 2.2 aa and best-practice. 35 screens and states × desktop/mobile × light/dark = 140 scans. Results and screenshots are in `/tmp/investigation/a11y/results/`, the summary in `/tmp/investigation/a11y/summary.txt`. A separate contrast probe is `/tmp/investigation/probe/contrast.mjs`.
- **Load:** production server (`NODE_ENV=production`, `WEB_DIST_DIR`, in-memory MongoDB, raised rate limits because every client shares one IP) on a 14-core Apple-silicon laptop, Node 24.21, with `--cpu-prof`.
  - Client `/tmp/investigation/load/client.mjs`: 40 % RPS pairs (best of 7), 20 % chess pairs (rapid 10+0, random legal moves), 40 % idle sockets. Each player waits about 1 s before a move and calls an API every ~15 s.
  - Steps were 50, 200, 500 and 1000 sockets for 90 s each, then a 10-minute soak at 500.
  - Data is in `/tmp/investigation/load2/` (`metrics.jsonl` server side every second, `client.jsonl`, `soak.jsonl`, `prof/CPU.*.cpuprofile`).
- **Bundle:** `vite build`, then per-chunk gzip -9 and brotli 11, with source-map attribution (`/tmp/investigation/scripts/bundle.cjs`, output in `bundle.out`).
  - Throttled first visits used Chromium CDP (Pixel 7 profile) behind a local brotli proxy that stands in for Cloudflare (`probe/throttle.mjs`, `probe/throttle.out`).
  - Production headers were checked with curl.

## 1. Cross-browser

Pass counts on the current main, with the environment fixes on (`xb4`, `xb5`):

| Project                   | Main suite        | Restart suite |
| ------------------------- | ----------------- | ------------- |
| Chromium desktop          | 71/71             | 4/4           |
| Chromium mobile (Pixel 7) | 70/70 + 1 skipped | n/a           |
| Firefox                   | 69/71             | 3/4           |
| WebKit desktop            | 69/71             | 4/4           |
| iPhone 14 (WebKit)        | 69/71             | 3/4           |

Without the environment fixes, WebKit is unusable: in `xb`, 51 tests time out and 15 fail on each WebKit project.

Root causes, real bugs first:

1. **Real bug: stale lazy chunks crash the whole app after a deploy.** iPhone logged `Unable to preload CSS for /assets/HeroArt-B6YLf7qz.css` (`xb4`, leaderboard.spec.js:72).
   - Vite's preload error is not handled anywhere (no `vite:preloadError` listener, no retry around `lazy()`).
   - The only error boundary wraps the whole app (`app/ErrorBoundary.jsx`, `App.jsx:29`).
   - Reproduced in Chromium (`probe/stalechunk.mjs`, screenshot `probe/stale-chunk.png`): a player has the lobby open, a deploy removes the old `RpsBoard-*.js` (it now answers 404 text/html), the opponent joins, and the page shows only "Something went wrong. Please reload the page." The header and the game are gone.
   - CC-101 keeps rooms alive across deploys, so this now happens to every player in a waiting room or between games during a deploy.
2. **Real bug, intermittent: "Room not found" instead of "Room closed".** On iPhone (and on WebKit and Firefox in the earlier `xb3` run), `restart.spec.js:141` sometimes shows "Room not found: There is no room with the code …" when the rematch window ends. Chromium always passed. Details are in `/tmp/investigation/xb5/results/restart-a-long-wait-on-the-90082-…-restart-mobile-safari/`.
   - Likely cause is a check-then-act race in `persistence/roomDao.js:154` (`hasClosed`). It looks for the record in `closedRooms` first and the room marked as closing second.
   - `close()` (`roomDao.js:141`) goes in this order: mark the room as closing, write the record, delete the room.
   - A read that lands between those steps can miss both and answer NotFound. The read path is `roomComponent.js:123` `read()`, then `wasClosed`. `getClosed` at `roomDao.js:163` has the same ordering.
3. **Real but cosmetic: WebKit CSP noise from `<select>`.** WebKit logs "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive" for every `<select>` under `style-src 'self'`. A plain page with no app code reproduces it (`prodcheck/sel.mjs`), so it is an engine quirk. It is harmless today but would flood any CSP reporting CC-049 adds.
4. **Real, cause not found: Firefox logs `JSHandle@object` from React's `onCaughtError`.** Seen on 2 tests, as the page leaves /profile or a room (`index-C6fdFHL4.js` line 9 col 65897 is `console.error(e)` in React). It did not reproduce in 72 scripted navigations. The ErrorBoundary throws the error away, so nobody can see what it was.
5. **Fixed on main:** Firefox restart tests that timed out in the earlier `xb3` run now pass. This is the `gateway.js` "Connection: close while closing" fix in #40.
6. **Test assumptions, not app bugs:**
   - WebKit applies `upgrade-insecure-requests` to http://localhost (Chromium and Firefox exempt localhost), so every resource goes to https://localhost and fails.
   - WebKit drops `Secure` cookies on http://localhost.
   - WebKit reports aborted fetches as `cancelled`, plus a `Fetch API cannot load … due to access control checks` page error. The fixture only ignores ERR_ABORTED and NS_BINDING_ABORTED (`fixtures.js:52`).
   - WebKit's Tab key skips links (Safari default), which breaks `visual.spec.js:184`.
   - Firefox words the WebSocket error during a restart as "Firefox can’t establish a connection to the server at ws://…", which `RESTART_CONSOLE` (`fixtures.js:32`, Chrome wording) does not match.
   - WebKit warns "preloaded … but not used within a few seconds" for `RpsBoard`/`useMove`, a minor bundle note.

## 2. Accessibility

140 scans over 35 screens. Only one rule is violated:

- **aria-allowed-attr (axe impact critical), 512 nodes.** `aria-pressed` on `role="gridcell"` buttons (`games/chess/ChessBoard.jsx:121`). Seen on chess-mid-play and chess-piece-selected in all four desktop/mobile × light/dark combinations (64 squares × 8 scans).

"Needs review" results:

- **aria-prohibited-attr, 36 nodes on 9 RPS screens.** `<p aria-label="Score">` (`games/rps/RpsBoard.jsx:59`).
- **color-contrast, 2611 nodes on all 35 screens.** axe could not decide (gradients, pseudo-elements), so contrast is effectively untested.
  - My own probe, which layers each text colour over its backgrounds, found no failures on 16 screen/theme combinations.
  - One near-miss: the profile XP ring "100" is 4.35:1 in light mode against the 4.5:1 required.
  - The hero text it flagged is a false positive (white on a purple-to-pink gradient, checked on the screenshot).

From the code, outside axe's reach:

- No focus move or announcement on client-side route changes. The only programmatic focus is `JoinChooser.jsx:27` and `Modal.jsx:18`.
- The chess board is 64 separate Tab stops with no arrow-key navigation, even though `role="grid"` promises it. Every square is `disabled` when it is not your turn, so keyboard and screen-reader users cannot explore the position while waiting.

Screens not scanned: the leave-room confirmation modal, chess and Tic-Tac-Toe result screens, promotion, and draw offer.

## 3. Load

Server metrics per step (the event-loop histogram has 10 ms resolution, so subtract about 10 ms):

| Sockets | Server CPU p50/p95/max | RSS max | Heap max | Event-loop max | Moves/30 s      | Move p50/p95/p99 (worst 30 s window) | API p95 (worst) | Errors                |
| ------- | ---------------------- | ------- | -------- | -------------- | --------------- | ------------------------------------ | --------------- | --------------------- |
| 50      | 10/17/30 %             | 206 MB  | 66 MB    | 214 ms         | ~650            | 17/134/326 ms                        | 120 ms          | 0                     |
| 200     | 23/31/35 %             | 292 MB  | 107 MB   | 457 ms         | ~2500           | 355/954/1253 ms                      | 845 ms          | 0                     |
| 500     | 43/55/73 %             | 317 MB  | 139 MB   | 396 ms         | ~6500           | 101/902/2125 ms                      | 2108 ms         | 0                     |
| 1000    | 61/83/94 %             | 494 MB  | 252 MB   | 552 ms         | ~13100 (≈440/s) | 590/1852/2432 ms                     | 9592 ms         | 13 failed API fetches |

- **Soak, 500 sockets for 10 minutes:**
  - CPU climbs from 26 % to 85-96 % while the load stays the same, because chess games get longer.
  - Two stall periods (around 5 and 8 minutes in) take the move p95 to 1.6-1.8 s and the API p95 to 4.3-12.2 s, with event-loop stalls of 800-960 ms.
  - No memory leak: heap swings between 55 and 190 MB and falls back to about 100 MB once the sockets close. RSS 315-400 MB, back to 168 MB afterwards.
- **Breaking point on this laptop:** about 1000 sockets. At that point the p95 for a move is over 1.8 s and API reads time out.
- **Render free plan (estimate):** it has 512 MB RAM, and Render lists it at 0.1 CPU. Memory runs out around 1000 sockets, about 0.34 MB per socket. CPU would run out at roughly a tenth of the chess traffic. These are estimates, not measured on Render.
- **Top bottleneck (CPU profile, 1072 s):** `replay` in `packages/games/src/chess/chessEngine.js:48` is 30 % of all samples and 55 % of busy time. In the stall windows it is 60 %.
  - Every chess move (`applyMove`, `chessEngine.js:216`) replays the whole game from the start with chess.js (`_moves` and `_attacked` are the hot frames).
  - Microbenchmark (`probe/replaybench.mjs`): 1.2 ms at 20 plies, 5.6 ms at 80, 10.6 ms at 160, 20 ms at 300, 27 ms at 400. All of it blocks the event loop.
  - The cost runs again on every `ConcurrentChangeError` retry (`roomComponent.js:166`).
- **Second bottleneck:** every move costs 3 MongoDB round trips and a whole-document replace (`roomDao.js:120`: `replaceOne` of `structuredClone(doc)` with the full move log, then `get()` again, after `load()` read it). mongodb, bson and mongoose together are 10 % of samples, and `deepFreeze` (`roomAccessor.js:41`) runs on every read.
- **Unexplained minor stalls:** 200-450 ms event-loop stalls at only 10-20 % CPU in the first minute after each ramp. The profile has sampling gaps there, so the time is probably spent outside JS (local mongod or GC).

## 4. Bundle and first visit

- **Chunks (raw / gzip / brotli 11):**
  - `index.js` 394.4 / 122.5 / 105.6 KB
  - `index.css` 55.7 / 10.0 / 8.8 KB
  - `ChessBoard.js` 40.0 / 13.7 / 12.3 KB (chess.js is 34.8 KB raw of it)
  - `jsx-runtime.js` 9.0 / 3.4 / 3.1 KB
  - The RPS, TTT, HeroArt and useMove chunks are each under 4 KB.
- **Initial load (home):** 8 requests, 145 KB transferred (index.js, jsx-runtime, index.css, HeroArt js+css, favicon, /api/session, /api/games).
- **What is in the main chunk:**
  - react-dom 207 KB raw (52 %), react-router 37 KB, socket.io stack 41 KB, app and shared code 104 KB.
  - About 33 KB raw of that is route-only code (Privacy 6.1, Terms 2.8, Profile 3.9, Leaderboard 3.6, Signup 2.1, achievements, quests, streaks).
  - The socket uses `transports: ["websocket"]` (`lib/socket.js:13`), yet the polling transport is bundled anyway.
- **Production headers:**
  - Cloudflare serves brotli, 125 KB for index.js. But `cf-cache-status: DYNAMIC` on immutable `/assets/*`: assets are never cached at the edge, and index.js took 1.07 s to first byte from here.
  - `/pieces/*.png` and `/favicon.svg` are sent `no-cache`.
  - Source maps are public (`index-*.js.map`, 1.9 MB raw / 479 KB br).
  - The local Express server does no compression, which is fine only because the edge compresses.
- **Throttled first visit** (CPU ×4, Pixel 7, no origin latency and no cold start included), first contentful paint, which is the same as largest contentful paint because the page is rendered in the browser and blank until the JS runs:

  | Network                 | First paint |
  | ----------------------- | ----------- |
  | No throttle             | ~0.1 s      |
  | 4G (150 ms, 1.6 Mbps)   | 1.22 s      |
  | 3G (300 ms, 700 kbps)   | 2.45 s      |
  | Slow 3G (2 s, 400 kbps) | 7.2 s       |

  On top of that comes the Render free-plan cold start of 30-60 s (DEPLOYMENT.md) and an Oregon origin.

- Lighthouse was not run; these timings are a CDP measurement instead.

## Housekeeping

- All processes I started are stopped; ports 4975-4979 are free.
- The earlier agent left a load server (PID 3940) and its MongoDB (PID 3333) running for about 3 hours. Both are now stopped. Their PIDs were recorded in `/tmp/investigation/load/`.
- `/tmp/investigation/repo` is a `git worktree` of the real repo. Remove it with `git worktree remove --force /tmp/investigation/repo` when this report is no longer needed.
