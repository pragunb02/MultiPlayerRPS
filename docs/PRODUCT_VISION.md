# ClassiCade product vision

Owner: Pragun Bhutani. Written by: head of product. Date: 17 October 2026. Status: accepted by the owner on 17 October 2026. Revision 2 answers every point in the review (see Appendix A).

This document says what ClassiCade is for, who it is for, what we build first and why, and how we will know it is working. Five research tracks back it, all done on 17 October 2026: competitive classic game sites, casual web portals, gamification and social loops, the Indian market, and an audit of ClassiCade today. On the same day I fetched more pages to answer the review: the MongoDB Atlas free tier limits, Render regions and pricing, the Lichess puzzle database and Ultimate Tic Tac Toe. Claims cite their source inline. A claim that rests on general knowledge rather than a fetched page says so and gives a confidence level. Numbers marked "estimate", "target", "guess" or "assumption" are exactly that. Where a study only shows that two things go together, this document calls it a "correlation". It says "experiment" only where the source reports a controlled test.

## 1. Vision and promise

**Vision.** ClassiCade is the arcade for the games everyone already knows. Rock Paper Scissors, Tic Tac Toe and Chess, made as fast, fair and fun as a modern game. Open a link on your phone and you are playing in seconds, against a friend, your family on the same phone, or one of our characters. Each match ends with a reason to play one more. Each day brings a small reason to come back: a streak, the daily chess puzzle, a rival in story mode, a friend's move waiting for you. We start in India, on budget Android phones and in WhatsApp groups. We grow by making three games deep and polished before we add a fourth.

**Our promise to players.**

1. You are playing within 10 seconds. No install, no sign up. You never sit in an empty waiting room, because a character is always ready to play.
2. There is always someone to play. A ClassiCade character is always ready, and it is always clearly labelled as a bot. When people are online we also find you a person.
3. It is fair. The server decides every result. A character in Rock Paper Scissors locks in its throw before you choose, and you can check it. Chess ratings are honest, and we do not rate games that are mostly luck or solved.
4. It is free. Every game, every opponent, every story level and every rated match stays free forever.
5. No betting. No cash. Ever.
6. It is safe for kids by default. Anyone whose age we do not know gets the child settings. No open chat, and no strangers following children.
7. We never take away what you earned. Missing a day can reset a streak, but your longest streak, levels, badges and items stay forever. We send at most one reminder a day, and you can turn it off from the reminder itself. Section 6.5 lists every penalty we allow.

**What ClassiCade is.**

1. A web game site with art, sound and celebration, not a utility page.
2. A small set of classic games, each with real depth: chess with ratings and puzzles, Tic Tac Toe with an Ultimate mode, Rock Paper Scissors against characters whose habits you can learn.
3. Social first: friends, small private groups (circles), play on one shared phone, and challenge links shared on WhatsApp.
4. A world with characters. Bit the robot mascot, rivals in story mode, and later a guest character each season.

**What ClassiCade is NOT.**

1. Not a real money or betting platform, now or later. India's Online Gaming Act 2025 bans online money games, skill games included. Coins that can be turned into money count as stakes, and penalties go up to 3 years in prison and a ₹1 crore fine (source: PRS Legislative Research summary of the Bill, https://prsindia.org/billtrack/the-promotion-and-regulation-of-online-gaming-bill-2025, fetched 2026-10-17). I could not fetch the gazetted Act or Rules (the MeitY site returned 403). The legal review in section 6.10 must use the official gazette text, not this summary.
2. Not a catalogue of hundreds of games. Poki has 1,500 games and CrazyGames about 4,500 (source: https://poki.com/en and https://en.wikipedia.org/wiki/CrazyGames, fetched 2026-10-17). We cannot win on count and will not try.
3. Not a deep chess training site. Chess.com has 650+ staff (source: https://www.chess.com/about, fetched 2026-10-17), and Lichess and Chess.com already give free training. We are the place to play chess with your friends, not the place to study openings.
4. Not a chat app or an open social network. Players talk through emotes and challenges, not free text.
5. Not ad funded in phases 1 and 2. This changes the BRD, which lists ads in the free tier, so it is an owner decision (section 10, D9).

## 2. Who it is for

India first, mobile first. India had 1,114 million internet subscribers in June 2026 (source: https://www.trai.gov.in/, updated 2026-10-16). In September 2026, 77.3% of Indian web traffic came from mobile, and 93.9% of Indian mobile devices ran Android (source: https://gs.statcounter.com/os-market-share/mobile/india, September 2026). India has about 450 million online gamers, 100 million of them daily (source: EY 2024 via https://en.wikipedia.org/wiki/Video_games_in_India, fetched 2026-10-17). About 41% of Indian gamers are women (source: Lumikai and Google 2023, same page). The BRD goal of 10,000 weekly players is about 0.0022% of those 450 million (10,000 divided by 450,000,000). Distribution and retention will limit growth, not market size.

**Primary personas for phases 1 and 2: Riya (an adult friend group), Meena (a family) and the drop-in searcher.** Riya and Meena bring groups and repeat play with people they know, and the searcher brings volume. Arjun is served by the same features as Riya. Kabir is served safely but not prioritised: what he wants, Lichess and Chess.com already give him free and better, he is locked to friends only so he brings no growth, and prioritising him would make parental consent a phase 1 dependency. Ms Fernandes is a phase 3 opportunity. Competitive blitz players like Vikram get chess ratings and the daily puzzle. We do not design for them beyond that.

| #   | Persona                                                               | Context                                                                                                                                          | Jobs to be done                                                                                                           | What wins them                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Riya, 19, college student, Pune (primary)**                         | Budget Android phone, patchy 4G, a hostel WhatsApp group of 12                                                                                   | "Kill five minutes between lectures." "Prove to my group I am the best at Stone Paper Scissors."                          | A WhatsApp link that opens straight into a game. A circle leaderboard for her hostel. A share card. Hinglish copy. Turn-based Tic Tac Toe she can play between lectures.                                                                                                                                                                                                                                                      |
| 2   | **Meena, 41, parent, Lucknow (primary)**                              | One family phone, kids aged 9 and 12, a family WhatsApp group                                                                                    | "Something safe and free to play with my kids, sitting together or apart." "No ads I have to explain and no money traps." | **Pass and play on one phone**, a family circle, pictures for rules, no ads, nothing to buy, and "No betting. No cash. Ever." Ludo King ships local play for up to 6 on one phone, and 75% of its players are Indian (source: https://en.wikipedia.org/wiki/Ludo_King, fetched 2026-10-17). playtictactoe.org shows how cheap two players on one device is to build (source: https://playtictactoe.org/, fetched 2026-10-17). |
| 3   | **The drop-in searcher (any age, primary)**                           | Arrives from Google ("tic tac toe vs computer hard") or a shared link, on any device                                                             | "Play right now. Do not make me sign up."                                                                                 | One tap to a named character, then a save progress prompt after the first win, never before. Poki says players "move to another game if loading takes more than 10 seconds" (source: https://developers.poki.com/guide/requirements-quality, fetched 2026-10-17).                                                                                                                                                             |
| 4   | **Arjun, 29, office worker, Bengaluru (served)**                      | Laptop at lunch, phone on the commute                                                                                                            | "A quick social break that does not look like gambling." "Settle who buys the chai."                                      | Challenge links, best of 5 series, an office circle. Same features as Riya.                                                                                                                                                                                                                                                                                                                                                   |
| 5   | **Kabir, 15, school chess player, Chennai (served, not prioritised)** | Inspired by Gukesh becoming world champion on 12 Dec 2024 (source: https://en.wikipedia.org/wiki/Gukesh_Dommaraju, fetched 2026-10-17). A minor. | "Beat my classmates." "See my rating go up."                                                                              | Chess rating with a graph, the daily puzzle, characters at his level. Locked safe defaults: friends only, no follows, emotes off, his name never shown publicly.                                                                                                                                                                                                                                                              |
| 6   | **Ms Fernandes, 34, school teacher, Goa (phase 3)**                   | Runs a lunch-break chess and games club for 30 students                                                                                          | "Run a safe class tournament without student emails or ads."                                                              | A teacher circle with a class code, students joining with no personal data, an arena for the circle, a printable results sheet. papergames.io sells a "Gruppo" plan for families, classrooms and teams (source: https://papergames.io/en/, fetched 2026-10-17), and CC-070 (private events) points the same way.                                                                                                              |

## 3. Product principles

When two principles conflict, the one higher on the list wins.

1. **Play in 10 seconds, sign up later.** Load in under 10 seconds, never require login, and get at least 65% of visitors to a first move (source: https://developers.poki.com/guide/requirements-quality and https://developers.poki.com/guide/reading-results, fetched 2026-10-17). Until people are often online, **the main button is a named character ("Play Rocky")**, and "Find a person" is a second button. The search for a person lasts at most 4 seconds (section 4.1). Render's free plan sleeps after 15 minutes of no traffic and takes about a minute to wake (source: https://render.com/docs/free, fetched 2026-10-17). That alone breaks this promise, so always-on hosting is product work.
2. **Nobody plays alone and nobody is fooled.** No account has a counted result on production yet (source: GET /api/leaderboards/overall, /weekly and /chess all returned empty entries on 2026-10-17). So a solo visitor needs a character. Chess.com's five cat bots played about 120 million games in January 2023, the month with 40% more games than any before (source: https://en.wikipedia.org/wiki/Mittens_(chess), fetched 2026-10-17). That happened on a site that already had about 10 million daily users and wide streamer coverage (source: https://www.chess.com/blog/CHESScom/chess-is-booming-and-our-servers-are-struggling, January 2023). **Characters keep the players who arrive. They do not bring players in.** Every bot is labelled, and bot games never count toward a rating or a leaderboard (to be decided in ADR-025, section 10).
3. **Three games made deep before a fourth.** Tic Tac Toe is solved and Rock Paper Scissors between people is mostly chance. "Perfect" therefore means depth, not just polish. Ultimate Tic Tac Toe has not been solved under standard rules and has real strategy (source: https://en.wikipedia.org/wiki/Ultimate_tic-tac-toe, fetched 2026-10-17). Rock Paper Scissors gets characters whose habits you can learn. Chess gets ratings and puzzles. Our match audit found 6 P0 problems (source: docs/ux/MATCH_EXPERIENCE.md, 2026-10-17). Adding games would multiply them. papergames.io already offers more games than us (source: https://papergames.io/en/), so a longer list is no advantage.
4. **Free to play, never pay to win, no betting ever.** Lichess runs more than 5 million games a day with no ads and nothing behind a paywall (source: https://lichess.org/about, fetched 2026-10-17). Chess.com charges for learning tools, never for opponents (source: https://www.chess.com/membership, fetched 2026-10-17). Coins are never cashed out, traded, wagered or given as prizes, and story levels are never sold (source: docs/story/STORY_MODE.md, "Nothing to buy").
5. **Safe for minors by default, and unknown age means minor.** The FTC fined Epic $275 million partly because voice and text chat were on by default for children, and Epic must now switch chat off by default for children and teens (source: https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations, 2022-12-19). India's DPDP Act bars tracking and behavioural monitoring of under-18s, with the remaining provisions in force from 13 May 2027 (source: https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Act,_2023, fetched 2026-10-17). Guests and accounts without a stated birth year get the under-18 defaults. Under-18 defaults (CC-152) ship before any social feature.
6. **Bring back the players we have before chasing new ones.** In Duolingo's growth model, raising the return rate of current users moved daily users about 5x more than the next-best lever. That figure is a model sensitivity, not an experiment. Duolingo's referral programme added only 3% new users (source: https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth, 2023). We judge each feature by one question: does it bring an existing player back tomorrow? We only ask it once the players exist (principle 12).
7. **People you know beat strangers.** Duolingo users with at least one friend streak were 22% more likely to do their daily lesson. That is a correlation: people who choose friend streaks may be keener to begin with (source: https://blog.duolingo.com/friend-streak/, 2024-08-05). During the 2020 nationwide lockdown, Ludo King's average daily play rose from 32 to 49 minutes (source: https://en.wikipedia.org/wiki/Ludo_King). The source does not say why. Our research reads it as private rooms with family and friends, but the lockdown itself is a strong confounder. Taken together, the evidence points to people you know, so we treat it as a strong hint, not a proof.
8. **Every match ends with a next step.** Poki's core loop is about 3 minutes, and web players have shorter sessions and come back less often than mobile players, so the first session matters most (source: https://developers.poki.com/guide/engagement, fetched 2026-10-17). The result screen always offers Rematch first.
9. **Celebrate one beat at a time.** On a first win today, five toasts cover 85% of a phone screen (source: docs/ux/MATCH_EXPERIENCE.md, finding A9). In an experiment, Duolingo's new streak animation raised new learners' day 7 return by 1.7% (source: https://blog.duolingo.com/how-duolingo-streak-builds-habit/, 2022-01-31). On a phone, at most two lines sit above the Rematch button.
10. **Fast on a budget Android phone in India.** Our assumed target device is a ₹8,000 to ₹15,000 Android phone on patchy 4G (assumption, general knowledge, medium confidence). From a research machine whose location is unknown, production took 3.65 seconds to first byte, served from Oregon. The main script is 132 KB compressed, and there is no installable app (PWA) yet (source: curl against https://nocapgaming.onrender.com, 2026-10-17). We must measure from India before we use any number as a baseline (section 6.11).
11. **No guilt, and no dark patterns.** India's Central Consumer Protection Authority Guidelines for Prevention and Regulation of Dark Patterns, 2023 name 13 patterns. They include false urgency, confirm shaming, nagging, subscription trap, basket sneaking and drip pricing (general knowledge, high confidence. The official notification was not fetched, and Wikipedia's dark pattern page has no India content, checked 2026-10-17). Section 6.9 checks every nudge we use against these patterns. Battle passes draw criticism for fear of missing out and grind, and some newer passes, such as Halo Infinite's and Marvel Rivals', never expire (source: https://en.wikipedia.org/wiki/Battle_pass, fetched 2026-10-17). Do not ask for push permission on the first visit, and send fewer notifications (source: https://www.nngroup.com/articles/push-notification/, fetched 2026-10-17).
12. **Measure first, and switch on only what the crowd can fill.** We have no analytics today (CC-045 and CC-173 to CC-178 are all to do). At Duolingo, a mechanic copied from another game made no measurable difference (source: Lenny's Newsletter, as above). Any feature that needs a crowd, such as arenas, leagues, live counts or rarity percentages, stays hidden until a measured threshold is met (section 6.0). An empty arena tells players the site is empty.

## 4. Core loops

Each loop shows the steps, the mechanic, the emotional payoff and the metric it moves. The phase in brackets says when the loop goes live.

### 4.1 First session: the first 60 seconds (phase 1)

```
Open link or home page
   │  warm server in Singapore, first route under 150 KB (target)
   ▼
Home: three art tiles. Main button on each: [Play Rocky] / [Play Pip] / [Play Queen Vee]
   │  second button: [Find a person]   third: [Play a friend] and [Pass and play]
   ▼ one tap on the main button
Board appears with "Rocky · bot" in under 1 s. A ghost hand shows "tap a throw". No rules text.
   │
   ▼ first move within 10 s of arrival
Win (likely, the first sessions aim at 65 to 70% wins), draw or gentle loss
   ▼
One celebration line, one reward line: "+30 XP"
   ▼
[Rematch] (main)   [Find a person]   [Challenge a friend]
```

If the player taps "Find a person", the search runs for at most 4 seconds (3 seconds once we have data) while a strip says "Looking for a player... Rocky is ready if nobody is free". If nobody is found, the character's board opens with no extra tap. "Nobody free" is never shown. The timeout is set from the measured match rate in each hour (section 6.0). When more than 60% of searches in an hour slot find a person within 4 seconds, "Find a person" becomes the main button for that slot.

**Time budget per entry type (targets at the 75th percentile, warm server, target device on 4G).** These are design targets, not measurements.

| Entry                                         | Load to interactive | Search    | Tap and seat                                        | Player's first move | Total target                 |
| --------------------------------------------- | ------------------- | --------- | --------------------------------------------------- | ------------------- | ---------------------------- |
| Home, main button                             | 2.5 s               | none      | 0.5 s tap plus 0.3 s seat                           | 2.5 s               | 6 s                          |
| Home, "Find a person"                         | 2.5 s               | up to 4 s | 0.5 s                                               | 2.5 s               | 9.5 s                        |
| Game page from search                         | 3 s                 | none      | 0.8 s                                               | 2.5 s               | 6.5 s                        |
| Invite link, friend waiting                   | 3 s                 | none      | 1 s ("Play as guest" choice)                        | 2 s                 | 6 s                          |
| Invite link, friend gone                      | 3 s                 | none      | 1 s plus offer of the same character                | 2.5 s               | 7 s                          |
| Shared result card                            | 3 s                 | none      | 0.8 s into "beat their score" vs the same character | 2.5 s               | 6.5 s                        |
| Any entry after a cold start on the free plan | about 60 s          |           |                                                     |                     | fails, so phase 0 removes it |

1. Mechanic: a named character as the main action (CC-051 and proposed CC-221), a labelled bot (CC-138), a gentle starting strength (CC-150) and a parallel search for a person.
2. Emotional payoff: "That was instant, and I won."
3. Metrics moved: time to first move, conversion to play, and the second match rate.

### 4.2 First session: the first 10 minutes (phase 1, story and puzzle parts in phase 2)

```
Match 1 ─► Rematch (series "1-0") ─► Match 2 ─► Match 3
   │
   ▼  after the first win or a level-up
"Save your stars and XP" sheet (CC-097). Easy skip. Shown at most 3 times in total.
   │
   ▼  result screen offers one new kind of play
Phase 1: "Try Pass and play with someone next to you" or "Try chess vs Queen Vee"
Phase 2: "Quest: Rocky wants a rematch [Enter]" or "Today's chess puzzle [Solve]"
   ▼
Leave with one visible reason to return (phase 2): streak at day 1, "come back tomorrow for day 2"
```

1. Mechanic: chained matches, a cross-game suggestion, then the story door and the daily puzzle in phase 2.
2. Emotional payoff: "I have a level and a rival. This place knows me."
3. Metrics moved: games per session, session length, guest to account conversion, day 1 return.

### 4.3 Daily loop (phase 2)

```
Optional reminder at the player's usual hour (opted in only, at most one a day)
   ▼
Home: streak · 3 quests · chess daily puzzle · "Riya played her move" (turn-based)
   ▼
Daily: chess puzzle (from the Lichess database) · Ultimate TTT "win in 3" · RPS "read today's character"
   ▼
A few matches: a character, a person, a friend's turn-based game, one story level
   ▼
Result: one beat at a time (XP, then streak, then quest, then next goal)
   ▼
Missed a day? A free weekly freeze covers it (CC-145). Days use the player's local time (CC-146).
```

1. Mechanic: a streak with protection, three daily items, quests, and turn-based games that wait for you.
2. Emotional payoff: a small ritual, plus the talk of "did you get today's puzzle?"
3. Metrics moved: day 1 and day 7 return, sessions per daily player. Chess.com's Daily Puzzle had 1 million solvers a day from December 2022 (source: Chess.com blog, January 2023). Players with a 7 day Duolingo streak were 3.6x more likely to finish their course. That is a correlation (source: Duolingo blog, 2022-01-31).

### 4.4 Weekly loop (phase 2 for solo parts, crowd parts behind gates)

```
Monday 00:00 IST: new week
   ▼
Personal weekly goal (no crowd needed): "Play on 4 days, win 5 games"   ◄── always on
   ▼
Circle weekly board for your group (gate: 6 or more members active that week)
   ▼
Weekly arena per game at a fixed India evening time (gate: 30 or more accounts in that hour slot)
   ▼
League of about 25 (gate: 250 or more weekly accounts)  ◄── phase 3 at the earliest
   ▼
Sunday night: personal goal badge, circle winner, and later league moves (at most one tier down)
```

1. Mechanic: a personal goal first, then circle boards, arenas and leagues as each gate opens (section 6.0).
2. Emotional payoff: a goal for the week and a group to beat.
3. Metrics moved: day 7 and day 30 return. In Duolingo's leagues experiment, learning time rose 17% and the number of highly engaged learners tripled (source: Lenny's Newsletter, 2023). Chess.com's named weekly events, such as Titled Tuesday, show the value of a fixed date (source: https://www.chess.com/news, fetched 2026-10-17). Titled Tuesday is a prize event for titled players, so we copy only the fixed date, not the format.

### 4.5 Seasonal loop (phase 3, 6 to 8 weeks)

```
Season opens with a theme from the story world ("Season 1: Paper Town Open")
   ▼
Free reward track of about 30 steps, earned by playing (solo play counts, no crowd needed)
   ▼
Guest character ("Beat Gully Gopal") ─► "I beat Gopal" share card
   ▼
Festival event inside the season: board skin, 5 to 7 day quest, badge
   ▼
Season ends: the season rank resets (the chess rating never does), you keep a badge for your best rank
   ▼
Unclaimed rewards are granted automatically. Event items come back free the next year.
```

1. Mechanic: seasons (CC-055) with a free track only, a separate season rank, festival events (CC-205), a guest character.
2. Emotional payoff: the arcade changes with the calendar.
3. Metrics moved: day 30 return, return of lapsed players during an event, share cards sent.

### 4.6 Social loop (phase 2)

```
Play on one phone, by link, or against a stranger ─► "Add Rohan as a friend?" (adults, mutual accept)
   ▼
Friends: presence, [Challenge], [Start a turn-based game], head-to-head "You 7-5 Rohan"
   ▼
Circle: "Hostel B4" via WhatsApp link, circle board, shared goal "the circle plays 50 games"
   ▼
"Priya took #1 in Hostel B4" (one notice a day at most) ─► you open the app to win it back
   ▼
Share a result card to WhatsApp ─► friend taps ─► lands in the same challenge ─► new player
```

1. Mechanic: friends (CC-052), challenges (CC-139), head-to-head (CC-140), circles (proposed CC-214), turn-based games (proposed CC-222), share cards (proposed CC-217), and later Duo Streaks (proposed CC-213).
2. Emotional payoff: belonging and rivalry with people you know.
3. Metrics moved: invite to play conversion, share of weekly players with a friend, day 30 return. Wordle grew from 90 players to over 2 million in about 10 weeks, with 1.2 million results shared on Twitter in 13 days (source: https://en.wikipedia.org/wiki/Wordle, fetched 2026-10-17). Telegram posts a chat's high scores into the chat itself (source: https://core.telegram.org/bots/games, fetched 2026-10-17). That is the model for circle boards.

## 5. Experience design

### 5.1 Information architecture, by phase

Nothing appears in navigation before its content exists.

| Destination                               | Phase 1                                                             | Phase 2                              | Phase 3                              |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| Home `/`                                  | Game tiles, Play buttons, trust line                                | plus Today block, Quest door         | plus season or event banner          |
| Game page `/games/:slug`                  | Lobby, rules, FAQ (server rendered)                                 | plus daily item for that game        | plus arena times when gated on       |
| Room and match `/games/:slug/rooms/:code` | Game shell                                                          | plus turn-based games                | same                                 |
| Pass and play `/games/:slug/local`        | yes                                                                 | yes                                  | yes                                  |
| Challenge `/challenge/:id`                | room links only                                                     | persistent challenges (CC-139)       | same                                 |
| Daily `/daily`                            | none                                                                | chess puzzle, Ultimate TTT, RPS read | plus Rush and Streak modes           |
| Quest `/quest`                            | none                                                                | Paper Town 1 to 4, Kingdom 1 to 4    | all districts                        |
| Leaderboards `/leaderboards`              | Weekly, Overall, Chess rating (each hidden until it has 25 entries) | plus Friends, Circle                 | plus League (when gated on)          |
| Friends `/friends`                        | none                                                                | Friends, Circles, Inbox              | plus Feed (friends and circles only) |
| Season `/season`                          | none                                                                | none                                 | yes                                  |
| Profile `/u/:name`                        | own profile only                                                    | public profile (CC-034)              | plus trophy cabinet rarity (gated)   |
| Settings `/settings`                      | sound, motion, privacy, account                                     | plus notifications, language         | same                                 |

Mobile bottom tabs, at most five:

```
Phase 1:  [ Play ]  [ Ranks ]  [ Me ]
Phase 2:  [ Play ]  [ Daily ]  [ Quest ]  [ Friends ]  [ Me ]      (Ranks moves inside Me)
Phase 3:  same five, Season reached from the Home banner and from Me
```

On desktop a top bar holds the same items plus the player chip (avatar, level, streak) and, from phase 2, the inbox bell. Portrait mobile at 390 px is the main layout (source: https://developers.poki.com/guide/easy-access, which strongly advises portrait support).

### 5.2 Home

Built like a portal home page: art-led tiles with one Play button, then crawlable text below the fold (source: https://poki.com/en, fetched 2026-10-17). With three games, the rows are modes, not games.

Phase 1, mobile (390×844)

```
┌ ◆ClassiCade        [Lv3] ┐
│ ┌ Stone Paper Scissors ┐  │
│ │ art  [ PLAY ROCKY ]  │  │
│ │ Find a person · Friend│ │
│ └ Pass and play ───────┘  │
│ ┌ Tic Tac Toe ─────────┐  │
│ │ art  [ PLAY PIP ]    │  │
│ └ Ultimate (phase 2) ──┘  │
│ ┌ Chess ───────────────┐  │
│ │ art [PLAY QUEEN VEE] │  │
│ └ Find a person 3+2 ▾ ─┘  │
│ Free. No betting. No cash.│
├───────────────────────────┤
│  Play    Ranks    Me      │
└───────────────────────────┘
```

Phase 2, desktop (1280×720)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◆ClassiCade   Play  Daily  Quest  Friends  Ranks               🔔2  [Riya·Lv7 🔥5]│
├──────────────────────────────────────────────────────────────────────────────────┤
│ ┌── Stone Paper Scissors ──┐ ┌──── Tic Tac Toe ───────┐ ┌──────── Chess ────────┐│
│ │   (animated hands art)   │ │   (glowing grid art)   │ │  (knight art)         ││
│ │   [ PLAY ROCKY ]         │ │   [ PLAY PIP ]         │ │  [ PLAY QUEEN VEE ]   ││
│ │ Find a person · Friend   │ │ Ultimate · Friend      │ │ Find a person 3+2 ▾   ││
│ │ Pass and play            │ │ Pass and play          │ │ Pass and play         ││
│ └──────────────────────────┘ └────────────────────────┘ └───────────────────────┘│
│ TODAY                                                                            │
│ [🔥 Day 5] [Quests 1/3 ▮▮▯] [Chess puzzle: mate in 2 ▶] [Ultimate TTT: win in 3]│
│ [Your move vs Priya (Tic Tac Toe) ▶]                                             │
│ QUEST: Paper Town ★ 7/24  "Rocky wants a rematch"                    [Continue]  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Free. No betting. No cash. Ever.   How to play · FAQ · About   (text for search) │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Phase 2, mobile

```
┌ ◆ClassiCade   🔔 [Lv7🔥5] ┐
│ ┌ Stone Paper Scissors ┐  │
│ │ art   [PLAY ROCKY]   │  │
│ └ person · friend · 1 phone│
│ ┌ Tic Tac Toe ─────────┐  │
│ │ art   [PLAY PIP]     │  │
│ └ Ultimate · friend ───┘  │
│ ┌ Chess ───────────────┐  │
│ │ art [PLAY QUEEN VEE] │  │
│ └──────────────────────┘  │
│ TODAY  🔥 Day 5 · 1/3     │
│ ▶ Chess puzzle            │
│ ▶ Your move vs Priya      │
│ Quest ★7/24  [Continue]   │
├───────────────────────────┤
│Play Daily Quest Friends Me│
└───────────────────────────┘
```

Rules:

1. The first visit shows only the tiles and the trust line. The Today block appears after the first finished match.
2. There is no "Recent wins" row and no "N playing now" until their gates open (section 6.0).
3. A recent wins row, if it ever ships, shows only adults who opted in, never a minor or a guest.
4. Festival banners appear only in phase 3.

### 5.3 Game page and lobby

The game page is both the lobby and a search page. Today the body is an empty root element, so crawlers see no text (source: curl of /games/chess, 2026-10-17). Poki's Tic Tac Toe page shows the layout that ranks: the game above the fold, then how to play, an FAQ and related games (source: https://poki.com/en/g/tic-tac-toe, fetched 2026-10-17).

Desktop (chess, phase 2)

```
┌ Header ──────────────────────────────────────────────────────────────────────────┐
│ Games › Board games › Chess                                                      │
│ ┌ Chess ─────────────────────────────────────────┐ ┌ This week ───────────────┐  │
│ │ [ PLAY QUEEN VEE ]  (adjusts to your level)    │ │ Your best: 3 wins        │  │
│ │ [ Find a person ]  (3+2) (10+0)                │ │ Your rating 1210? (prov.)│  │
│ │ [ Play a friend: link ] [ Turn-based ] [ Join ]│ │ Top 5 appears once 50    │  │
│ │ [ Pass and play ]  Characters: Pawnee · Vee    │ │ players are on the board │  │
│ │ [ Daily puzzle ]                               │ └──────────────────────────┘  │
│ └────────────────────────────────────────────────┘                               │
│ How to play (5 pictures) · 3 strategy tips · FAQ "Can I play with a friend?"     │
│ Related: Tic Tac Toe · Stone Paper Scissors                                      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Mobile

```
┌ ‹ Chess          [Lv7🔥5] ┐
│ [ PLAY QUEEN VEE ]        │
│ [ Find a person  3+2 ▾ ]  │
│ [ Friend link ] [ Turns ] │
│ [ Pass and play ]         │
│ Daily puzzle ›            │
│ Your rating 1210?         │
│ ─ How to play ─────────── │
│ (pictures, tips, FAQ)     │
├───────────────────────────┤
│Play Daily Quest Friends Me│
└───────────────────────────┘
```

The rating appears only on the chess page. The Rock Paper Scissors and Tic Tac Toe pages show "Your wins this week" and your best series instead.

### 5.4 Room and match (the game shell)

The shell comes from ADR-020 (Proposed) and docs/ux/MATCH_EXPERIENCE.md. Every game plugs its board into the same frame: a request banner, a match bar with series dots and a turn timer, presence chips and an action bar. A request banner never covers the board, and every press gets a visible response within 100 ms.

Desktop (chess vs a person)

```
┌ Header ───────────────────────────────────────────────────────────────────┐
│ ▓ Rohan offers a draw   [Accept] [Decline]   0:20 ▓   (only while open)   │
├ You 2 [●○●◐] 1 Rohan · Game 4 · Your turn ▮▮▮▮▯ 0:24 · ☺                  │
├──────────────────────────────────────────────┬────────────────────────────┤
│                                              │ ● Rohan  connected          │
│                Board                         │ ● You    connected          │
│        (from the game module)                │ Moves  1.e4 e5 2.Nf3 ...    │
│                                              │ Emotes (adults only)        │
├ [Offer draw] [Resign]                                       [♪] [⚙]       ┤
└───────────────────────────────────────────────────────────────────────────┘
```

Mobile (Rock Paper Scissors vs a character, showing the fairness lock)

```
┌ ‹  RPS · Game 2         ⚙ ┐
│ You 1 ●○○ 0 Rocky · bot   │
│ ◉ Rocky 🤖  "Rock is life"│
│ 🔒 Rocky has locked in    │
│    code 7f3a…c21 (?)      │
│ ┌───────────────────────┐ │
│ │  [✊]  [✋]  [✌]       │ │
│ └───────────────────────┘ │
│ ◉ You · choose a throw    │
├ [Leave]        [♪]        ┤
└───────────────────────────┘
```

After the reveal, the strip reads "Rocky threw Rock. Lock checked ✓". The "(?)" opens a two-line explanation: Rocky chose before you did, and the code proves it. Bot seats always carry a robot badge and the character's name. A reconnecting opponent shows a countdown chip. An opponent who has left shows "left, you win in 0:30" (CC-158, CC-036).

### 5.5 Result

The result covers the board on desktop and slides up as a bottom sheet on mobile. On mobile, **at most two lines sit above Rematch**. Further rewards play one at a time in the reward line, and each replaces the one before (CC-099, CC-163). Rematch is always the main button (CC-162).

Desktop

```
┌──────────────── Result card over the board ─────────────────┐
│              YOU WIN   by checkmate                         │
│   Series  You 3 [●○●●] 1 Rohan    ·   Rating 1240 (+12)     │
│   +30 XP   (then: "Streak day 5", then: "Quest done")       │
│   Key moment: "Rohan's move 18 lost the knight" (only when  │
│   the engine is sure, otherwise this line is absent)        │
│   [  REMATCH  ]   [ New opponent ]   [ Share ]   [ Leave ]  │
└─────────────────────────────────────────────────────────────┘
```

Mobile

```
┌───────────────────────────┐
│ (board dimmed behind)     │
├───── bottom sheet ────────┤
│  YOU WIN · checkmate 3-1  │
│  +30 XP  ▮▮▮▮▮▯           │
│  [      REMATCH      ]    │
│  [New opponent] [Share]   │
│   ⌄ more (insight, goals) │
└───────────────────────────┘
```

We show an insight line only where it is cheap and correct:

1. Tic Tac Toe: "you missed a forced win on move 3". Minimax gives an exact answer.
2. Rock Paper Scissors: "you threw Rock 5 of 7 times after a loss". Simple counting.
3. Chess: a key moment only when our engine's evaluation swings by a large, safe margin. Otherwise no line.

A loss is gentle: "Good fight. Rematch?" with Rematch still first. Share opens the device share sheet, with a WhatsApp button as a fallback.

### 5.6 Profile and trophy cabinet

Desktop

```
┌ Header ──────────────────────────────────────────────────────────────────┐
│ [avatar] riya_plays  Lv 12 ·  🔥 14 (best 31)                            │
│ [Challenge] [Add friend]            (hidden on minors' and private profiles)│
├ Games ──────────────────┬ Trophy cabinet (top 3 showcased) ─────────────┤
│ Chess  rating 1340 ↗    │ 🏆 Rock Solid                                 │
│ TTT    82 wins · Ultimate 12 │ 🏆 Paper Town ★★★ complete               │
│ RPS    best series 5-0  │ 🏆 First Ultimate win                         │
├ Head to head ───────────┴ 11 of 15 achievements ▮▮▮▮▮▮▮▯▯ ─────────────┤
│ vs Rohan 7-5 · vs Priya 3-9                                              │
│ Recent matches (replay ▶)                                                │
└──────────────────────────────────────────────────────────────────────────┘
```

Mobile

```
┌ ‹ riya_plays           ⋯ ┐
│ [avatar] Lv12 🔥14        │
│ [Challenge] [Add friend]  │
│ Chess 1340 ↗              │
│ TTT 82 wins · RPS 5-0 best│
│ ─ Showcase ─────────────  │
│ 🏆 🏆 🏆   11/15 ›        │
│ ─ Head to head ────────── │
│ Rohan 7-5 · Priya 3-9     │
├───────────────────────────┤
│Play Daily Quest Friends Me│
└───────────────────────────┘
```

Only chess has a rating, as ADR-027 intends ("ratings only for skill games"). Achievement rarity ("held by 8% of players") appears only once 500 or more accounts exist (section 6.0). The player chooses three achievements to showcase, a pattern Steam and Xbox use (general knowledge, high confidence on the features, no published retention lift).

### 5.7 Friends, circles and inbox (phase 2)

Desktop

```
┌ Friends ─────────────────────┬ Circles ──────────────────┬ Your turn ────────────────────┐
│ ● Rohan  playing chess  [⚔]  │ Hostel B4 (12)  you #3    │ TTT vs Priya · your move ▶   │
│ ● Priya  online         [⚔]  │ Family (5)                │ Chess vs Rohan · his move     │
│ ○ Meera  2 h ago             │ [+ New circle] [Join link]│                               │
│ [Add friend by name or link] │ Goal: 50 games ▮▮▮▯ 31    │                               │
└──────────────────────────────┴───────────────────────────┴───────────────────────────────┘
```

Mobile

```
┌ Friends                  ┐
│ (Friends) Circles  Turns  │
│ ● Rohan chess      [⚔]   │
│ ● Priya online     [⚔]   │
│ ○ Meera 2 h ago           │
│ [+ Add friend]            │
├───────────────────────────┤
│Play Daily Quest Friends Me│
└───────────────────────────┘
```

A feed of friends and circles (system events only, mascot emote reactions) arrives in phase 3 as a third column and tab.

### 5.8 Story map (ClassiCade Quest, phase 2 slice)

From docs/story/STORY_MODE.md (ADR-024, Proposed): Bit guides the player through Paper Town (RPS), Grid City (TTT) and The Kingdom (Chess) to The Marquee. The full game has 32 levels and 96 stars, with no energy and no timers. The phase 2 slice opens Paper Town levels 1 to 4 as the tutorial and The Kingdom levels 1 to 4 as the real test (section 6.4).

Desktop

```
┌ Quest ───────────────────────────────────────────────────────────────────┐
│  Bit: "Rocky always shows his tell. Can you spot it?"        ★ 7 / 24     │
│                                                                          │
│   PAPER TOWN ●──●──●──◉   ▸ THE KINGDOM ○──○──○──○   ▸ more soon 🔒        │
│               1  2  3  4                1  2  3  4                       │
│  ┌ Level 4: Rocky's Rematch ┐                                            │
│  │ Rocky (favours Rock after│  Stars: win · beat him after he switches · │
│  │ a loss)  [ PLAY ] Hint   │  win 3 in a row once you read him          │
│  └──────────────────────────┘                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

Mobile

```
┌ ‹ Quest          ★ 7/24  ┐
│ Bit: "Spot Rocky's tell"  │
│     ○ K4                  │
│      ○ K3                 │
│     ○ K1  THE KINGDOM     │
│      ◉ 4  Rocky ★☆☆       │
│     ● 3                   │
│      ● 1   PAPER TOWN     │
│ [ PLAY LEVEL 4 ]          │
├───────────────────────────┤
│Play Daily Quest Friends Me│
└───────────────────────────┘
```

### 5.9 Season and event hub (phase 3)

Desktop

```
┌ Season 1: Paper Town Open · ends 28 February ───────────────────────────┐
│ Guest character: Gully Gopal (cricket)  [Challenge Gopal]  Beaten: 0/3   │
│ Free track ▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯   step 6 / 30                  │
│  ◇avatar  ◇board skin  ◇frame  ◇emote  ...   (all cosmetic, all free)    │
│ Event: Holi Colours (runs to 14 March)  Quest day 2/5  [Play]             │
│ Season rank: Silver (separate from your chess rating). Badge kept forever.│
└──────────────────────────────────────────────────────────────────────────┘
```

Mobile

```
┌ ‹ Season 1  ends 28 Feb  ┐
│ Gully Gopal               │
│ [ Challenge Gopal ] 0/3   │
│ Track ▮▮▮▮▯▯▯ 6/30        │
│ ◇ ◇ ◇ ◇ ›                │
│ Holi quest day 2/5        │
│ Season rank Silver        │
├───────────────────────────┤
│Play Daily Quest Friends Me│
└───────────────────────────┘
```

We show the end date, never a countdown, to avoid false urgency (section 6.9).

### 5.10 Leaderboards and leagues

Phases 1 and 2 default to the Weekly board. The League tab appears only after its gate opens. Any board with fewer than 25 entries is replaced by "Your week", showing your own numbers.

Desktop (phase 2)

```
┌ Leaderboards  (Weekly) Overall  Chess rating  Friends  Circle ───────────┐
│ This week · resets Monday 00:00 India time                               │
│  1   priya_k   480 XP                                                    │
│  2   rohan     455 XP                                                    │
│  ...                                                                     │
│  9   you       210 XP   ◀                                                │
│ Accounts only. Bot games and capped repeat games do not count.           │
└──────────────────────────────────────────────────────────────────────────┘
```

Mobile

```
┌ ‹ Ranks                  ┐
│ Weekly ▾  resets Mon IST  │
│ 1  priya_k   480          │
│ 2  rohan     455          │
│ ⋮                         │
│ 9  you       210  ◀       │
├───────────────────────────┤
│Play Daily Quest Friends Me│
└───────────────────────────┘
```

Phase 3 league view (when gated on): the top 5 move up. In the bottom 5 the wording is "may move down one tier", shown in grey, never red.

### 5.11 Notifications inbox (phase 2)

Desktop opens the inbox as a panel under the bell. Mobile shows the same list full screen.

```
┌ Inbox ─────────────────────────────┐      ┌ ‹ Inbox                 ┐
│ ⚔ Priya challenged you (TTT) 2 h   │      │ ⚔ Priya challenged you   │
│     [Accept] [Decline]             │      │   [Accept] [Decline]     │
│ ▶ Your move vs Rohan (chess)       │      │ ▶ Your move vs Rohan     │
│ 🔥 Streak day 5. 1 freeze saved.   │      │ 🔥 Day 5 · 1 freeze      │
│ ★  New Quest level open            │      │ ★  New Quest level       │
│ [Notification settings]            │      │ [Settings]               │
└────────────────────────────────────┘      └──────────────────────────┘
```

There is no "at risk" alarm wording. The streak item states facts, including the freeze the player holds.

### 5.12 Settings and safety

```
Desktop                                                     Mobile
┌ Settings ──────────────────────────────────────────┐      ┌ ‹ Settings             ┐
│ Game:  Sound ▮▮▮▯  Mute  · Motion: full / reduced  │      │ Sound  ▮▮▮▯            │
│ Characters adjust to my level: on / off            │      │ Motion  reduced ◉      │
│ Language: English · Hinglish (phase 2) · हिन्दी     │      │ Language  Hinglish ▾   │
│ Notifications: streak (1 a day) ☐ · your turn ☑   │      │ Notifications ›        │
│   challenges ☑ · quiet hours 22:00 to 07:00        │      │ Privacy and safety ›   │
│ Privacy and safety:                                │      │ Blocked players ›      │
│   Who can add me: people I play / nobody           │      │ Account ›              │
│   Emotes in matches: on / off                      │      │                        │
│   Profile: public / friends only                   │      │ Under 18 or age not set│
│   Blocked players (3) · Report history             │      │ = safe defaults (why?) │
│ Account: name, password, devices, delete, export   │      │                        │
└────────────────────────────────────────────────────┘      └────────────────────────┘
```

For players under 18, and for every guest or account with no birth year, the safety controls lock to the safe defaults, with a plain "why" link:

1. A friends-only private profile.
2. Emotes off.
3. Not followable.
4. Circles by invite link only.
5. The name never shown on public boards, share cards or feeds.
6. No push at night.
7. No behavioural personalisation.

These follow the UK Children's Code: high privacy by default, no nudges to weaken privacy, and profiling off by default (source: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/, fetched 2026-10-17). An adult unlocks the adult settings by stating a birth year at sign up.

### 5.13 Visual and audio identity, and motion

**Look: neon arcade (ADR-012, Accepted).**

1. A dark theme by default, with a light theme.
2. Hand-drawn SVG art for each game, chunky buttons, and a glow on focus and hover.
3. Rank badges from Rookie to Legend, and AA contrast throughout.
4. Each game has its own accent colour and its own world from story mode: paper and cardboard for RPS, a neon city grid for Tic Tac Toe, a castle for chess.
5. Festival skins (CC-205) swap only colours and board art, never layout.

**Mascot: Bit.** Bit is a small, friendly robot and the voice of the product.

1. Bit appears on empty states, the 404 page, loading ("Waking up the arcade"), the story map and outcome moments.
2. Bit has five poses: idle, happy, sad, thinking and surprised (CC-194, CC-153).
3. Bit speaks in short, warm lines and never guilt-trips. The tone is "Rocky wants a rematch", not "You let your streak die".
4. Every character has a portrait, a name, one learnable habit and one or two lines. Section 6.4 covers who draws them.

**Sound (ADR-018, Accepted).** Sounds are synthesised in the browser, so there is nothing to download.

1. RPS has a reveal "thwack", Tic Tac Toe a neon "blip", and chess wooden moves with a capture "clack" and a check chime.
2. A win gets a short three-note rise and a loss a soft two-note fall.
3. Sound starts muted until the first tap, as browsers require.

**Motion principles.**

1. Motion explains a change of state. Nothing moves just to decorate.
2. Every press responds within 100 ms. A wait longer than 150 ms gets a spinner (CC-164).
3. UI transitions take 300 ms or less. A celebration takes 1.5 seconds or less, and a tap skips it.
4. Celebrations play one beat at a time, from a queue (CC-099).
5. Reduced motion swaps movement for a fade, and every animated state also has words.
6. Animation code loads lazily, so it never delays the first move.

## 6. Feature strategy

New tickets are proposed with IDs from CC-209. The board says "Next free ID: CC-209" (source: docs/BACKLOG.md, checked 2026-10-17). PROGRESS.md still says CC-205, which is the drift CC-137 fixes. The IDs below are valid only if the owner adds these tickets before any others. Appendix A lists them all.

### 6.0 Liquidity gates

Each feature that needs a crowd has a numeric switch-on threshold. A nightly job (CC-176) checks the thresholds, and a small flag table (proposed CC-228) switches the features on and off. A gate opens after a threshold has held for two weeks, and closes again after it has fallen below for four weeks. Every threshold here is an estimate and is tuned once data exists.

| Feature                                             | Switch-on threshold                                                   | What shows before the gate opens                   |
| --------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| "Find a person" as the main button for an hour slot | 60% or more of searches in that slot find a person within 4 s         | A character is the main button                     |
| Search timeout                                      | Set to the 80th percentile wait of successful searches, capped at 4 s | 4 s                                                |
| "N playing now"                                     | Median of 50 or more people online at that hour over 7 days           | Nothing                                            |
| Recent wins row on home                             | 200 or more opted-in adult accounts finishing matches per day         | Nothing                                            |
| Top 5 on a game page                                | 50 or more accounts on that game's weekly board                       | "Your best this week"                              |
| Any leaderboard tab                                 | 25 or more entries                                                    | "Your week"                                        |
| Achievement rarity                                  | 500 or more accounts                                                  | Achievement without a percentage                   |
| Weekly arena per game (proposed CC-210)             | 30 or more accounts active in that hour slot, two weeks running       | A turn-based "arena week" with friends, or nothing |
| Circle weekly board and arena                       | 6 or more members active in that circle that week                     | The circle's shared goal only                      |
| Leagues (CC-141)                                    | 250 or more weekly accounts (10 cohorts of 25)                        | Personal weekly goal                               |
| Season rank (CC-055)                                | Same as leagues                                                       | The free season track only (solo, needs no crowd)  |
| Spectating (CC-056)                                 | 100 or more concurrent rated chess games                              | Nothing                                            |

Low concurrency is also designed for directly:

1. **Turn-based Tic Tac Toe, Ultimate Tic Tac Toe and chess in phase 2** (proposed CC-222), with "your move" in the inbox and opt-in push. Board Game Arena's mix of real-time and turn-based play has a strong record for classic games when few people are online at once (source: https://fr.wikipedia.org/wiki/Board_Game_Arena, fetched 2026-10-17, about 10 million accounts by August 2024).
2. **"Ping me when a person is free"** (proposed CC-226). After a character match, an opt-in toggle sends one in-app or push notice when a person starts searching in the same game, at most once a day.
3. **Evening play hours.** The site promotes 19:00 to 23:00 India time as "busy hours" in copy and in reminder timing, so that live play concentrates in those hours (estimate, to be checked against the hourly data).

### 6.1 Play: the three games and their depth

**Build.**

1. The game shell, with all three games moved onto it (CC-157 to CC-168), plus reconnect and idle rules (CC-036), the reward queue (CC-099) and fit at 1280×720 and 390×844 (CC-172).
2. Fast defaults. Chess quick match at 3+2 and 10+0 only. RPS defaults to best of 3. Tic Tac Toe rounds chain with rematch, and the starter alternates (CC-091).
3. **A depth plan for each game:**
   1. Chess: a rating (CC-042), the daily puzzle from the Lichess database (CC-144), the replay viewer (CC-041) and turn-based games (CC-222).
   2. Tic Tac Toe: **Ultimate Tic Tac Toe as a permanent mode** (proposed CC-224, taken out of CC-066). It has not been solved under standard rules (source: https://en.wikipedia.org/wiki/Ultimate_tic-tac-toe). Classic 3×3 stays as the quick, social entry game.
   3. Rock Paper Scissors: characters whose habits you can learn, with a reveal of the pattern after each match, best of 5 series, and RPS Streak ("how many rounds can you beat the pattern?", part of proposed CC-209).
4. **Pass and play on one phone** for all three games (proposed CC-223). Our engines are pure and already run in the browser, so this is cheap. Results are not counted.
5. Rush and Streak score modes, done once a solo player wants more (CC-209, phase 2 stretch). They follow Lichess Puzzle Storm and Chess.com Puzzle Rush (source: https://en.wikipedia.org/wiki/Lichess, fetched 2026-10-17).
6. The clock format fix (CC-120).

**Why.** Lichess's game counts are mostly blitz and bullet: 4.66 billion of 5.63 billion games (source: Lichess page). The shell fixes all 6 P0 match problems (source: docs/ux/MATCH_EXPERIENCE.md).

**Skip.**

1. Takebacks in rated games.
2. A daily puzzle for classic 3×3 Tic Tac Toe. There are only a few hundred distinct positions, so it would be trivial.
3. A fourth game before phase 3.

**Measure.** Second match rate, games per session, share of Tic Tac Toe games that are Ultimate, draw rate in classic Tic Tac Toe (high draw rates mean boredom), and 95th percentile move response time (target 150 ms, NFR-3).

### 6.2 Bots and AI

**Build.**

1. Bots seated in rooms with a bot identity (CC-138), under rules to be written in ADR-025. Bot games give XP and quest progress, within caps, but never count for ratings or leaderboards.
2. A small cast whose weaknesses can be learned (CC-190):
   1. Rocky (RPS): favours Rock after a loss.
   2. Echo (RPS): copies your last throw.
   3. Pip (Tic Tac Toe): takes corners and misses edge forks.
   4. Block (Ultimate Tic Tac Toe): defends well but rarely attacks.
   5. Pawnee (chess, beginner).
   6. Queen Vee (chess, aggressive, leaves pieces hanging at low levels).

   An unbeatable 3×3 Tic Tac Toe bot appears only as an opt-in "Perfect" challenge, where a draw earns the star. No default bot produces endless draws.

3. **Provable fairness for Rock Paper Scissors** (proposed CC-225). Before the player chooses, the server sends a commitment: a SHA-256 hash of the character's throw plus a random salt. After the reveal, the client checks the hash and shows "Lock checked ✓". The character can no longer react to the player's throw.
4. **Adaptive difficulty with disclosure** (CC-150).
   1. In a player's first 3 sessions, characters aim for a 65 to 70% player win rate (target). After that they aim for 50 to 55%.
   2. Changes happen between matches, never inside a match.
   3. A label says "Rocky plays at your level", and settings has an off switch.
   4. For minors and unknown ages, the level adapts only from the last few results in the current session and stores no profile. That design aims to stay outside "behavioural monitoring" under the DPDP Act, and it goes to the legal review.
5. A guest character each season (phase 3), with an "I beat them" share card.

**Why.** In January 2023, about 40 million of the 120 million bot games on Chess.com went to one named character, Mittens. That was on a site with millions of daily users (source: Mittens page). Characters keep players busy when no person is online. They are not an acquisition channel.

**Skip.**

1. Stockfish for bots. Our own engine is strong enough for casual play and keeps the bundle small.
2. Chat bots built on large language models.
3. Bots disguised as humans, ever.

**Measure.** Share of first sessions that reach a first move, win rate per player against characters (targets above), adaptive opt-out rate, and the share of players who play a person within 7 days of a first character game.

### 6.3 Matchmaking and ratings

**Build.**

1. Quick match (CC-051). One pool per game, a parallel search of at most 4 seconds, a character as the main button until the section 6.0 gate opens, and a rating window that widens over time for chess.
2. **Glicko-2 ratings for chess only** (CC-042, ADR-027 to be written). Ratings start provisional with a "?" for the first 10 games and are seeded by a one-tap level pick (proposed CC-221). The result card shows ± and the profile has a graph. Lichess uses Glicko-2 (source: Lichess page). Rock Paper Scissors is near chance and Tic Tac Toe is solved, so they get XP, series records and head to head results instead. **No rating soft reset.** The chess rating is permanent, like Lichess and Chess.com (general knowledge, high confidence). Seasons get a separate season rank that resets, the model Clash Royale uses (general knowledge, medium confidence).
3. A weekly arena per game at a fixed evening time (proposed CC-210), switched on by its gate.

**Why.** A competitive player returns to see a trusted rating move (research track opinion, not a published ranking, medium confidence). A rating on a game of chance would break promise 3.

**Skip.** Ratings for RPS and Tic Tac Toe. Pools split by time control. Knockout brackets and user tournaments (CC-067 in full). Spectating until its gate opens.

**Measure.** Median time to a match, the share of quick matches against a person (it should rise), and the day 30 return of rated chess players.

### 6.4 Story mode: ClassiCade Quest

**Build.** The design in docs/story/STORY_MODE.md (ADR-024, Proposed), as a **two-district slice**: Paper Town levels 1 to 4 as the tutorial, and The Kingdom levels 1 to 4 as the real test. Tickets:

1. CC-187 (ADR).
2. CC-188 (catalogue, slice levels first).
3. CC-189 (only the engine options the slice needs).
4. CC-190 (characters for the slice).
5. CC-191, CC-192, CC-193.
6. CC-194 (art for Bit plus four characters).
7. CC-195, CC-196.
8. CC-197 (Paper Town content).
9. Part of CC-199 (Kingdom levels 1 to 4).
10. CC-201, CC-202.

Grid City (CC-198), the rest of The Kingdom and the finale (CC-200) follow in phase 3.

**Star rules in Paper Town reward reading the character, not luck.** Examples: "win after Rocky switches habit" and "win three rounds in a row once you spot his tell". After each level Bit shows the habit, so a loss teaches something.

**Why a two-district slice.** Rock Paper Scissors against a bot is the weakest place to test whether a story holds players, because short matches leave little room for the story. Chess has the skill and the cultural pull in India (source: https://en.wikipedia.org/wiki/Chess_in_India, fetched 2026-10-17). Paper Town stays first because it teaches the map in under 90 seconds. I believe no casual classic games site has characters and a world, but that is unverified opinion: I checked only papergames.io, playtictactoe.org, Poki and CrazyGames, and none had a story mode (fetched 2026-10-17). Poki says it looks for originality over clones (source: https://developers.poki.com/guide/what-we-look-for).

**Art plan.** The slice needs Bit plus four characters with five poses each, about 25 assets.

1. **Bit is drawn or finished by a human**, either the owner in the existing SVG style or a commissioned illustrator, because Bit is the brand. The commission cost is a guess: about ₹1,500 to ₹4,000 a pose, so ₹40,000 to ₹1,00,000 for the slice (general knowledge, low confidence. Get three quotes).
2. The other characters may use AI-assisted drafts with human vector cleanup, under three rules:
   1. The tool's terms must allow commercial use.
   2. A credits file in the repo records the tool, the date and the human edits for each asset.
   3. We avoid prompting for any living artist's style.
3. Purely machine-made images may not be protected by copyright in some places, which is one more reason to keep Bit human made (general knowledge of the US Copyright Office position, medium confidence. Ask the lawyer about India).
4. Proposed CC-230 tracks the art pipeline and the licence record.

**Skip.** Energy, timers, paid hints, paid levels and coins from story. Voiced dialogue.

**Measure.**

1. The design's own targets: M1, at least 25% of first-time visitors open Quest. M4, the first finished match within 90 seconds. M8, at least 8% of guests who **see** "Save your stars" sign up.
2. Kingdom level 4 completion.
3. Day 7 return of Quest players versus others, with the caveat that Quest players choose themselves.

### 6.5 Progression and the daily loop

**Build, in this order (phase 2).**

1. Days in the player's local time (CC-146). This amends ADR-013, see D6.
2. Streak protection (CC-145):
   1. **One free freeze a week, earned by playing, hold at most 2.** Freezes are not a coin sink. This changes ROADMAP §5, see D4.
   2. Earn-back: two matches tomorrow restore a broken streak.
   3. The longest streak record is kept forever.

   In an experiment, allowing 2 freezes at once raised Duolingo's daily active learners by 0.38% (source: Duolingo blog, 2022-01-31).

3. Streak milestones at 3, 7, 30, 100 and 365 days.
4. The daily set, each item with its own streak and a spoiler-free share grid:
   1. A chess puzzle from the Lichess puzzle database, which holds 6,157,341 rated and tagged puzzles released under CC0 (source: https://database.lichess.org/, fetched 2026-10-17).
   2. An Ultimate Tic Tac Toe "win in 3".
   3. An RPS "read today's character" best of 5.
5. The player dashboard (CC-088), merged into the profile.
6. Arcade polish 2 (CC-153).

**The penalties we allow (and nothing else).**

1. A daily streak resets after a missed day with no freeze. The longest streak, levels, badges and items are never lost.
2. A Duo Streak (phase 3, proposed CC-213) pauses for one grace day when either friend misses, then ends. No one is blamed by name.
3. A league move down is at most one tier a week (phase 3).
4. A season rank resets at season end. The badge for the best rank is kept.
5. Nothing ever expires that the player already earned.

**Why.** XP, levels, 15 achievements, quests and streaks already exist (source: packages/shared/src/progression.js and quests.js). The work is protection and visibility.

**Skip.** Spin wheels and scratch cards. The India research track saw them as common in Indian apps and judged that they look like gambling after the Act. That is research track judgement, medium confidence, no published source. Rewards for simply opening the app.

**Measure.** Share of daily players on a streak of 7 or more days, freeze use, daily puzzle solvers and shares, day 1 and day 7 return.

### 6.6 Seasons, events and themes (phase 3)

**Build.**

1. Weekly leagues (CC-141) behind their gate:
   1. Cohorts of about 25, grouped by recent activity.
   2. Tiers: Paper, Wood, Bronze, Silver, Gold, Neon and Legend.
   3. The top 5 move up and the bottom 5 may move down one tier.
   4. Accounts only, with the anti-farm caps.

   Duolingo credits grouping by activity for its +17% leagues result (source: Lenny's Newsletter, 2023).

2. Seasons (CC-055) of 6 to 8 weeks: a free track only, a season rank separate from the chess rating, and rewards that never expire.
3. Festival themes and events (CC-205), driven by config and all cosmetic. The calendar:
   1. New Year.
   2. Republic Day (26 January).
   3. Holi (March).
   4. IPL (late March to May). The 2026 opening weekend had 515 million viewers (source: https://en.wikipedia.org/wiki/2026_Indian_Premier_League, fetched 2026-10-17).
   5. Independence Day (15 August).
   6. Raksha Bandhan.
   7. Diwali.

   **Event items come back for free the next year.** That is our own rule. Fortnite returns pass items to its paid shop (source: Battle pass page), which is the opposite of what we want, so it is not our precedent.

4. A weekly featured variant (proposed CC-211), for example blitz chess or best of 5 RPS.

**Why.** Events are a cheap way to make the arcade feel alive. My view that no global portal does Diwali, Holi and cricket well is unverified opinion. I saw only Poki's "Halloween" category on 2026-10-17.

**Skip.**

1. A paid battle pass.
2. **Any Diwali 2026 event.** Lakshmi Puja falls on 8 November 2026 (source: https://en.wikipedia.org/wiki/Diwali, fetched 2026-10-17), which is during phase 1. The first real event is Holi 2027, or New Year 2027 if phase 2 has started by then.
3. Predictions on real cricket matches, ever.

**Measure.** League participation, season track completion, return of lapsed players during event weeks, event share cards.

### 6.7 Economy and money (phase 3, after phase 2 exits)

**Build, in this order.**

1. ADR-026 for coins:
   1. Coins are earned by play only and spent on cosmetics and name changes only.
   2. Coins are never withdrawn, transferred, traded, wagered, given as prizes or used to buy story levels.
   3. No paid random rewards. Belgium ruled loot boxes to be gambling in 2018 (source: https://en.wikipedia.org/wiki/Loot_box, fetched 2026-10-17).
   4. Streak freezes stay free (section 6.5).
2. A supporter badge as the first revenue test: a "Founder" frame that unlocks nothing else (proposed CC-212). Lichess patrons get wings that unlock nothing (source: https://lichess.org/patron, fetched 2026-10-17).
3. The coin ledger and cosmetic unlocks (CC-142, CC-143, CC-156).
4. Later, ClassiCade Plus (CC-062):
   1. Deeper chess review beyond a free daily quota (Stockfish in a worker, if ever).
   2. Extended stats.
   3. Exclusive cosmetic themes.
   4. Circle hosting perks (larger circles, private arenas for schools and offices).

   **Not in Plus:** story chapters, early story access, Rush modes or any game or opponent. The price is a guess of ₹49 to ₹99 a month (general knowledge, medium confidence on Indian price points). It would run on UPI AutoPay through a gateway such as Razorpay or Cashfree (general knowledge, medium confidence). One post-Act company, ZO Play on winzogames.com, sells subscriptions this way (source: https://www.winzogames.com/, fetched 2026-10-17). That is one example, not proof of a market norm.

**Why not ads.** Ad revenue per Indian user is low at small scale, because Indian ad rates (eCPM) sit well below US rates (general knowledge, medium confidence). At a few thousand daily players, ads would bring in little and would hurt first impressions. This changes the BRD (D9).

**If ads ever come.** They follow Poki's rules: only at natural breaks, rewarded ads always optional, never mid-game (source: https://developers.poki.com/guide/how-monetization-works, fetched 2026-10-17).

**Skip.** Ads (CC-064) in phases 1 and 2. Teen Patti, Rummy and Poker with chips, ever.

**Measure.** Supporter conversion among weekly accounts, coins earned versus spent, refund rate.

### 6.8 Social graph: friends, circles and follow

**Decision: friends first, circles second, follow last and for adults only.**

1. **Friends (mutual), the core, phase 2.** Presence for friends only, direct challenge, turn-based games, head to head records and a friends filter on leaderboards (CC-052, CC-139, CC-140). Duo Streaks follow in phase 3 (proposed CC-213).
2. **Circles (private groups of 2 to 50), phase 2** (proposed CC-214, replacing CC-068 clubs).
   1. Created and joined by a WhatsApp-friendly link.
   2. A circle board and a shared goal, with an arena behind its gate.
   3. No public directory.
   4. WhatsApp is how Indian groups form. The only figure I have is about 530 million Indian users from a Government of India release of February 2021, which is stale (general knowledge, high confidence on the 2021 figure).
3. **Circle safety rules.**
   1. Circle names pass the name filter from ADR-022 and can be reported.
   2. Owners can invite, remove and rename. Owners cannot see members' private profiles or message anyone.
   3. **A circle with any minor or unknown-age member becomes a safe circle:** members see only display names and avatars, emotes are off, and the circle board shows minors as "Player 4" to anyone who is not already their friend.
   4. A minor cannot own a circle of more than 10 people.
   5. Teacher circles (phase 3) use class codes and collect no student contact details.
4. **Follow (one way), phase 3 and adults only.** It is opt-in per profile, and private profiles are allowed. Nobody can follow a minor or an unknown-age account. CC-206 is cut down to a friends and circles feed, and public follow is added only if top adult players ask for it.
5. **Pass and play** (CC-223) serves families with no graph at all.

**Why this order.** Chess.com and Lichess keep social light: friends, challenges and clubs, with no heavy feed (research track summary of both sites, medium confidence). Retention comes from people you know (principle 7).

**Prerequisites, in order.** Public profile and avatars (CC-034), block, mute and report (CC-044), age signal and defaults (CC-152), then challenges, then friends, then circles.

**Skip.** Free text chat. Voice chat. A public circle directory. Social login (CC-058) until account creation is a measured bottleneck.

**Measure.** Share of weekly players with a friend, share in a circle, invite to play conversion, and the day 30 return of players with friends versus without. The last is a correlation and will be reported as one.

### 6.9 Notifications and the dark pattern audit

**Build (phase 2).**

1. The in-app inbox first (CC-147).
2. The PWA manifest, install prompt and opt-in web push (CC-148). Ask for push permission only after value: a first win, a streak of 3 or a friend's move. Ask at most twice, ever.
3. Rules:
   1. At most one push a day that the player did not ask for.
   2. "Your move" and challenges arrive in real time.
   3. Quiet hours run 22:00 to 07:00, always on for minors.
   4. Wording rotates, and reminders pause after 7 ignored days. Duolingo's reminder research found that repeated messages lose effect (general knowledge of Yancey and Settles, KDD 2020, medium confidence).
4. Notification preferences and quiet hours (proposed CC-215), and a dark pattern audit before push ships (proposed CC-229).

**Audit of every nudge against the CCPA 2023 dark pattern guidelines.** The pattern names are from general knowledge, high confidence. The official text must be checked in CC-229.

| Our nudge                       | Closest named pattern                         | Our rule                                                                                                                                               |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Daily streak reminder           | Nagging                                       | One a day at most, an off switch on the message itself, paused after 7 ignored days                                                                    |
| Streak item in the inbox        | Confirm shaming, false urgency                | States facts and the freeze held. Never "at risk" or a sad Bit                                                                                         |
| Duo Streak notice (phase 3)     | Confirm shaming                               | Never names who missed. One a day shared between the pair                                                                                              |
| Season end                      | False urgency                                 | Shows the end date only, no countdown. Rewards granted automatically                                                                                   |
| League bottom zone              | Confirm shaming                               | Grey, "may move down one tier", never red or "relegated"                                                                                               |
| Event items                     | False urgency                                 | They come back free the next year, and the event page says so                                                                                          |
| Save progress prompt            | Nagging, forced action                        | Never blocks play. At most 3 times in total                                                                                                            |
| Push permission sheet           | Nagging                                       | Asked at most twice, ever                                                                                                                              |
| "Ping me when a person is free" | Nagging                                       | Opt-in, one a day at most                                                                                                                              |
| Bots in quick match             | Bait and switch                               | Always labelled before the match starts                                                                                                                |
| Plus on UPI AutoPay (phase 3)   | Subscription trap, drip pricing, SaaS billing | Full price with GST shown before payment, the gateway's pre-debit reminder, cancel in two taps in Settings, no trial that converts without a fresh yes |
| Coin and cosmetic purchases     | Basket sneaking, drip pricing                 | Nothing pre-ticked, final price shown on the confirm screen                                                                                            |
| Rewarded ads (if ever)          | Disguised advertisement                       | Labelled "Ad", always optional                                                                                                                         |

**Skip.** Guilt-trip copy. Marketing pushes. Push timing personalised by behaviour for minors.

**Measure.** Push opt-in rate (target 30% of those asked), open rate, opt-out rate, and day 7 return of opted-in players. The last is a correlation, because keen players opt in.

### 6.10 Safety and trust

**Build.**

1. Under-18 and unknown-age defaults (CC-152) before any social feature.
2. Block, mute and report (CC-044).
3. Emotes off for minors and guests (CC-169).
4. Account deletion and export (CC-035) and guest data retention (CC-098).
5. Share cards that never carry a minor's or a guest's username. A minor's card shows the avatar and "a ClassiCade player".
6. Anti-cheat signals for rated chess (CC-060) once ratings carry status.
7. **A lawyer's review before launch marketing**, covering:
   1. The Privacy Policy and Terms.
   2. The gazetted Online Gaming Act and Rules, including whether a free social game must register.
   3. The CCPA dark pattern guidelines.
   4. Whether adaptive difficulty (CC-150) and recommendations (CC-151) count as behavioural monitoring under the DPDP Act.
   5. The coin ADR, before any payment.
8. A verifiable parental consent step before 13 May 2027 (DPDP Act). Because Kabir is no longer a primary persona, this is phase 2 work, not a phase 1 blocker.
9. A public "No betting. No cash. Ever." line on home and in link previews.

**Why.** After the Act, many Indian parents link "gaming apps" with losing money. That is research track judgement, medium confidence, with no published survey found.

**Skip.** Collecting exact age or identity documents. A birth year is enough until the DPDP rules require more.

**Measure.** Reports per 1,000 matches, time to act on a report, and the share of minor and unknown-age accounts with their defaults intact (target 100%).

### 6.11 Platform, speed and growth plumbing

**Build.**

1. **Phase 0: put the app and the database in the same region, and the database on a paid tier.** Production uses MongoDB Atlas M0 (free). M0 allows 100 reads and writes a second and 500 connections, with 0.5 GB of storage and 10 GB of transfer each way a week. Above the limits, Atlas throttles the cluster with a one second cooldown (source: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/, fetched 2026-10-17). One chess move costs 3 database round trips today (source: docs/investigations/2026-10-17-cross-browser-a11y-load.md), and gamification adds up to about 8 writes per match (ADR-013). If the app moves to Singapore while the database stays in another region, every move gets slower. Render offers Oregon, Ohio, Virginia, Frankfurt and Singapore, and no Indian region (source: https://render.com/docs/regions, fetched 2026-10-17). Proposed CC-227 moves the database to a paid tier in the app's region. ADR-005 decides the region (D1).
2. Always-on paid hosting (CC-028), staging (CC-122), the brand domain (CC-123) and edge caching of fixed assets.
3. Merge PR #51 (CC-180, CC-181, CC-182) and PR #53 (CC-162, CC-164, CC-170).
4. A bundle budget and lazy routes (CC-135): at most 150 KB compressed for the first route (target).
5. Server-rendered game page content (proposed CC-216, extending CC-047).
6. WhatsApp share cards under 300 KB, with an explicit WhatsApp button and Hinglish text (proposed CC-217). Today's preview image is 392 KB (source: curl, 2026-10-17). The research track says WhatsApp may skip large previews, but that is a community report, medium confidence.
7. A string catalogue, with Hinglish in phase 2 (proposed CC-218). The evidence that Indian-language users outnumber English users comes from KPMG and Google in 2017 and is stale (general knowledge, medium confidence on direction).
8. Observability (CC-049) and the match outbox (CC-111).
9. **Measure from India.** Time to first byte and largest contentful paint from an Indian vantage point (a free web test location in Mumbai, or a friend's phone with a test page) before and after the move. The 3.65 s figure is not a baseline.

**Skip.**

1. Native apps (CC-071).
2. Redis scaling (CC-061).
3. Poki, which requires open-web exclusivity (source: https://developers.poki.com/guide/working-with-poki, fetched 2026-10-17).
4. CrazyGames, Telegram and Discord versions until phase 3.

**Measure.** Time to first byte from India (target under 500 ms when warm), largest contentful paint at the 75th percentile on mobile, database throttling events (target zero), error rate per session.

## 7. Metrics

### 7.1 North Star metric

**Weekly Returning Players (WRP): players with a day of real play on 3 or more different local days in a week.** A day of real play is a day on which the player does at least one of these:

1. Finishes a match that counts under ADR-021, against a person or a character, including turn-based games.
2. Finishes the daily puzzle.
3. Finishes a story level.

Pass and play counts only for the phone's owner.

**Guardrails, reported beside WRP every week.**

1. **The share of WRP with at least one match against a person that week.** Phase 1 target: 25%. Phase 2 target: 40%. If WRP rises while this falls, we are building a bot arcade, not a social one.
2. The share of WRP who are accounts rather than guests.
3. Bot XP per player per day, to check the cap in ADR-025.

**Measurement limits.** A guest is a cookie.

1. A shared family phone (Meena) puts several people under one id, so WRP undercounts families.
2. One person on two devices counts twice until they sign in.
3. Clearing cookies creates a new player.

We report guest and account WRP separately, and we trust account WRP more.

**Targets (estimates from a simple model, not benchmarks).** Steady state WRP is roughly new players a week, times the share who become 3-day regulars, times the weeks a regular stays.

1. At 300 new players a week, 6% becoming regulars and 5 weeks of staying, WRP is about 90.
2. **Target: 100 WRP four weeks after phase 1 exits.**
3. At 1,000 new players a week, 8% and 7 weeks, WRP is about 560. **Phase 2 exit target: 500 WRP.**
4. The BRD's 10,000 weekly active players is a Stage 3 or Stage 4 goal.

### 7.2 Input metrics and targets

**Benchmarks and their limits.** The benchmarks below come from mobile app install cohorts. For casual mobile games, the median is about 25 to 30% on day 1, 8 to 12% on day 7 and 3 to 6% on day 30. The top quartile is about 40%, 15 to 20% and 8% or more (general knowledge from GameAnalytics and AppsFlyer reports, 2022 to 2024, medium confidence, estimates). Web visitors come back less often than mobile players (source: https://developers.poki.com/guide/engagement), and I found no published web cohort numbers. **The launch retention targets below are therefore guesses, low confidence**, set below the mobile medians. The BRD's day 7 target of 20% or more becomes a Stage 3 stretch goal (D10).

| Metric                            | Definition                                                                | Launch target (phase 1 exit)                 | Phase 2 exit target                     | Instrumentation                                                       |
| --------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| Time to first move                | Page load or link open to first move sent, 75th percentile, by entry type | 10 s or less from every entry in section 4.1 | 7 s or less                             | `page_view` and `gameplay_start` timestamps (CC-174, proposed CC-220) |
| Conversion to play                | Share of visitors with a `gameplay_start` in the session, by entry type   | 50%                                          | 65% (Poki's base target)                | CC-174 funnel, nightly (CC-176), dashboard (CC-177)                   |
| Games per session                 | Finished matches per session                                              | 2.5                                          | 3.5                                     | `match_finished` (CC-045) joined to the session                       |
| Session length                    | Active time per session                                                   | 4 min                                        | 5 min                                   | CC-174 heartbeat while visible                                        |
| Sessions per daily player         |                                                                           | 1.2                                          | 1.5                                     | CC-045 plus CC-174                                                    |
| Day 1 return                      | New players who have a day of real play on the next local day             | 15% (guess)                                  | 25%                                     | CC-176 cohorts, keyed by anonymous id then account id after merge     |
| Day 7 return                      | Same, on day 7                                                            | 5% (guess)                                   | 10%                                     | as above                                                              |
| Day 30 return                     | Same, on day 30                                                           | 2% (guess)                                   | 4%                                      | as above                                                              |
| Invite to play                    | Opened invite or challenge links that lead to a `gameplay_start`          | 40%                                          | 55%                                     | `share_sent`, `link_opened`, `gameplay_start` with a link id          |
| Guest to account                  | **All** guests with a finished match who create an account within 7 days  | 3%                                           | 5%                                      | `account_created` with the guest merge (ADR-014)                      |
| Save prompt conversion (story M8) | Sign ups out of guests **shown** "Save your stars"                        | not live                                     | 8%                                      | CC-201                                                                |
| Viral coefficient                 | New players from links per active player per week                         | 0.1                                          | 0.2 (BRD BO-3 says 0.3, a Stage 3 goal) | link attribution                                                      |
| Person share                      | Share of WRP with a match against a person                                | 25%                                          | 40%                                     | opponent kind on `match_finished`                                     |
| Push opt-in                       | Opt-ins out of sheets shown                                               | not live                                     | 30%                                     | CC-148 events                                                         |

**Sample sizes.** A 95% margin of error on a rate is about 1.96 × √(p(1−p)/n).

1. With 100 new players and a day 1 rate of 25%, the margin is ±8.5 points. That is too noisy for a gate.
2. With 300 players it is ±4.9 points, and with 500 it is ±3.8 points.
3. For day 7 at 10% with 300 players, the margin is ±3.4 points.

**So every retention gate needs cohorts of at least 300 new players.**

**Instrumentation rules.**

1. Telemetry is first party and anonymous, with an opt-out (CC-173).
2. Minors and unknown ages get aggregate counts only.
3. Every event carries the build version.
4. The owner dashboard (CC-177) shows WRP, the guardrails and these inputs on one page, with weekly cohorts and their margins of error.

### 7.3 Acquisition plan (estimates)

Phase 1 exit needs one week with 300 or more new players finishing a match.

| Channel                                                                        | Mechanism                                                  | New players in the launch week (estimate) |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------- |
| Owner's own WhatsApp groups (college, office, family)                          | 15 groups × about 10 who tap and play                      | 150                                       |
| College chess clubs and fests                                                  | 5 clubs × 20, using a chess challenge link and a character | 100                                       |
| Pass and play and share cards from those players                               | Viral coefficient about 0.15                               | 40                                        |
| Indian chess and gaming communities (Reddit, Discord), where their rules allow | A few posts with a challenge link                          | 50                                        |
| **Total**                                                                      |                                                            | **about 340**                             |

Phase 2 needs about 1,000 new players a week:

1. School and college chess events (a light version of CC-070): about 300.
2. Viral coefficient rising to 0.2 with circles: about 200.
3. Long-tail search pages (CC-216), which take months to rank: 0 to 300.
4. Repeat community posts and the Holi or New Year event: about 200.

These are guesses. The plan is to measure each channel through link attribution and drop the ones that do not convert.

## 8. Recommended plan

### 8.1 Phases mapped onto the board's Stages

| Phase          | Board Stage                      | What it closes                                   |
| -------------- | -------------------------------- | ------------------------------------------------ |
| Phase 0        | Stage 0                          | The unmet Stage 0 exit criteria                  |
| Phase 1, Now   | Stage 1                          | Stage 1 exit criteria, with two amendments (D11) |
| Phase 2, Next  | Stage 2                          | Retention, with ticket moves listed in D11       |
| Phase 3, Later | Stage 3 and the start of Stage 4 | Monetisation, seasons, Ludo                      |

CLAUDE.md rule 8 says a stage starts only after the previous stage's exit criteria are met. This plan follows that rule once the owner accepts the amendments in section 10.

**Capacity basis.** On the board, 72 tickets are done. The git log shows 138 commits on 16 and 17 October 2026 alone, made with parallel agents. That is a burst, not a pace. I plan with an **assumed 3 ticket-weeks of shipped work per calendar week**, because the owner's review and testing is the limit. One ticket-week means a week of focused work by one person, including review. Sizes come from ROADMAP.md: S = 0.25, M = 0.5, L = 1. Unsized tickets are estimated. CC-137 should produce the real figure after two weeks, and these timings should be updated then.

**Phase 0: close Stage 0 (about 2 weeks, about 5 ticket-weeks).** Stage 0's exit needs all `SEC-*` fixed and one non-production environment. Open today: SEC-12, SEC-13, SEC-15, SEC-16 and SEC-17, with no staging (source: docs/KNOWN_ISSUES.md).

1. CC-105 (rotate the leaked password, owner).
2. CC-107 (room flood).
3. CC-116, CC-117 and CC-118 (SEC-15 to SEC-17. For CC-118, document the trade-off now and mark it accepted until email ships).
4. CC-122 (staging).
5. CC-028 with proposed CC-227 (always-on app and paid database in the same region).
6. Merge PR #51 and PR #53.

Exit: every Stage 0 criterion met, and time to first byte measured from India.

**Phase 1, Now: "One great match, never alone" (about 7 weeks, about 20 ticket-weeks).** Goal: a visitor on a budget Android phone in India finishes a polished match within 10 seconds, wants a rematch, and we can measure it.

Exit criteria (Stage 1, as amended in D11):

1. Time to first move is 10 seconds or less at the 75th percentile from every entry type in section 4.1, measured on the live site.
2. All 6 P0 findings in MATCH_EXPERIENCE.md are closed. All three games run in the shell at 1280×720 and 390×844.
3. A labelled character for each game is the main Play button, with a working parallel search for a person. RPS characters use commit-reveal.
4. Pass and play works for all three games.
5. The chess rating is live (Stage 1's "ratings", read as chess only).
6. The dashboard shows the funnel, day 1 return and WRP.
7. The launch checklist (CC-050) is done, the legal review is done, and the brand domain is live.
8. **One week with 300 or more new players who finished a match** (section 7.3).

**Phase 2, Next: "A reason to come back, with people you know" (about 9 to 10 weeks, about 27 ticket-weeks).** Goal: day 7 return near 10%, and players with friends and circles.

Exit criteria (Stage 2):

1. Two weekly cohorts in a row, **each with 300 or more new players**, with day 1 return of 25% or more and day 7 return of 10% or more.
2. The story slice meets M1, M4 and M8, and Kingdom level 4 completion is measured.
3. Under-18 and unknown-age defaults, block and report, friends, challenges and circles are live. 25% of weekly accounts have a friend or a circle.
4. WRP of 500 or more, with 40% or more of them playing a person.

**Phase 2 cut list, in this order, if it slips past 10 weeks:**

1. Hinglish (CC-218).
2. Rush and Streak modes (CC-209).
3. The chess part of CC-069 lite.
4. Web push (keep the inbox).
5. Kingdom levels 3 and 4.
6. Arcade polish 2 (CC-153).
7. "Ping me" (CC-226).

Friends, circles, turn-based play, pass and play and the daily set are never cut.

**Phase 3, Later: "Seasons, circles at scale and a sustainable business".** Goal: day 30 return, first revenue, the first new game. Exit criteria (Stage 3 and the start of Stage 4):

1. 2,000 or more WRP.
2. Supporter conversion measured.
3. Season 1 and one festival event run end to end.
4. Leagues switched on by their gate.
5. Ludo shipped with characters and pass and play.

### 8.2 Every open ticket mapped

There are 72 done tickets, marked ✅ on the board, that need no action. CC-121 and CC-124 are unused spares. Every open ticket is listed below by ID.

| Group                           | Open tickets                                                                                                                                            | Phase                           | Reason                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Security that blocks Stage 0    | CC-105, CC-107, CC-116, CC-117, CC-118                                                                                                                  | 0                               | Stage 0 exit needs every SEC finding closed                                                                |
| Hosting, database, staging      | CC-028, CC-122, proposed CC-227                                                                                                                         | 0                               | Cold starts and a far-off database break the 10 second promise. Stage 0 needs a non-production environment |
| PR #51                          | CC-180, CC-181, CC-182                                                                                                                                  | 0                               | Move speed and deploy safety before traffic                                                                |
| PR #53                          | CC-162, CC-164, CC-170                                                                                                                                  | 0                               | Already in review, and the shell builds on it                                                              |
| Domain                          | CC-123                                                                                                                                                  | 1                               | Links and search build on the brand from the first seeded player                                           |
| Game shell                      | CC-157, CC-158, CC-159, CC-160, CC-161, CC-163, CC-165, CC-166, CC-167, CC-168, CC-171, CC-172, CC-036                                                  | 1                               | This is "three games done well". It closes every P0 match finding                                          |
| Reward pacing                   | CC-099                                                                                                                                                  | 1                               | The first win sets day 1 return                                                                            |
| Reliability                     | CC-111, CC-112, CC-115, CC-204                                                                                                                          | 1                               | A lost result or a false "room not found" breaks trust                                                     |
| Chess polish                    | CC-120, CC-041                                                                                                                                          | 1                               | Small visible bugs and the replay viewer for the flagship game                                             |
| Layout check                    | CC-154                                                                                                                                                  | 1                               | Guards the 390 px promise                                                                                  |
| Accessibility                   | CC-048, CC-183                                                                                                                                          | 1                               | Folded into the shell and the chess move                                                                   |
| Bots and matchmaking            | CC-138, CC-051, CC-150, CC-203, proposed CC-221, proposed CC-225                                                                                        | 1                               | Solo play, the main button and provable fairness. CC-203 keeps CI fast                                     |
| Pass and play                   | proposed CC-223                                                                                                                                         | 1                               | Serves families with no crowd and costs little                                                             |
| Chess rating                    | CC-042                                                                                                                                                  | 1                               | Stage 1 lists ratings. Chess only, per ADR-027                                                             |
| Telemetry                       | CC-045, CC-173, CC-174, CC-175, CC-176, CC-177, CC-178, proposed CC-220, proposed CC-228                                                                | 1                               | Nothing can be tuned or gated without it                                                                   |
| Observability and launch        | CC-049, CC-050, CC-135, CC-137                                                                                                                          | 1                               | We must see errors from the first players, the bundle budget matters for India, and counts must be real    |
| Growth plumbing                 | proposed CC-216, proposed CC-217                                                                                                                        | 1                               | Search pages and WhatsApp cards on the existing room links                                                 |
| Daily loop                      | CC-146, CC-145, CC-144, CC-088, CC-093, CC-094                                                                                                          | 2                               | Cheap protection for the strongest return mechanic, plus data correctness                                  |
| Notifications                   | CC-147, CC-148, proposed CC-215, proposed CC-229                                                                                                        | 2                               | Inbox first, then push after value, after the dark pattern audit                                           |
| Social foundations              | CC-034, CC-044, CC-152, CC-185                                                                                                                          | 2                               | Required before any social feature. The rename prompt comes with public profiles                           |
| Social core                     | CC-139, CC-052, CC-140, CC-043, CC-169, proposed CC-214                                                                                                 | 2                               | People you know drive return. Emotes come after CC-152                                                     |
| Low-crowd play                  | proposed CC-222, proposed CC-226, proposed CC-224                                                                                                       | 2                               | Turn-based play, "ping me" and Ultimate Tic Tac Toe give depth without a crowd                             |
| Story slice                     | CC-179, CC-187, CC-188, CC-189, CC-190, CC-191, CC-192, CC-193, CC-194, CC-195, CC-196, CC-197, CC-199 (levels 1 to 4), CC-201, CC-202, proposed CC-230 | 2                               | The differentiator, tested on chess as well as RPS                                                         |
| Insight lite                    | CC-069 (TTT and RPS lines, chess only when sure)                                                                                                        | 2                               | Cheap and correct where it ships                                                                           |
| Accounts and legal              | CC-033, CC-035, CC-098, CC-114                                                                                                                          | 2                               | Email unlocks password reset. Deletion and retention for the DPDP Act                                      |
| Polish                          | CC-153, CC-091, CC-092, CC-100, CC-155                                                                                                                  | 2                               | Gaming feel after the core works. Screenshot baselines once screens settle                                 |
| Hygiene                         | CC-136, CC-184                                                                                                                                          | 2                               | Indexes before data grows, cross-browser CI                                                                |
| Strings and language            | proposed CC-218                                                                                                                                         | 2                               | The catalogue now, Hinglish first, first on the cut list                                                   |
| Solo score modes                | proposed CC-209                                                                                                                                         | 2 (stretch)                     | A solo loop that needs no crowd, second on the cut list                                                    |
| Recommendations                 | CC-151                                                                                                                                                  | 3                               | Needs the legal answer on behavioural monitoring                                                           |
| Leagues and seasons             | CC-141, CC-055                                                                                                                                          | 3                               | Behind the 250 weekly accounts gate                                                                        |
| Events and variants             | CC-205, proposed CC-211                                                                                                                                 | 3                               | First event Holi 2027 or New Year 2027                                                                     |
| Weekly arena                    | proposed CC-210                                                                                                                                         | 3, or earlier if the gate opens | Needs 30 accounts in an hour slot                                                                          |
| Duo Streaks                     | proposed CC-213                                                                                                                                         | 3                               | After friends have proved themselves                                                                       |
| Feed                            | CC-206 (cut down to friends and circles)                                                                                                                | 3                               | Follow only for adults, and only if asked for                                                              |
| Story, the rest                 | CC-198, CC-199 (rest), CC-200                                                                                                                           | 3                               | Only after the slice meets M1, M4 and M8                                                                   |
| Economy                         | CC-142, CC-143, CC-156, proposed CC-212                                                                                                                 | 3                               | After ADR-026. Supporter badge first                                                                       |
| Money                           | CC-062, CC-063, CC-065                                                                                                                                  | 3                               | Plus after the supporter test. The store waits for demand                                                  |
| Admin console                   | CC-059                                                                                                                                                  | 3                               | CC-228 covers gates until then                                                                             |
| Anti-cheat                      | CC-060                                                                                                                                                  | 3                               | Once chess ratings carry status                                                                            |
| New games                       | CC-057 (Ludo), proposed CC-219 (hand cricket)                                                                                                           | 3                               | The key India game, and a cheap IPL mode on the RPS engine                                                 |
| Schools and offices             | CC-070                                                                                                                                                  | 3                               | Grows out of teacher and office circles                                                                    |
| Ads                             | CC-064                                                                                                                                                  | Cut for phases 1 and 2          | Little money at our scale and it hurts first impressions (D9)                                              |
| Tournaments in full, spectating | CC-067, CC-056                                                                                                                                          | Defer                           | Need scale. The arena covers the weekly date                                                               |
| Other games                     | CC-066 (except Ultimate TTT, which moves to CC-224)                                                                                                     | Defer                           | Depth in three games first                                                                                 |
| Referrals                       | CC-149                                                                                                                                                  | Defer                           | +3% at Duolingo. Share cards do more                                                                       |
| Social login                    | CC-058                                                                                                                                                  | Defer                           | Until sign up is a measured bottleneck                                                                     |
| Scale                           | CC-061                                                                                                                                                  | Defer                           | Until one instance runs short                                                                              |
| Flake watch                     | CC-079                                                                                                                                                  | Defer                           | Rare and P3                                                                                                |
| Native apps                     | CC-071                                                                                                                                                  | Cut                             | A PWA first, then perhaps a Play Store wrapper                                                             |
| Code quality debt               | CC-126, CC-127, CC-128, CC-129, CC-130, CC-131, CC-132, CC-133, CC-134                                                                                  | Background, one at a time       | Keeps the solo owner fast, never blocks a phase                                                            |

### 8.3 The 10 highest-leverage tickets, in order

Phase 0 comes first because it blocks everything: CC-105, CC-107, CC-116 to CC-118, CC-122, and PRs #51 and #53. After it:

1. **CC-028 with proposed CC-227 and CC-123.** An always-on app and a paid database in the same region, on the brand domain. Without them the first visit can wait a minute.
2. **CC-138 with proposed CC-225, and ADR-025.** Labelled characters seated in rooms, with provable fairness. This unlocks solo play, quick match, story and pass-and-play opponents.
3. **CC-051 with proposed CC-221.** "Play Rocky" as the main button and a parallel 4 second search.
4. **CC-157 with CC-158 to CC-161.** The shell, which fixes every P0 finding.
5. **CC-045, CC-173 to CC-177, proposed CC-220 and CC-228.** Telemetry and liquidity gates. From here on every choice is measured.
6. **CC-099 with CC-163.** One beat at a time on the first win.
7. **Proposed CC-217.** WhatsApp share cards on existing room links, the growth loop for seeding.
8. **CC-146 and CC-145.** Local days and free weekly freezes.
9. **CC-144.** The daily chess puzzle from the Lichess CC0 database.
10. **CC-152, then CC-139, CC-052 and proposed CC-214.** Safe defaults, then challenges, friends and circles for the primary personas.

Just outside the ten: CC-223 (pass and play, cheap, in phase 1), CC-042 (chess rating, needed for Stage 1), CC-222 (turn-based play) and the story slice.

## 9. Risks and open questions for the owner

| #   | Risk or question                                                                                                                    | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Running cost with no revenue.**                                                                                                   | Budget the whole stack. Render's paid instance is often quoted at about US$7 a month, but that is **unverified**: the pricing page showed no prices on 2026-10-17. A paid Atlas tier (Flex or M10) costs roughly US$10 to US$60 a month (general knowledge, low confidence). A domain costs about ₹800 to ₹1,500 a year, and error tracking and email on free tiers cost nothing (general knowledge, medium confidence). Total: about US$20 to US$75 a month plus staging (estimate). Check the live pricing pages before committing. |
| 2   | **The database is on Atlas M0.** 100 operations a second, then throttling with a one second cooldown (source: MongoDB limits page). | Move to a paid tier in the app's region in phase 0 (CC-227). Merge PR #51 to cut writes per move.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | **Singapore or India.** Render has no Indian region (source: Render regions page).                                                  | Use Render Singapore now to avoid a migration. Record in ADR-005 that Mumbai hosting elsewhere (for example Fly.io, or Atlas in AWS Mumbai) is the next step if Indian latency measured after the move stays above 150 ms per round trip. That Fly.io and Atlas offer Mumbai is general knowledge, medium confidence.                                                                                                                                                                                                                 |
| 4   | **Scope versus a solo owner.** Phase 1 is about 20 ticket-weeks and phase 2 about 27.                                               | Hold to the phases and use the cut list. Replace the assumed 3 ticket-weeks a week with the measured rate after two weeks, and re-plan if it is lower.                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | **Nobody is here yet.**                                                                                                             | The section 7.3 seeding plan, with a hard phase 1 gate of 300 new players in a week. No retention tuning before that.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | **Characters could make the site look busier than it is, or feel like a trick.**                                                    | Labels, commit-reveal for RPS, disclosed adaptive difficulty, no bot games on boards, and the person share guardrail on the North Star.                                                                                                                                                                                                                                                                                                                                                                                               |
| 7   | **Shallow games bore people.**                                                                                                      | Ultimate Tic Tac Toe, learnable RPS characters, chess puzzles and ratings. Watch the classic Tic Tac Toe draw rate.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8   | **Child safety and the law.**                                                                                                       | Unknown age means minor. Hold the legal review (section 6.10) before launch marketing, against the gazetted Act and Rules, the DPDP Act and the CCPA dark pattern guidelines.                                                                                                                                                                                                                                                                                                                                                         |
| 9   | **The story bet fails.**                                                                                                            | The two-district slice tests it in about 6 weeks of phase 2 work. If M1, M4 and M8 miss, stop after the slice and spend the art budget on cosmetics.                                                                                                                                                                                                                                                                                                                                                                                  |
| 10  | **Art cost and rights.**                                                                                                            | Bit drawn or finished by a human. AI-assisted drafts for the other characters only with a commercial-use licence and a credits file (CC-230).                                                                                                                                                                                                                                                                                                                                                                                         |
| 11  | **Daily puzzle novelty fades.** Wordle's daily players halved within a year of its peak (source: Wordle page).                      | Back the daily items with friends, circles and turn-based games, which carry long-term return.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 12  | **Follow versus friends.** The owner asked for followers.                                                                           | Friends and circles first, a friends and circles feed in phase 3, public follow only for adults and only if asked for.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 13  | **When to make money.**                                                                                                             | No ads in phases 1 and 2. Supporter badge first, then Plus without story or game access. This changes the BRD (D9).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 14  | **Brand.** The URL says "nocapgaming" and the product says "ClassiCade".                                                            | Move to a ClassiCade domain (CC-123) before seeding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 15  | **Language.**                                                                                                                       | Build the catalogue now (CC-218) and add Hinglish in phase 2. Rules lean on pictures, so the cost is low. The language evidence is stale (2017).                                                                                                                                                                                                                                                                                                                                                                                      |
| 16  | **The BRD's day 7 target of 20% is a mobile top quartile figure, and web returns are lower.**                                       | Make it a Stage 3 stretch goal and use the phase targets in section 7.2 (D10).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 17  | **Free streak freezes cut a planned coin sink.**                                                                                    | Accept it. Paying to keep a streak alive is close to a guilt mechanic. Coins still have cosmetics and name changes as sinks (D4).                                                                                                                                                                                                                                                                                                                                                                                                     |

## 10. Decisions this vision needs

Several recommendations above depend on decisions that are still Open or Proposed, or that change accepted ADRs. Each needs the owner's acceptance before its work starts. Proposed new ADR numbers start at ADR-028. Check DECISIONS.md before using them.

| #   | Decision                                                  | Status today  | Open question                                                                                                                  | Recommendation                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | ADR-005 Hosting                                           | Open          | Which provider and region, and is the database paid and in the same region?                                                    | Render Singapore always-on, Atlas paid tier in the same region, Mumbai as the next step if measured latency needs it                                                                                                                                                                                                                                                           |
| D2  | ADR-020 Game shell                                        | Proposed      | Accept as designed?                                                                                                            | Accept                                                                                                                                                                                                                                                                                                                                                                         |
| D3  | ADR-024 Story mode                                        | Proposed      | Accept with a two-district slice and star rules based on reading the character?                                                | Accept with those amendments                                                                                                                                                                                                                                                                                                                                                   |
| D4  | ADR-026 Coin economy, and an edit to ROADMAP §5           | To be written | Are freezes a coin sink?                                                                                                       | No. Free weekly freezes (hold 2). Coins for cosmetics and name changes only. Never cashed out, traded, wagered, given as prizes or used for story                                                                                                                                                                                                                              |
| D5  | ADR-025 Bot identity and rewards                          | To be written | (a) Do bot games count toward ADR-021's caps? (b) How is bot XP capped? (c) Adaptive difficulty disclosure? (d) Commit-reveal? | (a) Yes. Each character counts as one opponent for the 10 per pair per day cap, and bot games count toward the 20 per player per hour cap. (b) At most 100 XP a day from bot matches, a separate budget from the 150 XP quest cap. (c) Labelled, between matches only, with an off switch, and session-only for minors. (d) Required for RPS. Never on ratings or leaderboards |
| D6  | Amend ADR-013 (UTC days for streaks and quests)           | Accepted      | How is the player's time zone set, and can they game it?                                                                       | Use the browser's time zone, changeable at most once in 7 days. Use India time when unknown                                                                                                                                                                                                                                                                                    |
| D7  | Amend ADR-015 (UTC ISO week boards such as "2026-W42")    | Accepted      | Which week boundary?                                                                                                           | Weekly boards and leagues reset Monday 00:00 India time. Keep the ISO week key, shifted to IST. Revisit if other regions grow                                                                                                                                                                                                                                                  |
| D8  | Amend ADR-021 (10 per pair per UTC day, 20 per hour)      | Accepted      | Do anti-farm caps move to local time?                                                                                          | No. Caps stay on one server clock (a rolling 24 hours per pair, the clock hour per player), because abuse limits need one clock. Add the bot rules from D5                                                                                                                                                                                                                     |
| D9  | BRD §5 ads in the free tier, and BO-4 "≥ 2% free to paid" | BRD text      | Drop ads, and change BO-4?                                                                                                     | No ads in Stages 1 and 2. BO-4 becomes "revenue covers infra costs, supporter conversion measured", with 2% free to paid kept as a Stage 3 goal for Plus                                                                                                                                                                                                                       |
| D10 | BRD day 7 target of 20% or more                           | BRD text      | Keep it as the launch target?                                                                                                  | Make it a Stage 3 stretch goal and use section 7.2 for phases 1 and 2                                                                                                                                                                                                                                                                                                          |
| D11 | BACKLOG and PRD Stage exit criteria                       | Board text    | Amend Stage 1 and move tickets?                                                                                                | Stage 1 "ratings" reads "chess rating". Add "a labelled character for each game as the main Play button" and "pass and play". Move CC-051 from Stage 2 to Stage 1, CC-057 (Ludo) from Stage 2 to Stage 3, and CC-147, CC-139 and CC-052 into Stage 2 as listed in section 8.2. One docs ticket (proposed CC-231) makes the edits                                               |
| D12 | ADR-027 Ratings                                           | To be written | Which games, which system, and any reset?                                                                                      | Chess only, Glicko-2, provisional for 10 games, seeded by a one-tap level, never reset. A separate season rank resets                                                                                                                                                                                                                                                          |
| D13 | New ADR-028: social graph and minors                      | None          | Friends, circles, follow, and the treatment of unknown ages?                                                                   | Section 6.8 and the unknown-age-equals-minor rule                                                                                                                                                                                                                                                                                                                              |
| D14 | New ADR-029: liquidity gates                              | None          | Thresholds and how they switch on and off?                                                                                     | The section 6.0 table, held for 2 weeks to open and 4 weeks to close                                                                                                                                                                                                                                                                                                           |
| D15 | CC-173 telemetry privacy                                  | Ticket        | What do we collect, and from whom?                                                                                             | First party, anonymous, opt-out, aggregate counts only for minors and unknown ages                                                                                                                                                                                                                                                                                             |

## Appendix A. Answers to review

1. **The 10 second promise did not add up.** Fixed. A named character is now the main button, and "Find a person" is second and runs in parallel for at most 4 seconds, with a timeout set from measured match rates. "Nobody free" is never shown. Section 4.1 has a time budget for each entry type. See promise 1, principle 1 and sections 4.1 and 6.3.
2. **Low player numbers were not designed for.** Fixed with the liquidity gates table (section 6.0). Turn-based play moves to phase 2 (CC-222), "ping me when a person is free" is added (CC-226), and India evening play hours are added. The home "Recent wins" row, the game page Top 5 and achievement rarity are hidden until their gates open.
3. **Ratings for all three games conflicted with ADR-027.** Fixed. Chess only, the RPS and TTT ratings are removed from the mock-ups, the phase exit criteria are changed, and there is no rating soft reset. A separate season rank resets instead (sections 5.6, 6.3 and D12).
4. **Phases conflicted with the Stage exit criteria and rule 8.** Fixed. Phases map explicitly onto Stages 0 to 3 (section 8.1). Phase 0 now closes every unmet Stage 0 criterion, including SEC-15 to SEC-17 and staging. The chess rating is back in phase 1 for Stage 1. Amendments are proposed as D11, with a docs ticket.
5. **Open or Proposed decisions were cited as settled.** Fixed. Section 10 lists ADR-005, 020, 024, 025, 026 and 027, the amendments to ADR-013, 015 and 021, and new decisions, each with its open question. ADR-025's answers on caps and bot XP are in D5. The text now says "to be decided in ADR-025" or gives the ADR's status.
6. **Monetisation contradicted itself and STORY_MODE.md.** Fixed. Story chapters and Rush modes are out of Plus. Streak freezes are free and not a coin sink, with a ROADMAP change (D4). The removal of ads and the BO-4 change are explicit owner decisions (D9).
7. **Numbers were stated too strongly.** Fixed:
   1. 10,000 / 450 million is 0.0022%.
   2. The 3.6x and +22% figures are labelled correlations, and the 5x figure a model.
   3. The +1.7%, +0.38% and leagues results are labelled experiments.
   4. The Ludo King lockdown confounder is stated, and "driven by private rooms" is attributed to the research track.
   5. Mittens is put in context ("characters keep players, they do not bring them").
   6. Fortnite is reframed as a paid shop return and not our precedent.
   7. The aggregator argument is replaced by low Indian eCPM (medium confidence).
   8. The absence claims are marked unverified opinion with what was checked.
   9. Spin wheels and "return reasons" are marked research track judgement.
   10. UPI AutoPay is "one example".
   11. The 3.65 s figure is marked as from an unknown location, with a re-measure task.
   12. The 2 s paint and the phone price are labelled as targets and assumptions.
8. **Wrong retention benchmark and no sample sizes.** Fixed. The web caveat is stated, the launch retention targets are lowered and marked as low confidence guesses, and the North Star targets and exit gate are made consistent through a simple model and a 300-player-per-week gate. An acquisition plan with numbers is in section 7.3. Margins of error are given, every retention gate needs cohorts of 300 or more, and guest-to-account and save prompt conversion (M8) are separate metrics with separate denominators.
9. **The North Star could rise while the product fails.** Fixed. There is a person share guardrail, a day of real play includes the daily puzzle and story levels, measurement limits (shared phones, multiple devices, cookies) are recorded, and a bot XP cap of 100 a day is proposed in D5.
10. **Persona priority.** Fixed. Riya, Meena and the searcher are primary, Arjun and Kabir are served, and Kabir's parental consent is no longer a phase 1 dependency. Pass and play (Meena, CC-223) is added, and the teacher persona (Ms Fernandes, CC-070) is added for phase 3. Vikram is folded into "served by chess ratings" to keep six personas.
11. **Shallow game boredom.** Fixed:
    1. Ultimate Tic Tac Toe is a permanent mode (CC-224), with its unsolved status cited.
    2. The 3×3 daily puzzle is dropped.
    3. RPS characters have learnable habits, with star rules based on reading them.
    4. No default bot produces endless draws.
    5. The story slice now includes The Kingdom levels 1 to 4 as a fairer test.
    6. The chess puzzle source is the Lichess database (CC0, 6,157,341 puzzles, fetched).
12. **RPS needs provable fairness.** Fixed. Commit-reveal is in section 6.2 (CC-225) and the mock-up in section 5.4. Adaptive difficulty is disclosed with an off switch and aims at 65 to 70% wins in the first 3 sessions.
13. **Platform risks were missing.** Fixed. The Atlas M0 limits are cited from the fetched page, a same-region paid database is in phase 0 (CC-227), the Render regions are cited, the US$7 figure is marked unverified, the full stack is costed as an estimate (risk 1), and Mumbai is added as an open option in ADR-005.
14. **Safety gaps.** Fixed:
    1. The minor's name is removed from the home mock-up, and the row is gated and limited to opted-in adults.
    2. Guests and unknown ages get minor defaults.
    3. Mixed-age circle rules, circle name filtering and limits on owner powers are in section 6.8.
    4. Share cards never carry a minor's or a guest's username.
    5. CC-150 and CC-151 are sent to the legal review.
15. **India's dark pattern rules were missing.** Fixed. The CCPA 2023 guidelines are cited (general knowledge, high confidence, official text not fetched), every nudge is audited in section 6.9, and an audit ticket is added (CC-229). The PRS page is now labelled as the Bill summary, with a requirement to use the gazetted Act and Rules. I could not fetch the gazette (MeitY returned 403).
16. **"Never punished" conflicted with the mechanics.** Fixed. Promise 7 is softened to "we never take away what you earned", and section 6.5 lists the only penalties allowed. Demotion is at most one tier, a Duo Streak gets a grace day, and the longest streak is kept.
17. **IA and screens got ahead of the phases.** Fixed:
    1. A per-phase IA and per-phase tabs are in section 5.1.
    2. The Diwali banner is removed.
    3. Leaderboards default to Weekly, with League gated.
    4. The mobile result has two lines above Rematch.
    5. Insight appears only where it is cheap and correct.
    6. Season appears in phase 3 only.
18. **Solo owner capacity was not checked.** Fixed. Ticket-week estimates are in section 8.1, based on ROADMAP sizes and an assumed rate, to be replaced by the measured rate. The art plan covers who draws, cost and licence. There is a cut list for phase 2.
19. **Smaller fixes.** Done:
    1. The WhatsApp 2021 and KPMG 2017 figures are marked stale.
    2. Section 8.2 lists every open ticket by ID, with no ranges.
    3. The next free ID, CC-209, was checked against BACKLOG.md, and the PROGRESS.md drift is noted.
    4. Titled Tuesday is cited only for the fixed date idea.

**Proposed new tickets** (the owner creates them in this order so the IDs hold):

1. CC-209 Rush and Streak score modes.
2. CC-210 Weekly arena per game, gated.
3. CC-211 Weekly featured variant.
4. CC-212 Supporter badge.
5. CC-213 Duo Streaks.
6. CC-214 Circles with safe-circle rules.
7. CC-215 Notification preferences and quiet hours.
8. CC-216 Server-rendered game page content.
9. CC-217 WhatsApp share cards.
10. CC-218 String catalogue and Hinglish.
11. CC-219 Hand cricket.
12. CC-220 `gameplay_start` event and time budget report.
13. CC-221 One-tap level pick and a named character as the main button.
14. CC-222 Turn-based Tic Tac Toe, Ultimate and chess with "your move".
15. CC-223 Pass and play on one phone.
16. CC-224 Ultimate Tic Tac Toe as a permanent mode (taken out of CC-066).
17. CC-225 Commit-reveal for RPS characters.
18. CC-226 "Ping me when a person is free" and evening play hours.
19. CC-227 Paid database in the app's region.
20. CC-228 Liquidity gate flags.
21. CC-229 Dark pattern audit against the CCPA 2023 guidelines.
22. CC-230 Art pipeline and licence record.
23. CC-231 Docs edits for D9, D10 and D11.

## Appendix B. Research sources

Fetched on 2026-10-17 unless another date is given.

| Source                                                                                                                                                                                                                                          | Date                                                   | Supports                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| https://www.chess.com/about                                                                                                                                                                                                                     | fetched 2026-10-17                                     | More than 10 million games a day, 650+ staff                                                                                                                                                                                                                      |
| https://www.chess.com/membership                                                                                                                                                                                                                | fetched 2026-10-17                                     | Paid tier sells learning tools, not opponents                                                                                                                                                                                                                     |
| https://www.chess.com/blog/CHESScom/chess-is-booming-and-our-servers-are-struggling                                                                                                                                                             | January 2023                                           | 1 million Daily Puzzle solvers a day, about 10 million daily users in January 2023                                                                                                                                                                                |
| https://en.wikipedia.org/wiki/Mittens_(chess)                                                                                                                                                                                                   | fetched 2026-10-17                                     | 120 million bot games in January 2023, 40 million against Mittens                                                                                                                                                                                                 |
| https://en.wikipedia.org/wiki/Chess.com                                                                                                                                                                                                         | fetched 2026-10-17                                     | 268.6 million members, about 11 million daily users in April 2023                                                                                                                                                                                                 |
| https://lichess.org/about and https://lichess.org/patron                                                                                                                                                                                        | fetched 2026-10-17                                     | More than 5 million games a day, free, patron wings unlock nothing                                                                                                                                                                                                |
| https://en.wikipedia.org/wiki/Lichess                                                                                                                                                                                                           | fetched 2026-10-17                                     | Glicko-2, Puzzle Storm and Racer, arenas, 5.63 billion games, mostly blitz and bullet                                                                                                                                                                             |
| https://database.lichess.org/                                                                                                                                                                                                                   | fetched 2026-10-17                                     | 6,157,341 puzzles under CC0                                                                                                                                                                                                                                       |
| https://en.wikipedia.org/wiki/Ultimate_tic-tac-toe                                                                                                                                                                                              | fetched 2026-10-17                                     | Not solved under standard rules, real strategic depth                                                                                                                                                                                                             |
| https://www.chess.com/news                                                                                                                                                                                                                      | fetched 2026-10-17                                     | Named weekly events such as Titled Tuesday (fixed date idea only)                                                                                                                                                                                                 |
| https://papergames.io/en/                                                                                                                                                                                                                       | fetched 2026-10-17                                     | Closest competitor: games list, coin shop, Gruppo plan, no story mode seen                                                                                                                                                                                        |
| https://playtictactoe.org/                                                                                                                                                                                                                      | fetched 2026-10-17                                     | Two players on one device, minimal friction                                                                                                                                                                                                                       |
| https://developers.poki.com/guide/requirements-quality                                                                                                                                                                                          | fetched 2026-10-17                                     | Under 10 s load, no login wall                                                                                                                                                                                                                                    |
| https://developers.poki.com/guide/reading-results                                                                                                                                                                                               | fetched 2026-10-17                                     | 65% conversion to play, 5+ minute playtime                                                                                                                                                                                                                        |
| https://developers.poki.com/guide/easy-access                                                                                                                                                                                                   | fetched 2026-10-17                                     | Skip splash screens, explain with visuals, portrait mobile                                                                                                                                                                                                        |
| https://developers.poki.com/guide/engagement                                                                                                                                                                                                    | fetched 2026-10-17                                     | About 3 minute loops, web players return less than mobile                                                                                                                                                                                                         |
| https://developers.poki.com/guide/what-we-look-for                                                                                                                                                                                              | fetched 2026-10-17                                     | Originality over clones                                                                                                                                                                                                                                           |
| https://developers.poki.com/guide/working-with-poki                                                                                                                                                                                             | fetched 2026-10-17                                     | Web exclusivity requirement                                                                                                                                                                                                                                       |
| https://developers.poki.com/guide/how-monetization-works                                                                                                                                                                                        | fetched 2026-10-17                                     | Ads only at natural breaks, rewarded ads optional                                                                                                                                                                                                                 |
| https://poki.com/en and https://poki.com/en/g/tic-tac-toe                                                                                                                                                                                       | fetched 2026-10-17                                     | Portal home layout, game page layout for search, 1,500 games                                                                                                                                                                                                      |
| https://en.wikipedia.org/wiki/CrazyGames                                                                                                                                                                                                        | fetched 2026-10-17                                     | About 4,500 games, 31 million+ monthly users                                                                                                                                                                                                                      |
| https://www.playok.com/en/                                                                                                                                                                                                                      | fetched 2026-10-17                                     | Live player counts as a sign of life                                                                                                                                                                                                                              |
| https://fr.wikipedia.org/wiki/Board_Game_Arena                                                                                                                                                                                                  | fetched 2026-10-17                                     | About 10 million accounts, real-time and turn-based play                                                                                                                                                                                                          |
| https://en.wikipedia.org/wiki/Wordle                                                                                                                                                                                                            | fetched 2026-10-17                                     | Share grid growth, decline a year after peak                                                                                                                                                                                                                      |
| https://core.telegram.org/bots/games                                                                                                                                                                                                            | fetched 2026-10-17                                     | In-chat high scores, the model for circle boards                                                                                                                                                                                                                  |
| https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth                                                                                                                                                                           | 2023                                                   | 5x model sensitivity, leagues experiment (+17%), referrals +3%, copied mechanic with no effect                                                                                                                                                                    |
| https://blog.duolingo.com/how-duolingo-streak-builds-habit/                                                                                                                                                                                     | 2022-01-31                                             | 3.6x (correlation), +1.7% day 7 (experiment), +0.38% with 2 freezes (experiment)                                                                                                                                                                                  |
| https://blog.duolingo.com/friend-streak/                                                                                                                                                                                                        | 2024-08-05                                             | +22% with a friend streak (correlation), mutual invites                                                                                                                                                                                                           |
| https://en.wikipedia.org/wiki/Battle_pass                                                                                                                                                                                                       | fetched 2026-10-17                                     | Fear of missing out criticism, passes that never expire, Fortnite returns items to its paid shop                                                                                                                                                                  |
| https://en.wikipedia.org/wiki/Loot_box                                                                                                                                                                                                          | fetched 2026-10-17                                     | Belgium 2018 gambling ruling                                                                                                                                                                                                                                      |
| https://www.nngroup.com/articles/push-notification/                                                                                                                                                                                             | fetched 2026-10-17                                     | Ask after value, send fewer                                                                                                                                                                                                                                       |
| https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations                                                                                             | 2022-12-19                                             | Chat off by default for minors, $275 million and $245 million                                                                                                                                                                                                     |
| https://ico.org.uk/.../age-appropriate-design-a-code-of-practice-for-online-services/                                                                                                                                                           | fetched 2026-10-17                                     | High privacy by default, no nudges, profiling off                                                                                                                                                                                                                 |
| https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Act,_2023                                                                                                                                                                        | fetched 2026-10-17                                     | No tracking or behavioural monitoring of under-18s, remaining provisions from 13 May 2027                                                                                                                                                                         |
| https://prsindia.org/billtrack/the-promotion-and-regulation-of-online-gaming-bill-2025                                                                                                                                                          | fetched 2026-10-17                                     | Bill summary: money games banned, convertible coins are stakes, penalties. Not the gazetted Act                                                                                                                                                                   |
| https://en.wikipedia.org/wiki/Promotion_and_Regulation_of_Online_Gaming_Act,_2025                                                                                                                                                               | fetched 2026-10-17                                     | Assent 22 Aug 2025, Rules in 2026, moderate reliability                                                                                                                                                                                                           |
| CCPA Guidelines for Prevention and Regulation of Dark Patterns, 2023                                                                                                                                                                            | notified November 2023, not fetched (PIB returned 403) | The 13 named patterns. General knowledge, high confidence                                                                                                                                                                                                         |
| https://www.trai.gov.in/                                                                                                                                                                                                                        | updated 2026-10-16                                     | 1,114 million internet subscribers in June 2026                                                                                                                                                                                                                   |
| https://gs.statcounter.com/os-market-share/mobile/india                                                                                                                                                                                         | September 2026                                         | 93.9% Android, 77.3% mobile web traffic                                                                                                                                                                                                                           |
| https://en.wikipedia.org/wiki/Video_games_in_India                                                                                                                                                                                              | fetched 2026-10-17                                     | 450 million online gamers (EY 2024), 41% women (Lumikai and Google 2023)                                                                                                                                                                                          |
| https://en.wikipedia.org/wiki/Ludo_King                                                                                                                                                                                                         | fetched 2026-10-17                                     | 75% Indian audience, local play for up to 6, lockdown playtime rise                                                                                                                                                                                               |
| https://en.wikipedia.org/wiki/Gukesh_Dommaraju and https://en.wikipedia.org/wiki/Chess_in_India                                                                                                                                                 | fetched 2026-10-17                                     | World champion December 2024, Indian chess momentum                                                                                                                                                                                                               |
| https://en.wikipedia.org/wiki/2026_Indian_Premier_League                                                                                                                                                                                        | fetched 2026-10-17                                     | 515 million opening weekend viewers                                                                                                                                                                                                                               |
| https://en.wikipedia.org/wiki/Diwali                                                                                                                                                                                                            | fetched 2026-10-17                                     | Lakshmi Puja on 8 November 2026                                                                                                                                                                                                                                   |
| https://www.winzogames.com/                                                                                                                                                                                                                     | fetched 2026-10-17                                     | One post-Act example of UPI AutoPay subscriptions                                                                                                                                                                                                                 |
| https://render.com/docs/free                                                                                                                                                                                                                    | fetched 2026-10-17                                     | Free plan sleeps after 15 minutes, about a minute to wake                                                                                                                                                                                                         |
| https://render.com/docs/regions                                                                                                                                                                                                                 | fetched 2026-10-17                                     | Oregon, Ohio, Virginia, Frankfurt, Singapore. No Indian region                                                                                                                                                                                                    |
| https://render.com/pricing                                                                                                                                                                                                                      | fetched 2026-10-17                                     | Showed no instance prices, so the cost estimate is unverified                                                                                                                                                                                                     |
| https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/                                                                                                                                                                           | fetched 2026-10-17                                     | M0: 100 operations a second, 500 connections, 0.5 GB, throttling                                                                                                                                                                                                  |
| Production GETs and curl against https://nocapgaming.onrender.com                                                                                                                                                                               | 2026-10-17                                             | Empty leaderboards, empty page bodies, 3.65 s first byte from an unknown location, 132 KB script, 392 KB preview image                                                                                                                                            |
| Repo: docs/BACKLOG.md, DECISIONS.md, KNOWN_ISSUES.md, ROADMAP.md, BRD.md, PROGRESS.md, ux/MATCH_EXPERIENCE.md, investigations/2026-10-17-cross-browser-a11y-load.md, story/STORY_MODE.md (origin/cc-179-story-mode-design), packages/shared/src | 2026-10-17                                             | Ticket states, stage criteria, ADR statuses, open SEC findings, sizes, economy and story design, load findings                                                                                                                                                    |
| General knowledge (marked inline with confidence)                                                                                                                                                                                               | as stated                                              | Retention benchmarks, Indian eCPM, gateways and prices, WhatsApp 2021 figure, KPMG and Google 2017, Supercell season ranks, Steam and Xbox achievements, Yancey and Settles 2020, Mumbai hosting options, art commission prices, copyright of machine-made images |
