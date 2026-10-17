# Match experience: audit, game shell, journeys and UX telemetry

Written 2026-10-17 from a two-browser audit of `main` and the open PRs #42 (sound and popups), #43 (chess) and #39
(save progress), at 1280×720 and 390×844 in light and dark. Every click was recorded with its DOM changes, sounds and
screen-reader announcements on both players' screens, and every key control was measured against the fold.
Proposed decision: ADR-020 (game shell). Tickets: CC-157 to CC-178, plus existing CC-036, CC-099, CC-113.

## 1. What players experience today

No button is broken. These are the places where nothing visible happens or the answer is off screen.

| #   | Situation                                        | What happens                                                                                                                                                         | Sev |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| A1  | After a game, "Play again" (the biggest button)  | It opens the lobby. It is not a rematch. The opponent who asked for a rematch waits up to 30 minutes and is never told, because the player still shows as connected. | P0  |
| A2  | Opponent asks for a rematch                      | No popup, no sound, no tab title. The only sign is a line below the result, and Accept is below the fold on laptop and phone.                                        | P0  |
| A3  | Rematch request                                  | There is no Decline and no expiry of the request itself.                                                                                                             | P0  |
| A4  | Series score                                     | Hidden until two games are done, shown only after a game, below the fold. Never visible while playing.                                                               | P0  |
| A5  | Own connection drops or the server restarts      | Clicks do nothing visible for 1 to 3 seconds. There is no connection indicator anywhere. The move lands after reconnecting.                                          | P0  |
| A6  | Opponent closes the tab                          | Only the word "disconnected" in the player list. No countdown, no sound, and the game never ends (CC-036).                                                           | P0  |
| A7  | Chess draw offer on main                         | A side panel line and button, no sound, below the fold on mobile, no decline, the offerer cannot withdraw.                                                           | P1  |
| A8  | Chess at 1280×720                                | Your own clock and, on mobile, Offer draw and Resign are below the fold.                                                                                             | P1  |
| A9  | First win                                        | Five toasts cover about 85 % of a phone screen including the result (CC-099).                                                                                        | P1  |
| A10 | Any button waiting for the server                | It only looks disabled: no spinner, then after 8 seconds a toast "The server took too long to answer".                                                               | P1  |
| A11 | Opponent forfeits, chess timeout or resign       | Only "You won!" or "You lost". The reason is below the fold or missing.                                                                                              | P1  |
| A12 | Clicking when it is not your turn or a used cell | Nothing at all happens: no reason, no sound.                                                                                                                         | P2  |
| A13 | Rock Paper Scissors after the opponent chooses   | One text line "has chosen". No sound, nothing announced.                                                                                                             | P2  |
| A14 | Opponent leaves during play                      | You get "You won!" with no mention of the forfeit near the top.                                                                                                      | P2  |

What the open PRs change: #42 adds rematch and draw popups with Accept, Decline and a chime on both sides, plus tab
alerts. It still has no request countdown, the asker's waiting state stays below the fold, the mobile popup covers the
bottom two ranks of the chess board, and focus jumps to Accept. A naive merge of #42 would also remove features CC-101
added (close reasons, the rematch countdown). #43's chess game over panel is above the fold on desktop and shows the
reason. #39's save progress card sits even lower and makes toasts clickable.

Screenshots of every state: `/tmp/ux-audit/shots/` on the audit machine (not committed).

## 2. The game shell (ADR-020, proposed)

One `MatchShell` in `apps/web/src/match/` owns everything a match has in common. A game module provides only what
differs. The room page renders the shell and never names a game. New games get all of this for free.

### What a game module provides

| Field          | Purpose                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `Board`        | The board, rendered inside the shell. It receives `interactive` and a `reason` when the player cannot act. |
| `Options`      | The lobby form for the game's options.                                                                     |
| `soundsFor`    | Which sounds an update plays (from #42).                                                                   |
| `moments`      | In-game beats such as "round won", "capture" or "three in a row", each with text and a tone.               |
| `outcomeText`  | Headline, reason and detail for every way a game can end, from the viewer's point of view.                 |
| `requestTypes` | Requests the game supports beyond rematch, for example a chess draw offer, with a lifetime.                |
| `scoreboard`   | What the series counts (games) and an optional in-game score (Rock Paper Scissors rounds).                 |
| `timers`       | Turn deadline and clocks, when the game has them.                                                          |
| `actions`      | The game's buttons for the action bar (Offer draw, Resign), each with a reason when it is disabled.        |

On the server, requests become one generic room feature: each request has a type, who asked, when it expires and its
state (open, accepted, declined, withdrawn, expired). The last answer is kept for 10 seconds so both players see it.
Expiry runs through the existing deadline sweep. One open request per type, a 10 second cooldown before asking again,
at most three draw offers per game. The series keeps a history of every game with its winner and reason.

### What the shell provides

1. **Request banner** at the top of the page, under the header, never over the board. Incoming: the question,
   Accept and Decline, a countdown bar, a chime and an urgent screen-reader announcement. Outgoing: "Waiting for Bob"
   with the countdown and Cancel. Answers ("Bob declined", "Bob accepted, starting", "Request expired") are shown to
   both players for 4 seconds. Focus never jumps. Escape hides the banner. A request goes ahead of the reward queue.
2. **Match bar**, sticky under the header in every state: `You 2 [●○●◐] 1 Bob · Game 4 · Your turn 0:24`. One dot
   per game played (filled is your win, hollow theirs, half a draw, with the reason on hover). The score animates when
   it changes. The in-game score sits beside it.
3. **Moments** on the board within 1.5 seconds. Win: gold burst, confetti and a win sound. Loss: no shake and no red,
   a soft dim, "Defeat" in neutral ink, a low two-note sound and kind words. Draw, forfeit, timeout, resignation and
   agreed draw each have their own icon and reason. With reduced motion the order stays and the animation goes.
4. **Result card** over the board on desktop and as a bottom sheet on mobile, with the board still visible. It has
   the headline, the reason, the series change, **Rematch** as the main action, **New opponent** (the old "Play again",
   which now withdraws any request and leaves the seat so A1 cannot happen) and "View board". Rewards play inside it
   one beat at a time: result, series change, XP bar, level up, achievements one by one (at most three, then "+N
   more"), quests, and for guests the save progress beat (CC-099, absorbing #39's card).
5. **Presence strip**, one chip per player: connected, thinking with a timer, reconnecting with a countdown, or left.
   Changes make a sound and an announcement. Your own connection: a "Reconnecting" banner after one second, and after
   a server shutdown notice "Server restarting, your game is safe". While it shows, every control is disabled with the
   reason "Reconnecting".
6. **Emotes**: six mascot emotes (GG, Nice!, Oops, Wow, Thinking, Rematch?) shown on the sender's chip for two
   seconds, one every three seconds, not stored, and a "mute opponent's emotes" switch.
7. **Button feedback standard** for every control in the app (`useAction` and `ActionButton`):

   | Phase                  | When                                              | What the player sees                                                     |
   | ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
   | Pressed                | at once                                           | The press shadow, optionally a click sound                               |
   | Waiting                | after 400 ms with no answer, then at least 300 ms | A spinner and "Sending", the button keeps its width                      |
   | Done                   | 600 ms                                            | A check mark or the change itself                                        |
   | Disabled with a reason | always                                            | Still focusable, and clicking shows why: "Not your turn", "Reconnecting" |
   | Failed                 | on error                                          | A message under the button with Retry, network failures go to the banner |

   The rule: every click gives a visible response within 100 ms. A browser test enforces it. The press and the click
   sound are that response. "Sending" waits 400 ms because a usual round trip from India to the Oregon server takes
   about 250 to 350 ms, and at 150 ms it flashed on almost every press. Once shown it stays at least 300 ms, so an
   answer just after 400 ms does not flash it either. Only the words wait: a failure and its reason show at once,
   and a board takes the next move as soon as the answer is in (CC-239, research and sources in
   docs/tickets/CC-239.md).

8. **Announcer**: one polite and one urgent screen-reader region per match. Urgent only for a request to you, your
   own connection loss and the result.

### Layout

Desktop (the whole board and both clocks fit in 1280×720):

```
┌ Header ─────────────────────────────────────────────────────────────┐
│ ▓ Request banner (only while a request exists) ▓                    │
├ Match bar: You 2 [●○●◐] 1 Bob · Game 5 · Your turn 0:24 · ☺         │
├──────────────────────────────────────────────┬──────────────────────┤
│                                              │ Presence             │
│        Board (from the game module)          │ Game panel (moves)   │
│   [Result card covers the board at the end]  │ Emotes               │
├ Action bar: [Offer draw] [Resign]  or at the end [Rematch] [New opponent] [Leave] ┤
```

Mobile (390×844):

```
┌ compact header ┐
│ ▓ Request banner ▓  (over the match bar, never over the board)
├ Match bar: 2 ●○●◐ 1 · Your turn 0:24 ┤
│ Bob  0:57       │
│  Board          │
│ You  0:59       │
├ sticky action bar: [Draw] [Resign] [☺] ┤
at the end: bottom sheet with headline, reason, series, [Rematch] [New opponent]
```

Constraints: ADR-012 tokens only, no inline styles (countdowns use `<progress>`), CSP unchanged, reduced motion and
the sound setting respected, every animated state also has text, contrast AA, touch targets at least 44 px.

### Rock Paper Scissors: the score line and fairness words (CC-225, CC-254)

The words players see, in full. Research and sources are in [CC-254](../tickets/CC-254.md). The rule: the main
screen says what the check means for the player, never how it works, and shows no hash, key or lock code. The proof
is one press away inside "How we keep it fair", folded in a native `<details>`.

| Where                                      | When                                     | Words                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Score line                                 | Always                                   | `Best of 3 · You 0 – Rocky 0 · first to 2 wins` (you first when you play)                                                                                                                                                                                                                                                                                                                                                                       |
| Round heading                              | Always                                   | `Round 2`, counting only rounds someone won, so a drawn round keeps its number                                                                                                                                                                                                                                                                                                                                                                  |
| Under the round heading                    | Right after a drawn round                | `Draw. It doesn't count, so play the round again.`                                                                                                                                                                                                                                                                                                                                                                                              |
| Above the hands                            | Rocky's throw for this round is locked   | `🔒 Rocky has chosen. It's locked, so Rocky can't change it after you pick.`                                                                                                                                                                                                                                                                                                                                                                    |
| Under the hands                            | Same                                     | `Rocky has chosen`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Above the hands, after a round             | The browser is still checking            | `Checking that Rocky's choice didn't change…`                                                                                                                                                                                                                                                                                                                                                                                                   |
|                                            | Lock, choice, key and result all agree   | `✓ Fair: Rocky's choice didn't change` (green)                                                                                                                                                                                                                                                                                                                                                                                                  |
|                                            | Anything does not agree                  | `⚠ Warning: Rocky's choice doesn't match what was locked in. This round may not have been fair.` (red, the sign is hidden from screen readers)                                                                                                                                                                                                                                                                                                  |
|                                            | The browser cannot hash (no HTTPS)       | `This browser can't check Rocky's choice, so we can't show that this round was fair.`                                                                                                                                                                                                                                                                                                                                                           |
|                                            | The page opened after the lock was shown | `This page opened after Rocky chose, so it can't check this round.`                                                                                                                                                                                                                                                                                                                                                                             |
| "How we keep it fair" dialog               | Always                                   | 1. Rocky is a computer player and picks first, in secret. It's like writing the choice on a card and sealing it in an envelope. 2. You see that the envelope is sealed before you pick. Once it's sealed, nobody can change what is inside: not Rocky, and not us. 3. After you pick, the envelope is opened. Your own browser checks that the choice inside is the one that was sealed, and the one Rocky played. Then the verdict line above. |
| "Show the proof (for the curious)", folded | After a round                            | Lock shown before you picked · Rocky's choice, shown after the round · Secret key, shown after the round · Text to check (the choice, a colon and the key) · Lock sent with the choice and the key · "Anyone can check it with any SHA-256 tool: put in the text to check, and the answer must be the lock shown before you picked."                                                                                                            |
|                                            | Before any round is over                 | Lock for this round · "Rocky's choice and the secret key are shown after the round."                                                                                                                                                                                                                                                                                                                                                            |

What is checked did not change in CC-254: "Fair" is shown only when the lock this browser remembered before the
round is the reveal's lock, the revealed throw is the one in the round's result, and the hash matches
(`sealVerdict`, CC-138 note 5).

Before CC-254 the board said "Rocky has locked in a throw. Lock 7f3a…c21", then "Rocky threw Rock. Lock checked ✓",
the dialog opened with the raw proof, and the score line was "You 0 — Rocky 0 Best of 3".

## 3. Order of work

First land the open PRs on top of CC-101 without losing any of its features: #41, #39 (its finished room seat
transfer is CC-113), #42 (decline rewritten for the new room store, no focus jump, popup not over the board), #43
(its inline draw offer replaced by #42's request).

| Step | Ticket         | What it delivers                                                                                      | Fixes      |
| ---- | -------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| 1    | CC-164         | The button feedback standard, all buttons converted                                                   | A10, A12   |
| 2    | CC-162         | Rematch is the main action in the result, "Play again" becomes "New opponent", reason in the headline | A1, A11    |
| 3    | CC-157         | ADR-020 and the shell skeleton: match bar, banner slot, action bar, result card slot                  |            |
| 4    | CC-161         | Always visible series scoreboard and series history on the server                                     | A4         |
| 5    | CC-159, CC-160 | Generic requests with expiry on the server, then the request banner                                   | A2, A3, A7 |
| 6    | CC-158, CC-036 | Presence, connection banner and server shutdown notice, with the idle opponent rules                  | A5, A6     |
| 7    | CC-172         | Layout that fits 1280×720 and 390×844 with nothing important below the fold                           | A8         |
| 8    | CC-163, CC-099 | Outcome moments and the reward queue inside the result card                                           | A9         |
| 9-11 | CC-166 to 168  | Rock Paper Scissors, Tic Tac Toe and Chess moved onto the shell one by one                            |            |
| 12   | CC-165         | Turn timer and "thinking" on the CC-036 deadlines                                                     |            |
| 13   | CC-169         | Emotes                                                                                                |            |

### Tests

1. Unit tests for every pure shell function: the match phase, requests, notices, scoreboard dots, the outcome text for
   every end reason and viewer, reward queue order, and the button state machine with fake timers.
2. Server tests for the request lifecycle, expiry, cooldowns, series history and the shutdown notice.
3. `e2e/match-shell.spec.js`: for every game and every state, a test clicks every control marked `data-cc-control` and
   fails if nothing visible changes within 100 ms, or if the other player sees nothing within one second where they
   should. Every state's main controls must be on screen without scrolling at 1280×720 and 390×844.
4. Two-browser flows for every request: ask, cancel, decline, accept, expire, ask after the opponent left, and the
   draw offer equivalents.
5. Restart, crash, offline, closed tab and slow network (a small latency proxy, because browser throttling does not
   slow WebSockets).
6. Screenshot baselines for every state (CC-155) and the layout checks (CC-154).

## 4. Journeys, step by step

Status: ok, missing (no feedback), broken (wrong result) or dead (nothing visible happens).

| Journey step                   | Feedback needed within 100 ms           | Today                                      |
| ------------------------------ | --------------------------------------- | ------------------------------------------ |
| Play as a guest                | press, then a spinner                   | ok, no spinner                             |
| Create a room                  | press, spinner after 400 ms             | missing spinner                            |
| Join by code                   | the reason while the button is disabled | missing reason                             |
| Open an invite as a visitor    | the chooser with three options          | ok                                         |
| Copy or share the invite       | a toast                                 | ok                                         |
| Wait for the opponent          | a sound and announcement when they join | missing, room expiry not shown             |
| See whose turn it is           | turn and timer                          | turn only                                  |
| Make a move                    | a mark or optimistic move and a sound   | ok, silent until #42                       |
| Move when not allowed          | the reason                              | dead (A12)                                 |
| Offer a draw                   | a waiting card with a countdown         | missing on main, partial in #42            |
| See the result                 | headline, reason, sound                 | reason missing (A11), toasts cover it (A9) |
| Ask for a rematch              | a waiting banner with a countdown       | missing on main (A2, A3), popup in #42     |
| Press "Play again"             | (should not strand the opponent)        | broken (A1)                                |
| See the series                 | always visible                          | missing (A4)                               |
| Sign up from the result screen | back in the room with the seat          | broken until CC-113                        |
| Own connection drops           | a reconnecting banner                   | dead (A5)                                  |
| Opponent drops                 | a countdown and a sound                 | missing (A6)                               |
| Server restarts                | "your game is safe"                     | missing (the room survives since CC-101)   |

Personas: first time visitors need short "how to play" text in the shell. Guests get the save progress beat last in
the reward queue. Account holders get their leaderboard rank change as a beat. Returning players with a streak get a
streak beat. On mobile every main control lives in the sticky action bar or the bottom sheet. On a slow network the
spinner shows after 400 ms (and stays at least 300 ms), the connection banner after one second, and a timeout becomes an inline Retry.

## 5. UX telemetry (first party, privacy safe)

CC-045 keeps product events derived on the server (match started and completed, invite opened, rematch, sign up).
The UX telemetry below is new, anonymous and client side (CC-173 to CC-178). The owner dashboard is the first page of
the admin console (CC-059).

**Privacy.** Sent only to our own `POST /api/telemetry`. No cookie, no player id, name, email, room code or free text.
A random id per browser tab, kept in memory and new on every reload. Routes are reduced to templates such as
`/games/chess/rooms/:code`, errors to codes. Only coarse context: visitor, guest or account, device class, viewport
size bucket, theme, reduced motion, sound muted. A footer switch turns it off (one allowlisted storage key), and
Global Privacy Control or Do Not Track also turn it off. The privacy policy gets a section on it, raw events are kept
30 days and daily aggregates 13 months.

**Events.**

| Event            | What it records                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `page_view`      | route template and where the visit came from (none, internal, invite, search, social)                           |
| `control_click`  | a stable control id such as `room.rematch.ask`, the match phase, the outcome, a disabled reason, the latency    |
| `dead_click`     | a click with no DOM change, request, sound or navigation within one second                                      |
| `rage_click`     | three or more clicks within one second in the same small area                                                   |
| `error`          | uncaught errors and rejections, as a code and component                                                         |
| `request_failed` | an API route or socket event that failed, with status and latency                                               |
| `socket`         | connect, disconnect with reason, reconnect with downtime, server restarting                                     |
| `match`          | time to first move, move acknowledgement time (sampled), how the game ended and how long it took, rematch steps |
| `funnel`         | visit, guest, room created or joined, invite opened, game started, finished, rematch, sign up                   |
| `vitals`         | LCP, INP, CLS and TTFB from the browser's own performance API                                                   |

Events are queued in memory and sent every 10 seconds, at 20 events, or when the tab is hidden, at most six requests
a minute per tab. Errors, dead and rage clicks, funnel and socket events are always sent. Clicks, move times and
vitals can be sampled by a rate the server sets.

**Owner dashboard** at `/admin/ux`, only for account ids in an admin allowlist set in Render: the funnel by day and
kind of visitor, dead and rage click hotspots by control and page (linked to that state's screenshot), errors and
failed requests, disconnects and reconnect times, time to first move, move latency against the 150 ms target, and the
page speed metrics.
