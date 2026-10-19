# Domain: Social and sharing

Status: proposed on 2026-10-19 for the owner (research and planning only, no app code). The owner asked for two
domains to be defined first; this is one of them. Decisions marked **owner to confirm** are the owner's call and are
also recorded as the open ADR-051 in [DECISIONS.md](../DECISIONS.md). Sources were read on 2026-10-19 unless another
date is given. "General knowledge" carries a confidence level, as in the rest of `docs/`.

## 1. Purpose and scope

**Purpose.** Let a player bring the people they know into a game, find them again, and play with strangers only in
ways that are safe for children by default. This domain carries the vision's "with people you know" (phase 2 goal,
[PRODUCT_VISION.md](../PRODUCT_VISION.md) §4.6, §6.8) and the main free growth loop ([GROWTH.md](../GROWTH.md) §3.8).

**In scope:**

1. **Invites and share links.** The room link, the share menu, the device share sheet, persistent challenge links
   (`/challenge/:id`), and what a link carries (never an identity, at most a channel marker).
2. **WhatsApp and link previews.** The `wa.me` button, Hinglish share text, `og:` tags and preview images
   (ADR-042 owns how tags are written; this domain owns what a shared link says).
3. **Share cards.** Result text and images, never a minor's or a guest's username (ADR-028.7).
4. **Public profiles and avatars** (CC-034), and what a room view shows of another player (CC-253).
5. **Friends** (mutual), presence for friends, head to head; **follow** (phase 3, adults only, ADR-028.5).
6. **Circles** (private groups of 2 to 50 joined by a link, ADR-028.3 and .4).
7. **Block, mute and report**, the reports queue in the owner console and the grievance contact (CC-044). See §2.3
   for why safety lives here.
8. **Quick match with people** ("Find a person", CC-051): the pool and the pairing rules. The room after pairing is
   Match experience.
9. **Challenges** (direct, persistent) and **"play again with"** someone you met (proposed CC-277).
10. **Messages between players**: the inbox, web push for asked-for messages, preferences and quiet hours (ADR-031),
    and the dark pattern audit that gates push (CC-229).
11. **Emotes** (CC-169), the only way players talk (ADR-028.6: no free text, no voice).
12. **Leaderboards as a social surface**: whose name is shown, hidden names for minors (ADR-048.10), the friends
    filter and head to head (CC-140), and the circle board. How scores are computed stays with Progression.
13. **Playing together without a graph**: pass and play on one phone (CC-223) and turn-based games with people you
    know (CC-222).
14. **Privacy and safety settings** for all of the above (proposed CC-278).

**Out of scope** (owner domain in brackets):

1. Rematch, series, requests and presence inside a room, the game shell, spectating, anti-cheat (Match experience).
2. Measuring the k-factor, telemetry events and their ingestion, liquidity gate flags, search, the brand domain,
   launch decisions (Growth and analytics).
3. Sign-up, the age signal itself, names and the name filter, passwords, sessions, deletion and export, social login
   (Accounts).
4. Story levels and characters (Story mode). Reminders' content (streaks, daily puzzle), XP, leagues, arenas,
   seasons, tournaments (Progression and rewards).
5. Avatar art, Hinglish string catalogue, visual style (Look and feel).

## 2. Boundaries

### 2.1 Against Match experience

The line is the room. **Inside a room** (rematch, "new opponent" leaving the room, draw offers, the series score,
presence of the two seats, room lifetimes) is Match experience: CC-037, CC-091, CC-114, CC-161, CC-207, CC-246.
**Reaching a person from outside a room** is Social: the invite link that brings someone in, the challenge that
survives a closed room (CC-139), "play again with" after the 30 minute rematch window has closed (CC-277), quick
match pairing (CC-051). Two shared points:

1. Block effects inside a room (refuse a seat, refuse a rematch) are built by CC-044 in `roomComponent`, so the
   Match experience builder reviews that PR.
2. What a room view sends about the other seat (CC-253) is Social, because it decides what a stranger learns about
   a player. The room code itself stays Match experience.

### 2.2 Against Growth and analytics

Social builds the loop; Growth measures it. Social owns the share button, the text, the link and a channel marker on
the link (proposed CC-279). Growth owns the k-factor definition (EVENTS.md §4), the events and their ingestion
(CC-173 to CC-176), the ADR-032.2 gate (k of 0.15 or more for two weeks) and the gate flags (CC-228). A Social
ticket never adds an event: it uses `control_pressed` names and asks Growth for anything new (as CC-051 does with
`quick_match_searched`).

### 2.3 Against Safety and moderation: not a separate domain, for now

**Decision (recommended, owner to confirm): safety and moderation live inside Social and sharing.**

1. **Every safety rule we have is about contact between players.** Block, mute and report exist because quick
   match, challenges, friends, circles and emotes exist (ADR-028.8 makes them a prerequisite). Splitting them off
   puts the prerequisite and its users in different hands, and a social feature could ship before its safety rule.
2. **Safety by design, not a later layer.** Australia's eSafety Commissioner's Safety by Design principles
   (service provider responsibility, user empowerment and autonomy, transparency and accountability, general
   knowledge, high confidence, the page timed out for the fetcher) and the UK Children's Code (standard 7, high
   privacy by default, standard 15, online tools, cited in CC-044) both ask that safety be built into each feature.
3. **One owner handles reports.** There are no moderators, no roles (ADR-036) and no free text. A domain with one
   ticket (CC-044) and no team adds a boundary with no one behind it.
4. **What stays elsewhere:** the age signal (CC-152, Accounts), anti-cheat (CC-060, Match experience), account
   security (Accounts), and roles and bans in the admin console (CC-059).
5. **Revisit** when any of these happens: free text of any kind (chat, report notes), a second person handling
   reports (CC-059 roles), or more than about 20 reports a week. Then Safety and moderation becomes its own domain
   and takes CC-044, the reports queue and the grievance process.

### 2.4 Against Story mode and Accounts

1. **Story mode.** No overlap today. A story result may later reuse the share text module from CC-217 (a pure
   `shareText`), which is a dependency, not shared work.
2. **Accounts** owns the age group (`ageGroupFor`, ADR-048.8) and every Social feature **reads** it; Social never
   asks for or stores an age. Accounts owns the profile page's account section; Social owns the public profile and the
   privacy and safety section (CC-278). Every new Social store adds `transferPlayer` (ADR-014) and
   `erasePlayer`/`exportPlayer` (ADR-048.2) participants and a DATA.md entry in the same PR. Name rules (CC-119,
   CC-185) stay Accounts, and reports feed them (a name reset from the reports queue, CC-044).

## 3. Principles

1. **Minors first (ADR-028, ADR-048).** Unknown age counts as a minor, so guests and every account without a birth
   year get the under-18 defaults. Their names are hidden on public boards, share cards and feeds; they get no
   push, no emotes, no follow, a friends-only profile and circles by invite only (PRODUCT_VISION.md §5.12). A
   feature that cannot meet this for minors ships for adults only, never with weaker defaults.
2. **No dark patterns.** Every nudge is checked against India's Guidelines for Prevention and Regulation of Dark
   Patterns, 2023 (CCPA, notified 30 November 2023, 13 named patterns including false urgency, confirm shaming,
   forced action, nagging, interface interference, disguised advertisement and bait and switch. General knowledge,
   high confidence. The official PDF could not be read by the fetcher, so CC-229 checks the text). No referral
   rewards, no streak guilt, no fake people in queues (ADR-025.1).
3. **DPDP.** The Act bars tracking and behavioural monitoring of children and needs verifiable parental consent for
   a child's data (s. 9, from 13 May 2027, ADR-028.9). Social features store the least they can: relations by
   player id, never contacts, phone numbers or free text.
4. **ADR-031 caps.** Asked-for messages (a challenge, your move, a friend accepted) at most 1 per opponent every 15
   minutes and 10 a day, bundled at 3; adults only for push; at most one unasked contact a day across all channels;
   quiet hours; one-tap opt out. Minors and unknown ages: inbox only.
5. **Privacy by default.** A link reveals nothing about who is behind it (ADR-042.2). A player can be found only by
   someone they chose to share a link with or played with. No search by name, no public directory of players or
   circles, no presence for strangers.
6. **Real data only.** No fake activity, no "N playing now" before its gate, no bots shown as people, no invented
   social proof. Every number shown to players comes from stored game records.
7. **Liquidity gates (ADR-029).** Crowd features (find a person as the main button, top 5 on a game page, leaderboard
   tabs, circle board and arena) switch on only past their threshold, and show the honest fallback before that.
8. **Only people you met.** Every action on another player (block, report, challenge again, add friend) names them
   by a room code, match id or seat, never by a typed player id (OWASP IDOR, CC-044 research).

## 4. Research

### 4.1 How our code does it today

1. **Invites.** `components/ShareRoom/ShareRoom.jsx` offers Copy link and the device share sheet with English text
   `Play <game> with me on ClassiCade — room <code>`, only while the room is waiting. A waiting room closes 30
   minutes after its last activity and a finished room 30 minutes after the game (`roomLifetimes.js`), so an invite
   left in a WhatsApp group is dead by the evening. A closed room explains why (`RoomPage.jsx`, CC-101) and links to
   a new game. The result screen has no share (CC-217 research).
2. **Previews** are general and never look the room up (ADR-042.2). Two of the four preview PNGs are over 300 KB.
3. **Profile.** `/profile` is the player's own page (`ProfilePage.jsx`): stats, recent matches with the opponents'
   names, account and privacy settings, the birth year. There is no public profile, no avatar and no way to see
   another player.
4. **Leaderboards** (ADR-015) are public, accounts only, and show "Hidden player" for every account that is not an
   adult, worked out when the board is read (`leaderboardComponent.js`, `accountComponent.adultsAmong`, CC-152,
   ADR-048.10). The ADR-029 fallback for a tab with fewer than 25 entries is not built (CC-228); CC-259 adds a line
   on how to get on a small board. The weekly reset is still 00:00 UTC (ADR-015 amendment waits for CC-146).
5. **Room views** send every seat's player id to anyone with the link (CC-253).
6. **Nothing else exists:** no friends, no challenges, no block or report, no inbox, no push, no emotes, no quick
   match with people (only "Play Rocky", CC-221).

### 4.2 How others do it

**Lichess** (source code, https://github.com/lichess-org/lila, read 2026-10-19):

1. **Kid mode.** An account flag (`KidMode` in `modules/core/src/main/user.scala`). With it on, the chat's
   discussion tab is not shown at all (`ui/lib/src/chat/chatCtrl.ts`), and a new private conversation is allowed
   only between a kid and their teacher in a class, or between two kids where the class allows it
   (`modules/msg/src/main/MsgSecurity.scala`, `kidCheck`). Blocks are checked before any message.
2. **Who can reach you is a preference** (`modules/pref/src/main/Pref.scala`): challenges "Never", "If rating is ±
   300", "Only friends", "If registered" (the default), "Always"; messages "Only existing conversations", "Only
   friends", "Always"; and whether others may follow you.
3. Blocked pairs are never paired, and reporting for abuse also blocks (CC-044, CC-051 research).

**Chess.com** (general knowledge, medium confidence): friends, challenges and clubs with no heavy feed; a setting
for who may challenge you and send you messages; children under 13 are sent to ChessKid, a separate Chess.com site
"intended primarily for chess players under the age of 13" (https://en.wikipedia.org/wiki/ChessKid), with no free
chat between children (general knowledge, medium confidence).

**Board Game Arena** (general knowledge, medium confidence; its code of conduct page did not resolve for the
fetcher): friends and a personal list of players you do not want to play with, a reputation signal from other
players after games, and volunteer moderators. The lesson for a small team is a personal block list that needs no
moderator, which CC-044 already plans.

**Ludo King** (https://en.wikipedia.org/wiki/Ludo_King): private rooms with friends, Facebook invites, voice chat
from August 2020, local play for up to six on one device; audience up 50 to 75% in India's 2020 lockdown and 26
million downloads in April 2020. The lesson is that Indian family and friend play happens on one phone and through
private rooms shared in chats, not through a public graph. That supports pass and play (CC-223) and invite links
first.

**Wordle** (https://en.wikipedia.org/wiki/Wordle): a text-only share that shows the result without spoiling it grew
the game from 90 players to more than 2 million in about 10 weeks. No names, no account, no reward. This is the
model for CC-217's share text.

**Discord** (general knowledge, medium confidence; its safety pages refused the fetcher): for teens, DMs from
people they do not know get safety alerts and sensitive media is blurred by default (Teen Safety Assist, 2023);
Family Center lets a parent see who a teen talks to and which servers they join, without the messages, and only
after the teen agrees.

**Roblox** (https://en.wikipedia.org/wiki/Roblox): after child safety lawsuits, an age check became required for
any chat (global from January 2026). "Trusted Connections" (17 July 2025) unlock unfiltered chat between a 13 to 17
year old and an adult only after they prove they know each other in real life, by scanning each other's QR code or
importing phone contacts. The lesson: contact between a minor and a stranger is the risk, and "people you know in
real life" is the line large platforms draw. For us, sharing a link by hand is that proof, which is why minors may
reach only people they met through a link they shared or received.

**Duolingo Friend Streak** (https://blog.duolingo.com/friend-streak/, 5 August 2024): a streak shared with up to five
friends, started only when the friend accepts (mutual), kept when both do a lesson that day, with a "nudge" to a
friend. The mutual start and the small cap fit CC-213; the nudge is an asked-for message under ADR-031 only if the
friend turned it on.

**Steam and Xbox** (general knowledge, high confidence): a "recently played with" or "recent players" list lets a
player find someone from a past game and add or invite them, without search by name. That supports CC-277.

### 4.3 Viral loops without dark patterns

1. **Share the result, not a reward.** Wordle's loop worked with no incentive. Duolingo's reward referrals added
   about 3% (cited in PRODUCT_VISION.md), and coin rewards come close to stakes under the Online Gaming Act. So
   CC-149 (referral rewards) should be cut, not deferred (owner to confirm).
2. **The player sends, we never send.** `wa.me` opens WhatsApp with our text and the player picks the chat. No
   contact upload, no "invite all", no auto-post. Contact upload is also personal data of third parties the player
   cannot consent for (DPDP, general knowledge, high confidence).
3. **The link must work when tapped.** A link that is dead by evening loses the loop; CC-139 makes challenge links
   last and gives an honest expired page.
4. **Measure without ids.** k is the ratio of daily totals (EVENTS.md §4). A channel marker on the link (`via=wa`)
   is enough to tell WhatsApp shares from copies, without any player or share id (CC-279).

### 4.4 Moderation for a small team

1. **Prevent before you moderate:** no free text, emotes from a fixed set, filtered names (ADR-022), reaching only
   people you met. Most harm a moderator would see cannot happen.
2. **Personal tools first:** block and mute need no moderator (Lichess, BGA).
3. **One queue, urgent first**, closed reasons, auto block on report, and reporters whose reports are always
   dismissed set aside (Lichess `reportban`). Plan in CC-044.
4. **India, IT Rules 2021 as amended in 2022:** a published Grievance Officer, acknowledgement within 24 hours,
   resolution within 15 days, 72 hours for removal requests, records for 180 days (CC-044 research, to be checked
   against the gazetted text by the lawyer).
5. **Help for a child in danger:** Childline 1098, cybercrime.gov.in and 1930, shown at once on an urgent report.

### 4.5 India specifics

1. WhatsApp is where Indian groups form and share (PRODUCT_VISION.md §6.8), so every invite and circle link must
   preview well in WhatsApp (image under 300 KB, tags in the first 300 KB, CC-217 research).
2. Families share one phone (Meena persona): pass and play and no push to a shared device's children.
3. Hinglish text written by a native speaker (the owner), not machine translated.
4. After the Online Gaming Act many parents link games with losing money: no stakes, no rewards for inviting, and
   "No betting. No cash. Ever." stays visible (PRODUCT_VISION.md §6.10).
5. DPDP provisions apply in steps (13 November 2026 and 13 May 2027); parental consent (ADR-028.9) before May 2027.

## 5. The domain's tickets

Status is from [BACKLOG.md](../BACKLOG.md) on 2026-10-19. "Order" is the build order of §8.

| Order | Ticket | Title (short)                                                        | In or out                                   | Status          | Phase |
| ----- | ------ | -------------------------------------------------------------------- | ------------------------------------------- | --------------- | ----- |
| 1     | CC-217 | WhatsApp share cards, button, Hinglish text, no minor or guest names | In                                          | ⬜ Todo         | 1     |
| 2     | CC-044 | Block, mute (the rule), report, reports queue, grievance contact     | In (safety folded in, §2.3)                 | ⬜ Todo         | 1     |
| 3     | CC-051 | Quick match: "Find a person", 4 s, honest fallback                   | In (pairing; the room is Match experience)  | ⬜ Todo         | 1     |
| 4     | CC-279 | Share links carry a channel marker for the k-factor (proposed)       | In (Growth reads it)                        | ⬜ Todo         | 1     |
| 5     | CC-223 | Pass and play on one phone                                           | In                                          | ⬜ Todo         | 1     |
| 6     | CC-100 | Invite chooser focus ring on page load                               | In (small bug)                              | ⬜ Todo         | 2     |
| 7     | CC-253 | Room views send player ids: decide before public profiles            | In (shared with Match experience)           | ⬜ Todo         | 0     |
| 8     | CC-139 | Persistent challenges at `/challenge/:id`, honest expired page       | In                                          | ⬜ Todo         | 2     |
| 9     | CC-147 | Notifications inbox, then an email digest                            | In (the channel; reminder content is Prog.) | ⬜ Todo         | 2     |
| 10    | CC-034 | Public profile, avatars                                              | In                                          | ⬜ Todo         | 2     |
| 11    | CC-278 | Privacy and safety settings (proposed)                               | In                                          | ⬜ Todo         | 2     |
| 12    | CC-277 | "Play again with": recent opponents (proposed)                       | In                                          | ⬜ Todo         | 2     |
| 13    | CC-052 | Friends, presence, direct challenge                                  | In                                          | ⬜ Todo         | 2     |
| 14    | CC-140 | Friends filter on leaderboards, head to head                         | In                                          | ⬜ Todo         | 2     |
| 15    | CC-169 | Emotes: six mascot emotes, mute switch, off for under 18             | In                                          | ⬜ Todo         | 2     |
| 16    | CC-222 | Turn-based games with "your move" in the inbox                       | In (engines and shell: Match experience)    | ⬜ Todo         | 2     |
| 17    | CC-214 | Circles, safe circle rules                                           | In                                          | ⬜ Todo         | 2     |
| 18    | CC-229 | Dark pattern audit before web push                                   | In (gates CC-148)                           | ⬜ Todo         | 2     |
| 19    | CC-215 | Notification preferences and quiet hours                             | In                                          | ⬜ Todo         | 2     |
| 20    | CC-148 | PWA manifest and opt-in web push                                     | In                                          | ⬜ Todo         | 2     |
| 21    | CC-226 | "Ping me when a person is free", behind its gate                     | In                                          | ⬜ Todo         | 2     |
| 22    | CC-213 | Duo Streaks between two friends                                      | In                                          | ⬜ Todo         | 3     |
| 23    | CC-206 | Friends and circles feed; follow for adults only                     | In                                          | ⬜ Todo         | 3     |
| —     | CC-053 | Leaderboards (the public boards)                                     | In as a surface (scores: Progression)       | ✅ Done         | —     |
| —     | CC-152 | Birth year and under-18 defaults (hidden names)                      | Out (Accounts), read by every ticket here   | 🟦 (merged #82) | 2     |
| —     | CC-023 | Share menu                                                           | In                                          | ✅ Done         | —     |
| —     | CC-047 | Link previews and head tags                                          | In (shared with Growth)                     | ✅ Done         | —     |
| —     | CC-043 | Share result cards; emotes                                           | Close: replaced by CC-217 and CC-169 (§7)   | ⬜ Todo         | 2     |
| —     | CC-068 | Clubs/groups                                                         | Close: replaced by CC-214 (§7)              | ⬜ Todo         | —     |
| —     | CC-149 | Referral rewards with abuse caps                                     | Cut recommended (§7)                        | ⬜ Todo         | Defer |
| —     | CC-056 | Spectating                                                           | Out: move to Match experience (§7)          | ⬜ Todo         | Defer |
| —     | CC-185 | Rename prompt for names that break the rules                         | Out (Accounts); reports feed it             | ⬜ Todo         | 2     |
| —     | CC-058 | Social login                                                         | Out (Accounts)                              | ⬜ Todo         | Defer |
| —     | CC-059 | Admin console roles and feature flags                                | Out (owner console); bans wait for it       | ⬜ Todo         | 3     |
| —     | CC-060 | Anti-cheat signals                                                   | Out (Match experience)                      | ⬜ Todo         | 3     |
| —     | CC-141 | Weekly leagues                                                       | Out (Progression), uses CC-140's filter     | ⬜ Todo         | 3     |
| —     | CC-210 | Weekly arena                                                         | Out (Progression), uses CC-051's pool       | ⬜ Todo         | 3     |
| —     | CC-067 | Tournaments                                                          | Out (Progression)                           | ⬜ Todo         | Defer |
| —     | CC-144 | Daily set with a spoiler-free share grid                             | Out (Progression), reuses CC-217's text     | ⬜ Todo         | 2     |
| —     | CC-228 | Liquidity gate flags                                                 | Out (Growth); gates CC-051, CC-140, CC-214  | ⬜ Todo         | 1     |
| —     | CC-123 | Brand domain                                                         | Out (Growth); needed for the grievance mail | ⬜ Todo         | 1     |

## 6. Proposed new tickets

Added at the owner's request for this domain plan (an exception to the feature freeze of the working agreement,
rule 1, asked for by the owner). Each has a ticket file with a Research section. Only what the research supports.

| ID     | Title                                                                                                                    | Why (one line)                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-277 | "Play again with": recent opponents from match history, with Challenge again through CC-139                              | Today a person you played is lost once the room closes after 30 minutes; Steam and Xbox recent players lists are how people find each other again without name search |
| CC-278 | Privacy and safety settings: who can challenge or add me, profile visibility, emotes, blocked players, locked for minors | Every social ticket needs one place for its switches (Lichess `Pref`, PRODUCT_VISION.md §5.12), and minors' defaults must be visible and locked with a "why"          |
| CC-279 | Share links carry a channel marker (`via`), counted with no id, so the k-factor sees result shares                       | CC-217's result share links to the game page, which EVENTS.md's `room_link` entry does not count, so the ADR-032.2 launch gate would under-count k                    |

**Not proposed, and why:**

1. **A friends list.** CC-052 already is one (friends, presence, direct challenge).
2. **A moderation queue in the owner console.** CC-044's second PR builds it (the Reports page, urgent first). A
   separate ticket would split one PR's scope.
3. **A grievance page.** Also in CC-044 (the contact on the terms and privacy pages), and it needs CC-123's domain.
4. **Search by name, contact import, a public circle directory, chat.** The research says no (§3.5, §4.3, ADR-028).

## 7. Proposed moves

1. **Close CC-043 as replaced.** Its two halves are now CC-217 (share cards) and CC-169 (emotes), with the rules of
   ADR-028.6 and .7. Keeping it open counts the same work twice. Same pattern as CC-068.
2. **Close CC-068 as replaced by CC-214** (its row already says so; it is still ⬜ and counted as open).
3. **Cut CC-149 (referral rewards)** instead of Defer: GROWTH.md §3.8 and the stakes risk say no rewards for
   referrals (owner to confirm).
4. **Move CC-056 (spectating) to Match experience.** Watching a game is a room feature (a spectator seat already
   exists in `room_joined.as`). Social only decides who may watch whom later (friends only, never a minor's game for
   strangers), which goes in CC-278.
5. **Widen Social to include safety and moderation** (§2.3) rather than making a new domain.
6. **Widen Social to include notifications between players** (CC-147, CC-148, CC-215, CC-229): the first and main
   senders are challenges, your move and friend requests. Progression's reminders use the same channel and caps.

## 8. Build order and parallel groups

Phase 0 still comes first for the whole board (BACKLOG.md "Order of work"). Within this domain:

1. **Group A, phase 1 (in parallel, no shared files):**
   - CC-217 (ShareRoom, the result block, `og/` images).
   - CC-044 PR 1, blocks (`roomComponent` seat and rematch refusals, `Seats` menu, a new store).
   - CC-223 (pass and play, on the game shell).
2. **Group B, phase 1, after A:**
   - CC-044 PR 2, reports and the queue (needs the owner's Grievance Officer answer).
   - CC-051 "Find a person", after CC-044's block PR, live only after both CC-044 PRs (ADR-028.8).
   - CC-279, after CC-217's text PR and the telemetry client (CC-174).
3. **Group C, phase 2 start (in parallel):** CC-253 (a decision, then opaque seat ids if chosen), CC-139
   (challenges), CC-147 (inbox), CC-100 (small).
4. **Group D:** CC-034 then CC-278 (same profile files, so in sequence), in parallel with CC-169 (emotes, after
   CC-153's mascot) and CC-222 (turn-based, after CC-147 and CC-224).
5. **Group E:** CC-277 (after CC-139), CC-052 (after CC-034, CC-139, CC-278), then CC-140 (after CC-052).
6. **Group F:** CC-214 (after CC-052, gated board), and the push line in sequence: CC-229, CC-215, CC-148. CC-226
   after CC-148 and its ADR-029 gate.
7. **Phase 3:** CC-213, CC-206.

Every ticket starts with its Research section (working agreement rule 4). Tickets that already have one: CC-217,
CC-044, CC-051. The rest get theirs when started.

## 9. Decisions

Recorded together as the open **ADR-051** in [DECISIONS.md](../DECISIONS.md).

| #   | Decision                                                                                                                                              | Recommendation                                                                                                                     | Status                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | The domain's scope and boundaries (§1, §2)                                                                                                            | As written                                                                                                                         | Owner to confirm       |
| 2   | Safety and moderation inside this domain, not its own (§2.3)                                                                                          | Inside, revisit on free text, a second moderator or about 20 reports a week                                                        | Owner to confirm       |
| 3   | **Grievance Officer (open from #86).** Who handles reports and whose name is published, with 24 h to acknowledge and 15 days to close (IT Rules 2021) | The owner at first, with a role address `grievance@<domain>` after CC-123; until then the in-app report only, and the page says so | Owner to decide        |
| 4   | **Quick match hours (open from #86).** "Find a person" shown at every hour, or only 19:00 to 23:00 IST                                                | Every hour: the honest "Nobody is free" costs 4 s, and the ADR-029 gate can only measure hours where the button exists             | Owner to decide        |
| 5   | Chess quick time controls (from #86): 3+2 and 10+0, or one pool while the crowd is tiny                                                               | One pool (3+2) until the find-a-person gate opens for chess, so players are not split                                              | Owner to decide        |
| 6   | The Hinglish share lines, and whether an English line stays beside them (CC-217)                                                                      | The owner writes them; keep a short English line                                                                                   | Owner to decide        |
| 7   | Can minors have friends? ADR-028.2 does not say; the vision's social loop says "adults, mutual accept"                                                | Yes, mutual, but only with someone they met through a link or pass and play, never from quick match, and never findable            | Owner to confirm       |
| 8   | What a stranger sees in a quick match room: the username or "Player 2"                                                                                | The chosen, filtered username (needed to recognise and report), with opaque seat ids (CC-253)                                      | Owner to confirm       |
| 9   | "Play again with" for minors (CC-277)                                                                                                                 | Listed for everyone, but a minor can challenge again only players met through a link, never quick match strangers                  | Owner to confirm       |
| 10  | Close CC-043 and CC-068 as replaced; cut CC-149; move CC-056 to Match experience (§7)                                                                 | Yes                                                                                                                                | Owner to confirm       |
| 11  | Free text in reports for adults (from CC-044)                                                                                                         | Not now; revisit with decision 2                                                                                                   | Owner to decide        |
| 12  | An adult's own name on their share card, after CC-152                                                                                                 | Off by default, a choice per share, never the opponent's name                                                                      | Owner to decide, later |
