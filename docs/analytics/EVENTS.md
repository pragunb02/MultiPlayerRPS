# Analytics event catalogue

**Status: Proposed** (CC-244, 2026-10-18). The owner's answers to Q1, Q3, Q5 and Q6 are in [ADR-034](../DECISIONS.md): counts tier only, opt-out in the browser, player statuses, India days. Nothing here is built or recorded yet. The owner accepts, changes or cuts
this list. CC-173 then records the decision as an ADR and the privacy page section, and CC-174 to CC-178 build only
what is on the accepted list. An event that is not on this list is not sent.

Research and sources: [tickets/CC-244.md](../tickets/CC-244.md). What is stored today: [DATA.md](../DATA.md).

## 1. Rules for every event

1. **First party only.** Events go to `POST /api/telemetry` on our own server (CC-175) and into our own MongoDB. No
   third-party script, service or cookie (PRODUCT_VISION D15).
2. **Nothing typed by a person.** No free text, no form values, no search terms, no error messages, no URLs, no query
   strings, no referrer URLs, no room codes, no match ids, no emails, no usernames or display names, no IP addresses,
   no User-Agent strings. Every field value comes from a closed list in code (control names, route templates, error
   codes, game ids, close reasons) or is a number.
3. **No identifiers in the counts tier.** See section 2. The client never sends a player id, session id or device id.
   The server never adds one, except the hashed id of the adult tier.
4. **Names.** Lowercase snake_case `object_action`, a past tense verb, at most 40 characters, a fixed string in one
   shared module, never built from a value. Field names in snake_case, `is_` or `has_` for true or false, `_ms` for
   milliseconds. A flow that changes a lot gets a new name with `_v2` instead of changing what the old name means.
   (After GA4's and PostHog's rules, see the ticket.) Names used earlier in GROWTH.md and PRODUCT_VISION.md map
   like this: `page_view` is `page_viewed`, `gameplay_start` is `gameplay_started`, `share_sent` is
   `control_pressed` with `invite.share` or `invite.copy`, `link_opened` is a landing `page_viewed` with
   `entry = room_link`. `match_finished` and `account_created` keep their names.
5. **Numbers that could single someone out are bucketed** (counts of moves, days, seconds of a session). Timings stay
   in milliseconds, rounded to 10 ms.
6. **Opt out.** One switch on the privacy page and on the profile page turns every event off for this browser. Global
   Privacy Control (`navigator.globalPrivacyControl === true`, header `Sec-GPC: 1`) and Do Not Track (`DNT: 1`) count
   as opted out. The client sends nothing then, and ingestion drops any request that carries either header. Nothing
   records that someone opted out.
7. **Not counted.** Browser tests and local development send nothing (CC-178 checks it). Owner accounts listed in
   `ADMIN_ACCOUNT_IDS` are dropped at ingestion, so the owner's own clicking does not count.
8. **Retention.** Raw events 30 days (CC-175), then deleted by a MongoDB TTL index. Daily totals 13 months (CC-176).
   A total is a count, or a p50 and p95, per day and per value of the fields listed. The console hides any total
   under 5, as CC-233 does.
9. **Day boundary.** Daily totals use the India day (Asia/Kolkata), as the CC-233 console does (open question Q6).

### The fields every event carries

Set by the client unless marked "server". These are the only fields besides the ones each event lists.

| Field         | Values                                                                                                                            | Why                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `name`        | an event name from this list                                                                                                      |                                                               |
| `build`       | the web build's short version (CC-174 adds a build id at build time, there is none today)                                         | D15: compare before and after a deploy                        |
| `route`       | a route template from `apps/web/src/app/paths.js`, for example `/games/:slug/rooms/:code`, plus `:slug` filled with the game slug | which screen, never the room code                             |
| `device`      | `phone`, `tablet` or `desktop`, from the viewport width only                                                                      | layouts differ by width                                       |
| `player_kind` | `visitor` (no session), `guest` or `account`                                                                                      | guest and account WRP are reported apart (PRODUCT_VISION 7.1) |
| `tier`        | server: `counts` or `adult` (section 2)                                                                                           |                                                               |
| `received_at` | server: the time the batch arrived, to the minute                                                                                 | daily and hourly totals                                       |
| `player_hash` | server, **adult tier only**: a keyed hash of the account id (section 2)                                                           | adult cohorts                                                 |

## 2. Minors and the two tiers

ADR-028.1: unknown age means minor. Every guest, and every account without a stated birth year, is treated as under 18. CC-152 (birth year at sign-up) is not built, so **today every player is in the counts tier**.

| Tier       | Who                                                                                                                   | What an event may carry                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **counts** | everyone: visitors, guests, minors, unknown age accounts, and adults who are not in the adult tier                    | the common fields and its own fields only. No player, session, device or page-load id. Two events of the same person cannot be joined. The DPDP Act bars "tracking or behavioural monitoring of children" and no exemption covers analytics, so nothing about a minor is linked to that minor |
| **adult**  | accounts with a stated birth year of 18 or more (after CC-152), not opted out, **only if the owner turns it on (Q1)** | also `player_hash`: HMAC-SHA-256 of the account id with a telemetry secret held only by the server (not `SESSION_SECRET`), cut to 16 hex characters. Raw events with it are deleted after 30 days like all raw events                                                                         |

How the counts tier still answers per-visit questions: the client works out sequences itself and sends only the
result. A rage click is detected in the browser and sent as one `rage_click`. The time to first move is measured in
the browser and sent as one number. No id is needed to join events afterwards.

Retention per player (D1, D7, D30, WRP, guest to account) is **not** measured from events. It comes from the
service's own records in MongoDB (`matches`, `accounts`, `player_transfers`), which the CC-233 console already
counts, with groups under 5 hidden. Events add only the steps before and around a match.

## 3. The catalogue

Legend. **Sent by:** C client, S server. **Minors:** "counts" means the event is sent for everyone in the counts tier
(no ids). "adult hash" means it gains `player_hash` in the adult tier. Every event: raw 30 days, daily totals 13
months, off when opted out or with GPC or DNT. Exceptions are written in the row.

### 3.1 Pages and visits

| Event                 | By  | Trigger                                                                                                  | Fields (besides the common ones)                                                                                                                                                                                                                          | Purpose and the console question it answers                                                                                    | Minors             |
| --------------------- | --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `page_viewed`         | C   | a route renders (first load and every client side route change), after any redirect to the canonical URL | `is_landing` (first view of this page load), `entry` on the landing view only: `direct`, `room_link` (landed on a room route), `search`, `social`, `other_site`, from the referrer's host checked against a fixed list in code, never the referrer itself | Visits per day, the landing screens, entry types for the funnel (GROWTH 6.1 "Visit") and for k-factor: landings on a room link | counts, adult hash |
| `page_speed_measured` | C   | once per page load, when the page is hidden or after 30 s, whichever is first                            | `ttfb_ms`, `fcp_ms`, `lcp_ms`, `inp_ms`, `cls` (rounded to 0.01), `was_waking` (the CC-232 "waking up" screen was shown)                                                                                                                                  | Page speed on the dashboard (CC-177), the speed budget (GROWTH 2.5), cold starts as the ADR-005 trigger for always-on Render   | counts             |
| `visit_ended`         | C   | the page is hidden for good (`pagehide`), sent with `sendBeacon`                                         | `active_s` bucket (0 to 10, 10 to 30, 30 to 60, 1 to 2 min, 2 to 5 min, 5 to 15 min, 15 to 30 min, over 30 min) counted only while visible, `presses` bucket (0, 1 to 5, 6 to 20, over 20)                                                                | Session length (PRODUCT_VISION 7.2, target 4 minutes). A page load stands in for a session, because no id joins reloads        | counts             |

### 3.2 Presses

Every press uses the `data-cc-control` name of the element (ENGINEERING.md, CC-170). A press on an element without
one is a dead click by definition, and CC-178 checks that the browser suite causes none.

| Event             | By  | Trigger                                                                                                                                                                                                        | Fields                                                                                                                                                  | Purpose and the console question                                                                                                                                                                                                      | Minors             |
| ----------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `control_pressed` | C   | a pointer or keyboard press on an element with `data-cc-control` (the nearest one up the tree)                                                                                                                 | `control` (the name, for example `room.rematch.ask`), `has_reason` (the button showed why it could not act, ENGINEERING.md)                             | Which controls are used, and in what order on average. Funnels made of presses: `home.play_guest`, `lobby.create`, `invite.share` and `invite.copy` for shares (k-factor), `join.guest` on a room route for players brought by a link | counts, adult hash |
| `dead_clicked`    | C   | a press on an element with no `data-cc-control` that looks pressable (`cursor: pointer`, an image, a card), or a control press that changed nothing on screen, sent no request and did not navigate within 1 s | `control` when there was one, otherwise `element`: the tag and ARIA role only (`img`, `div:button`)                                                     | Dead click hotspots (CC-174, CC-177)                                                                                                                                                                                                  | counts             |
| `rage_clicked`    | C   | 3 or more presses within 700 ms within 30 px                                                                                                                                                                   | `control` or `element` as above, `presses` (3, 4, 5, more than 5)                                                                                       | Rage click hotspots (CC-174, CC-177)                                                                                                                                                                                                  | counts             |
| `action_waited`   | C   | a press that went through `useAction` got its answer, failed or timed out                                                                                                                                      | `control`, `transport` (`http` or `socket`), `wait_ms` (from press to answer), `outcome` (`ok`, an `ERROR_CODES` value, or `timeout`), `showed_spinner` | Latency per control as the player feels it (CC-240), whether "Sending…" shows too often (CC-239)                                                                                                                                      | counts             |

### 3.3 Sign-up and login

| Event                 | By  | Trigger                                                                                      | Fields                                                                                                                                                                         | Purpose and the console question                                                                                              | Minors                                      |
| --------------------- | --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `auth_form_viewed`    | C   | the login or sign-up form renders                                                            | `form` (`login`, `signup`), `next_kind` (`room`, `profile`, `leaderboard`, `none`: where `next=` points, never the path)                                                       | Top of the sign-up and login funnels                                                                                          | counts                                      |
| `auth_form_submitted` | C   | the form is sent (after the client's own checks passed)                                      | `form`                                                                                                                                                                         | Funnel step 2                                                                                                                 | counts                                      |
| `auth_form_rejected`  | C   | the client's own checks stopped the form                                                     | `form`, `field` (`email`, `username`, `password`), `rule` (a fixed code: `missing`, `too_short`, `format`, `reserved_name`)                                                    | Which field stops people, without seeing what they typed                                                                      | counts                                      |
| `account_created`     | S   | `POST /api/auth/signup` succeeded                                                            | `from_guest` (a guest session signed up), `guest_matches` bucket (0, 1, 2 to 5, 6 to 20, over 20), `guest_age_days` bucket (0, 1, 2 to 7, over 7) from the guest's first match | Guest to account within 7 days (PRODUCT_VISION 7.2), funnel end. `matches` holds the same, this keeps the funnel in one place | counts, adult hash once a birth year exists |
| `login_succeeded`     | S   | `POST /api/auth/login` succeeded                                                             | `method` (`account`, `legacy` when a legacy player was moved, CC-078), `from_guest`, `waited` (the CC-117 slow down applied)                                                   | Logins per day, legacy migrations still happening (when can `users` go, CC-241 F5)                                            | counts, adult hash                          |
| `login_failed`        | S   | the login answered an error                                                                  | `reason` (`wrong_credentials`, `throttled`, `rate_limited`, `validation`). Never which email, never whether the email exists                                                   | Lockouts hitting real players (SEC-16), sign-in friction                                                                      | counts                                      |
| `session_ended`       | S   | logout, "sign out other devices", a password change, or the server ending a session (CC-116) | `cause` (`logout`, `signed_out_elsewhere`, `password_changed`, `expired_90_days`)                                                                                              | Whether the 90 day limit annoys people, use of sign out other devices                                                         | counts                                      |
| `guest_started`       | S   | `POST /api/session/guest` made a new guest                                                   | none                                                                                                                                                                           | New players per day (GROWTH 6.2), the base of k-factor                                                                        | counts                                      |

### 3.4 Rooms and games

These are the room events of CC-242. CC-242 stores them per room for 30 days for support and disputes, with the
player ids the room already holds. **Analytics reads only counts from them**: the nightly job (CC-176) totals them
by the fields below, and no id leaves that collection for analytics. So they are not sent through
`/api/telemetry` at all.

| Event               | Trigger (server)                                        | Fields counted                                                                                                                                                             | Purpose and the console question                                                                                              |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `room_created`      | `room:create` succeeded                                 | `game_id`, `options_kind` (a fixed id, for example the chess time control), `player_kind`, `opponent_kind` (`person`, `character` once CC-138 ships)                       | Rooms per game per day, which options people pick                                                                             |
| `room_joined`       | `room:join` succeeded                                   | `game_id`, `as` (`seat`, `spectator`, `rejoin`), `status` at the time                                                                                                      | How often links are opened and lead to a seat (invite to play, PRODUCT_VISION 7.2)                                            |
| `room_join_refused` | `room:join` answered an error                           | `game_id` when known, `code` (`GONE` with the close reason, `NOT_FOUND`, `CONFLICT` for a full room, `RATE_LIMITED`)                                                       | Dead links: rooms that closed before the friend arrived (lifetimes in `roomLifetimes.js`)                                     |
| `game_started`      | the last seat filled and the game began                 | `game_id`, `wait_s` bucket from room created to start (under 30 s, 30 s to 2 min, 2 to 10 min, over 10 min)                                                                | Time from invite to play, liquidity (ADR-029)                                                                                 |
| `move_rejected`     | a `game:move` was refused                               | `game_id`, `reason` (a `MOVE_REJECTIONS` value)                                                                                                                            | Rules the board makes too easy to break                                                                                       |
| `player_away`       | a seated player's last socket dropped                   | `game_id`, `status`                                                                                                                                                        | Disconnects during games (phones locking, networks)                                                                           |
| `player_back`       | that player reconnected to the room                     | `game_id`, `away_s` bucket (under 10 s, 10 to 60 s, 1 to 10 min, over 10 min)                                                                                              | Whether reconnects work and how long people are gone                                                                          |
| `room_left`         | `room:leave`                                            | `game_id`, `status` (`waiting`, `playing` means a forfeit, `finished`)                                                                                                     | Forfeits and early exits                                                                                                      |
| `match_finished`    | a match was recorded (CC-045)                           | `game_id`, `reason` (the result reason), `opponent_kind`, `is_counted` and `not_counted_reason` (CC-095), `moves` bucket, `length_s` bucket, `series_game` (1, 2, 3, more) | Games per day, person share (the WRP guardrail), match length, how many rematches follow. `matches` holds the same per player |
| `rematch_asked`     | a player asked                                          | `game_id`                                                                                                                                                                  | Rematch rate                                                                                                                  |
| `rematch_answered`  | the request was accepted, declined, or the window ended | `game_id`, `answer` (`accepted`, `declined`, `window_ended`, `player_left`)                                                                                                | Rematch rate, whether 30 minutes is long enough                                                                               |
| `room_closed`       | the room closed                                         | `game_id`, `reason` (`ROOM_CLOSE_REASONS`), `status`, `life_min` bucket (under 5, 5 to 30, 30 to 120, over 120)                                                            | Whether lifetimes fit how people play (CC-101)                                                                                |

Minors: counts only, always. Retention: the CC-242 records 30 days (CC-242 decides), the totals 13 months.

Also from the browser, for the time to first move:

| Event              | By  | Trigger                                     | Fields                                                                | Purpose                                                                                                              | Minors |
| ------------------ | --- | ------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| `gameplay_started` | C   | the first move this page load sent (CC-220) | `game_id`, `entry` (as on the landing `page_viewed`), `since_load_ms` | Time to first move p75 by entry type (target 10 s), conversion to play: `gameplay_started` per landing `page_viewed` | counts |

### 3.5 Errors and connection

| Event            | By  | Trigger                                                                                                                        | Fields                                                                                                                                                                                | Purpose and the console question                                           | Minors |
| ---------------- | --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| `client_errored` | C   | the error boundary caught a render error, an unhandled rejection, a lazy part failed to load, or a stale build reload happened | `kind` (`render`, `unhandled`, `chunk_load`, `stale_build_reload`), `error_type` (the constructor name from a fixed list, otherwise `other`). No message, no stack                    | Errors per build and screen (CC-049 sees the details, this sees the trend) | counts |
| `request_failed` | C   | an API call answered 4xx or 5xx, or failed on the network                                                                      | `endpoint` (the route template, for example `/api/matches/:matchId`), `status`, `code` (`ERROR_CODES` or `network`)                                                                   | Error rates per endpoint as players see them                               | counts |
| `socket_changed` | C   | the realtime connection failed to connect, dropped or came back                                                                | `state` (`connect_failed`, `dropped`, `restored`), `code` (the refusal code from `SOCKET_REFUSALS` or the Socket.IO disconnect reason, a fixed list), `after_s` bucket for `restored` | Realtime health, players hitting the connection caps (CC-107)              | counts |
| `server_errored` | S   | a request or socket handler ended in a 5xx                                                                                     | `operation` (route template or socket event name), `code`                                                                                                                             | Server faults per day next to `client_errored`                             | counts |

### 3.6 Latency (CC-240)

| Event                      | By  | Trigger                                                                         | Fields                                                                                   | Purpose                                                                                                 | Minors             |
| -------------------------- | --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| `server_timing_summarised` | S   | once a minute per server process, from in-memory counters; no event per request | `operation` (route template or socket event name), `count`, `p50_ms`, `p95_ms`, `max_ms` | Server time per operation (CC-240). The ADR-005 Singapore trigger: p95 move latency over 150 ms (NFR-3) | not about a person |
| `action_waited`            | C   | see 3.2                                                                         |                                                                                          | Press to answer per control, which adds the network the server cannot see                               | counts             |

## 4. What each console question reads

| Question (GROWTH 6, PRODUCT_VISION 7)   | Read from                                                                                                                                                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visits per day, landing screens         | `page_viewed` with `is_landing`                                                                                                                                                                                                                                   |
| Conversion to play by entry type        | `gameplay_started` per landing `page_viewed`, by `entry`                                                                                                                                                                                                          |
| Time to first move (CC-220)             | `gameplay_started.since_load_ms`, p75 by `entry`                                                                                                                                                                                                                  |
| Finished games, games per game          | `matches` (CC-233), or `match_finished` totals                                                                                                                                                                                                                    |
| Session length                          | `visit_ended.active_s`                                                                                                                                                                                                                                            |
| Games per session                       | not exact without an id: `match_finished` per landing `page_viewed`, as an estimate                                                                                                                                                                               |
| D1, D7, D30 and WRP                     | `matches` and `accounts` in MongoDB (CC-233). Events only in the adult tier, if turned on                                                                                                                                                                         |
| Guest and account WRP, guest to account | `matches`, `player_transfers` (CC-233), and `account_created` buckets                                                                                                                                                                                             |
| k-factor (ADR-032 gate: 0.15)           | new players brought by a link (landing `page_viewed` with `entry = room_link`, then `control_pressed` `join.guest`, then `guest_started`) per WRP, with shares from `invite.copy` and `invite.share` presses. Not exact without ids, so the ratio of daily totals |
| Sign-up and login funnels               | `auth_form_viewed`, `auth_form_submitted`, `auth_form_rejected`, `account_created`, `login_succeeded`, `login_failed`                                                                                                                                             |
| Dead and rage clicks                    | `dead_clicked`, `rage_clicked` by `route` and `control`                                                                                                                                                                                                           |
| Errors                                  | `client_errored`, `request_failed`, `socket_changed`, `server_errored` by `build`                                                                                                                                                                                 |
| Latency                                 | `server_timing_summarised`, `action_waited`, `page_speed_measured`                                                                                                                                                                                                |
| Person share (WRP guardrail)            | `match_finished.opponent_kind`, or `matches`                                                                                                                                                                                                                      |
| Liquidity gates (ADR-029)               | room totals now. Search waits are added to this list when CC-051 is built                                                                                                                                                                                         |

## 5. How the privacy page wording would change

Only when CC-174 ships, in the same pull request, and announced on the site before it takes effect, as section 9 of
the page promises. Proposed changes:

1. **Intro and footer.** "nothing on this site tracks you for anyone else" stays. The footer's "No ads, no trackers"
   becomes "No ads, no third-party trackers".
2. **Section 4, What we do not do.** "No ads, no tracking pixels, no analytics services, no third party scripts or
   fonts" becomes "No ads, no tracking pixels, no third-party analytics, scripts or fonts".
3. **A new section, How we count how the site is used.** In plain words:
   1. We count which pages are opened, which buttons are pressed, where presses do nothing, errors and how long
      things take, so we can fix what is slow or confusing.
   2. These counts go only to our own server. They never include your name, email, IP address, what you type, or the
      code of your room.
   3. For players under 18, and for anyone whose age we do not know (every guest), the counts carry no id at all, so
      they cannot be linked to you or to each other.
   4. (Only if the adult tier is turned on.) For adults who told us their age, a scrambled id lets us see whether
      people come back. It cannot be turned back into your account by anyone without our server's key.
   5. The single events are deleted after 30 days. Daily totals are kept 13 months.
   6. You can turn this off with one switch on this page or your profile. If your browser sends Global Privacy
      Control or Do Not Track, it is off already.
4. **Section 3, Cookies.** Still one cookie. If the opt out is kept in the browser (Q3), a second setting
   `cc.telemetry` is listed beside `cc.sound`, and like it, it is never sent to us.
5. **Section 6, How long we keep it.** A line: "Usage counts: single events 30 days, daily totals 13 months."
6. **DATA.md** gets rows for the raw events and the daily totals.

## 6. Open questions for the owner

1. **Q1. The adult tier.** Turn it on after CC-152, or keep everyone in the counts tier for good? Recommended: counts
   only until CC-152 ships and the lawyer has read this list. Retention is already measured from `matches`.
2. **Q2. The lawyer's reading of DPDP 9(3).** Are counts with no id of any kind, sent for minors and unknown age
   players, outside "tracking or behavioural monitoring"? This list assumes yes. If not, minors and guests send
   nothing, and almost every event is lost, since every player is of unknown age today.
3. **Q3. Where the opt out lives.** Only in this browser (`cc.telemetry` in localStorage, a new key on the privacy
   page), or also on the account so it follows a signed-in player to every device?
4. **Q4. On or off by default for minors.** D15 says opt out (on by default) for everyone. The UK Children's code
   says profiling is off by default for children. Counts with no id are not profiling, so this list keeps them on.
   Agree?
5. **Q5. The WRP definition.** PRODUCT_VISION 7.1 says a day of real play on 3 or more local days in a week. GROWTH
   6.1 says real play in two different weeks. Which one does the console show?
6. **Q6. The day boundary.** Daily totals by the India day (as CC-233 does), or by UTC (as quests and streaks until
   CC-146)?
7. **Q7. DPDP rule 8(3).** It asks for one year of "traffic data and logs" of personal data processing from 13 May 2027. Raw events in the counts tier carry no id and should not be personal data, so 30 days stands. The lawyer
   confirms, together with CC-241 finding F9.
8. **Q8. Error detail.** Only the error type, as listed, or also the source location in the build (file and line,
   which holds nothing about the player) so errors can be grouped?
9. **Q9. Buckets.** Are the `device` and `entry` values and the buckets fine as they are, or does the owner want
   fewer (less detail, less risk) or more?
