# Redesign plan: waves, build order, lanes and completion criteria

The plan for ClassiCade's premium redesign after the October audit ([AUDIT-2026-10.md](AUDIT-2026-10.md), CC-320).
Written 2026-10-21 by the design lead. The owner delegated every design decision on 2026-10-21 ("make the design
decisions independently"); each decision below is marked "design lead, owner-delegated 2026-10-21" in its ticket
and can be changed by the owner. Rules it follows: CLAUDE.md working agreement rules 6 and 9 (at most five
builders, only on separate files), decision-first rule 6 (files touched), [CONTRACT.md](CONTRACT.md) (ADR-076) and
[EFFECTS-STACK.md](EFFECTS-STACK.md) (ADR-075).

## 1. The waves

| Wave | Goal                                          | Tickets                                                                                                                                 | Starts when                                    |
| ---- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1    | Foundations (in flight)                       | CC-322 first route under 150 kB and the bundle gate; CC-323 shared components; CC-324 header; CC-325 test dates                         | Running on 2026-10-21                          |
| 2a   | Systems the pages need: effects, tokens, copy | **CC-328** effects registry and themes; **CC-329** light identity; **CC-332** two-language copy; CC-154 (the layout probe, recommended) | CC-323 and CC-324 merged on `main`             |
| 2b   | The screens players see most                  | **CC-327** match stage and result; **CC-331** home and profile; **CC-330 part A** gaming components                                     | Each lane's 2a predecessors merged (section 3) |
| 2c   | Rewards inside the new result                 | CC-099 reward queue (needs CC-315 and CC-327)                                                                                           | CC-315 and CC-327 merged                       |
| 3    | The gaming layer and the polish               | **CC-330 part B** placements; CC-153 parts b, c (stagger) and e; CC-205 more themes; CC-280 settings                                    | CC-099 and CC-331 merged                       |

Why this order: every Wave 2b screen is built from Wave 1's components (CC-323), sits under Wave 1's header (CC-324)
and is checked by Wave 1's bundle gate (CC-322). The match stage calls CC-328's `play`, reads CC-329's tokens and
CC-332's copy shape, so those three come first. CC-099 fills the result layout CC-327 builds, so it comes after it,
never beside it. Diwali starts on 2026-11-06, so **CC-328 merges by 2026-11-03**.

## 2. Parallel lanes and file locks

At most one ticket per lane at a time; lanes in the same wave never share a file. "Owner" means the only ticket in
that wave allowed to edit the file.

### Wave 2a

| Lane | Ticket                                         | Owns in this wave                                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | CC-328 effects and themes                      | `apps/web/src/effects/**`, `components/Layout/Layout.jsx` (one line), `pages/HomePage/HomePage.jsx` (one line), `styles/global.css`, `pages/AdminPage/FlagsPanel.*`, `packages/shared/src/flags.js`, `eslint.config.js`, `eslint-rules/popupContract.mjs`, `docs/design/CONTRACT.md`, `docs/CREDITS.md`, `e2e/flags.spec.js`, `e2e/effects.visual.js` |
| B    | CC-329 light identity                          | `styles/tokens/palette.css`, `styles/tokens/elevation.css`, `styles/tokenRoles.js`, `styles/tokens.test.js`, `art/badges/Medal.module.css`, `art/art.test.jsx`, `pages/LeaderboardPage/LeaderboardPage.module.css`, `pages/AdminPage/DesignPage.*`                                                                                                    |
| C    | CC-332 two-language copy                       | `components/Bilingual/**`, `components/Profile/{Bilingual.jsx,Profile.module.css,profileCopy.js}`, Bilingual imports in `pages/ProfilePage/*`, `components/{Friends,Challenges,Feedback,Report,YearSelect}/*`, `pages/{FriendsPage,FriendLinkPage,ChallengePage,SignupPage}/*`, `docs/design/COPY.md`, `e2e/feedback.spec.js`, `e2e/friends.spec.js`  |
| D    | CC-154 layout probe (recommended, test ticket) | `e2e/layoutProbe.js` (new, its first PR), `e2e/layout-probe.spec.js`, `e2e/personas.js` (stress data), `e2e/shards.js`                                                                                                                                                                                                                                |

### Wave 2b

| Lane | Ticket                          | Owns in this wave                                                                                                                                                                                                                                                                                                                                                                                                | Waits for                                     |
| ---- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| A    | CC-327 match stage and result   | `components/MatchShell/**`, `components/{Seats,TurnBanner,Rematch,ShareResult}/*`, `components/Celebrations/ResultCelebration.jsx`, `games/**`, `pages/{RoomPage,PassAndPlayPage}/*`, `styles/tokens/space.css`, `docs/design/CONTRACT.md`, `docs/DECISIONS.md` (ADR-049 amendment), `e2e/match-stage.spec.js`, `e2e/match-stage.visual.js`, `e2e/shards.js`, `e2e/{match-shell*,pass-and-play,rematch}.spec.js` | CC-328, CC-329, CC-332 merged                 |
| B    | CC-331 home and profile         | `pages/{HomePage,ProfilePage}/*`, `components/{Profile,Achievements,Quests,Streaks}/*`, `art/illustrations/DailyPuzzleArt.jsx`, `art/HeroArt.module.css`, `app/routePages.js`, `docs/CREDITS.md`, `e2e/{visitor,profiles}.spec.js`, `e2e/home-profile.visual.js`                                                                                                                                                 | CC-328 (HomePage line), CC-329, CC-332 merged |
| C    | CC-330 part A gaming components | `components/Gaming/**`, `components/Motion/presets.js`, `pages/AdminPage/DesignPage.*`, `e2e/owner.spec.js`                                                                                                                                                                                                                                                                                                      | CC-329 merged                                 |

### Files no Wave 2 ticket edits

`docs/BACKLOG.md`, `docs/PROGRESS.md` and every next-free line (the coordinator's), `e2e/accessibility.spec.js`,
`e2e/visual.spec.js` and `e2e/baselines.visual.js` (each ticket runs axe inside its own spec and adds its own
`*.visual.js` baseline file), `e2e/fixtures.js`, `components/Layout/*` beyond CC-328's one line (CC-324's),
`app/App.jsx` (CC-322's), `components/Toast/*` and `lib/notify/*` (CC-315's).

### Hand-overs between tickets (for the coordinator)

| From          | To               | What                                                                                                                       |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| CC-328        | CC-099           | CC-099's `CelebrationStage` is CC-328's `EffectHost`; CC-099 calls `play()` and removes `art/effects/` and `confetti-fall` |
| CC-327        | CC-099           | CC-099's "where each item sits" is replaced by CC-327's `ResultLayout`: it fills the `beat` and `summary` slots            |
| CC-327        | CC-161           | CC-161 is narrowed to the server's `series.history`; CC-327's scoreboard draws its dots                                    |
| CC-327        | CC-172           | Absorbed: board sizing, phone strips, the sheet, the action bar row                                                        |
| CC-327        | CC-166 to CC-168 | Their visual unification is done by CC-327; close them when what remains of them is checked                                |
| CC-331        | CC-153c          | The hover tilt is replaced by the card lift; the stagger-in and hero intro stay in CC-153c, after CC-331                   |
| CC-328        | CC-205           | Holi, New Year and board skins become CC-328-style registry entries                                                        |
| CC-330 part A | CC-099, CC-153e  | The beats and the trophy shelves use the gaming components                                                                 |

## 3. Build order, step by step

1. **Now (Wave 1):** CC-322, CC-323, CC-324, CC-325 finish and merge. CC-315 continues its spec review.
2. **Wave 2a, four lanes at once** (from the day CC-323 and CC-324 are on `main`): CC-328 (deadline 2026-11-03),
   CC-329, CC-332, and CC-154's probe. CC-154 merges `e2e/layoutProbe.js` in its first small PR, so the other lanes
   import it instead of writing their own.
3. **Owner check, 2026-11-04 and 2026-11-05:** the owner previews `diwali_2026` from the console and sets
   `event_diwali_2026` On; the window turns it on at India midnight on 2026-11-06.
4. **Wave 2b, three lanes:** CC-330 part A as soon as CC-329 is in; CC-331 and CC-327 once CC-328, CC-329 and CC-332
   are in.
5. **Wave 2c:** CC-099 after CC-315 and CC-327.
6. **Wave 3:** CC-330 part B behind `gaming_layer`, then CC-153e; CC-153b with Bit in the result; CC-205's next themes.

## 4. Completion criteria (every ticket, every page)

From the owner's brief. A page is finished only when every box is ticked. Each ticket's acceptance criteria name the
test for each.

1. **Tokens only.** No raw colour, size, weight, `z-index` or breakpoint outside the token files (`npm run lint`);
   event themes set only `THEMEABLE_TOKENS` (CC-328).
2. **Every state.** Rest, loading (`Skeleton`), empty (`EmptyState`), error (`ErrorState`), and the page's own states,
   in light and dark, each with a baseline in the ticket's own `*.visual.js`.
3. **Layout probe** at 320, 360, 390, 768, 1024 and 1280 px wide and at 640 × 360 (200 % zoom of 1280 × 720, CC-154
   D1): nothing wider than the viewport, no clipped text, no overlap.
4. **axe: 0 serious** (and 0 critical), CC-183 rule set, light and dark.
5. **Motion catalogue entry and tier** (section 5) for every animation the page adds.
6. **At most one standout effect at once** (ADR-012, the effect host's queue).
7. **Reduced motion respected:** nothing moves, final states show at once, meaning stays in words.
8. **Cleanup on unmount:** no timer, listener, animation frame or effect left running.
9. **The first route stays at or under 150 kB gzip**, checked by CC-322's bundle gate
   (`node scripts/bin/check-bundle.mjs`, CI step "Bundle size budget").

### Checklist per page

`T` tokens, `S` every state, `P` probe, `A` axe, `M` motion entry, `1` one standout, `R` reduced motion, `C` cleanup,
`B` bundle. Tick in the ticket's PR.

| Page or surface                                      | Ticket         | T   | S   | P   | A   | M   | 1   | R   | C   | B   |
| ---------------------------------------------------- | -------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Room: Rock Paper Scissors playing and result         | CC-327         | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |
| Room: Tic-Tac-Toe playing and result                 | CC-327         | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |
| Room: Chess playing, dialog and result               | CC-327         | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |
| Pass and play: setup, playing, result                | CC-327         | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |
| Home: visitor, guest, account                        | CC-331, CC-328 | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |
| Profile: Overview, Achievements, Settings            | CC-331         | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |
| Every page with an event theme on                    | CC-328         | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |
| Leaderboard medals, chess board, win card (light)    | CC-329         | ☐   | ☐   | ☐   | ☐   | —   | —   | —   | —   | ☐   |
| Feedback dialog, friends, challenges, sign-up helper | CC-332         | ☐   | ☐   | ☐   | ☐   | —   | —   | —   | —   | ☐   |
| Design page: gaming components                       | CC-330 part A  | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |
| Header, home strip, profile: gaming layer            | CC-330 part B  | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   | ☐   |

"—" means the ticket adds no motion there; it still must not change any existing motion.

## 5. Motion catalogue (Wave 2)

Every animation Wave 2 adds, with its tier (ADR-075), tool, properties, timing and reduced-motion behaviour. A
builder who needs to differ changes this table in their own PR (only the lane that owns the entry edits it).
Durations and easings are the tokens in `styles/tokens/motion.css`; keyframes hold literal values, never `var()`.

| Id      | Ticket | What                                 | Tier         | Tool                                        | Properties                                          | Timing                                   | Standout? | Reduced motion                        |
| ------- | ------ | ------------------------------------ | ------------ | ------------------------------------------- | --------------------------------------------------- | ---------------------------------------- | --------- | ------------------------------------- |
| M-327-1 | CC-327 | Result panel enters beside the board | Simple       | CSS keyframe                                | `opacity`, `transform: translateY(0.75rem)`         | `--duration-slow`, `--ease-out`          | No        | Appears in place                      |
| M-327-2 | CC-327 | Phone result sheet rises and lowers  | Simple       | CSS transition                              | `transform: translateY()`                           | `--duration-slow`, `--ease-out`          | No        | Jumps to place                        |
| M-327-3 | CC-327 | Score bump when the series changes   | Simple       | CSS keyframe                                | `transform: scale(1.15)`                            | `--duration-slow`, `--ease-spring`, once | No        | None; announced once                  |
| M-327-4 | CC-327 | Turn ring and glow change            | Simple       | CSS transition on a glow layer              | `opacity` of the `::after` glow                     | `--duration-base`                        | No        | Instant                               |
| M-327-5 | CC-327 | A real win                           | Advanced     | `play("win_burst")` (M-328-1)               | canvas                                              | 1200 ms                                  | **Yes**   | Not played                            |
| M-328-1 | CC-328 | `win_burst`                          | Advanced     | Canvas particles                            | canvas, 120 particles (80 phone, 40 low-end)        | 1200 ms                                  | **Yes**   | Not played                            |
| M-328-2 | CC-328 | `achievement`                        | Advanced     | Canvas particles                            | canvas, 48 (16)                                     | 900 ms                                   | **Yes**   | Not played                            |
| M-328-3 | CC-328 | `level_up`                           | Advanced     | Canvas particles                            | canvas, 90 (80 phone, 30 low-end)                   | 1200 ms                                  | **Yes**   | Not played                            |
| M-328-4 | CC-328 | Diwali entrance sparks               | Advanced     | Canvas particles, once per visit on home    | canvas, 60 (20)                                     | 1200 ms                                  | **Yes**   | Not played; colours and greeting stay |
| M-328-5 | CC-328 | Winter entrance snow                 | Advanced     | Canvas particles, once per visit on home    | canvas, 40 (14)                                     | 1500 ms                                  | **Yes**   | Not played; colours and greeting stay |
| M-330-1 | CC-330 | Level badge pop                      | Simple       | CSS keyframe                                | `transform: scale()`                                | `--duration-slow`, `--ease-spring`       | No        | Final state                           |
| M-330-2 | CC-330 | XP bar fill                          | Intermediate | Motion `progress` preset                    | `transform: scaleX()`                               | up to 600 ms, `--ease-out`               | No        | Final state                           |
| M-330-3 | CC-330 | Streak flame flicker (on growth)     | Simple       | CSS keyframe, 3 flickers                    | `transform`                                         | 900 ms total                             | No        | Still flame                           |
| M-330-4 | CC-330 | Progress ring sweep                  | Simple       | CSS transition from script                  | `stroke-dashoffset` (ADR-012 stroke exception)      | 600 ms, `--ease-out`                     | No        | Final state                           |
| M-330-5 | CC-330 | Achievement badge pop-in             | Simple       | CSS keyframe                                | `opacity`, `transform: scale()`                     | `--duration-slow`                        | No        | Final state                           |
| M-330-6 | CC-330 | Animated counter                     | Intermediate | Motion `animate()` on a `MotionValue`, lazy | text from script                                    | at most 1200 ms (`--duration-celebrate`) | No        | Final number at once                  |
| M-331-1 | CC-331 | Game card lift on hover and focus    | Simple       | CSS transition                              | `transform: translateY(-4px)`, glow layer `opacity` | `--duration-fast`, `--ease-out`          | No        | No lift; the focus ring still shows   |
| M-331-2 | CC-331 | Settings anchor scroll               | Simple       | `scroll-behavior: smooth`                   | scroll                                              | the browser's                            | No        | `auto` (jump)                         |

CC-329 and CC-332 add no motion.

## 6. Key decisions in one place

| Decision                | Answer (design lead, owner-delegated 2026-10-21)                                                                                       | Ticket |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Result position         | Beside the board from 64rem; a non-modal bottom sheet below 64rem, with a "View board" peek                                            | CC-327 |
| Result action order     | Outcome once, beat slot, Rematch, New opponent, a quiet row of Share and Leave, then the summary                                       | CC-327 |
| Board size              | `min(100cqi, 100cqb, 40rem)`, CSS only, centred                                                                                        | CC-327 |
| Clocks and turn         | One clock per player, in its strip; the turn as a ring in the player colour on the board, plus words                                   | CC-327 |
| Marks                   | By player colour (you, opponent), not by letter                                                                                        | CC-327 |
| Diwali window           | 2026-11-06 to 2026-11-11 (Dhanteras to Bhai Dooj; Lakshmi Puja Sunday 8 November, Drik Panchang, read 2026-10-21), removeBy 2026-11-30 | CC-328 |
| Diwali look             | Warm gold over the night arcade, a still band of diyas, 60 subtle sparks once per visit, one greeting line on home                     | CC-328 |
| Winter theme            | "Winter nights", 2026-12-21 to 2027-01-04, flag off, removeBy 2027-01-15                                                               | CC-328 |
| What a theme may change | Decoration tokens only (`THEMEABLE_TOKENS`), never status, player, text or surface                                                     | CC-328 |
| Light page and gold     | Page `#efedff`; gold as fills (`#ffc933`) with ink text; win card `--gradient-win`                                                     | CC-329 |
| Medals                  | Fixed metal fills with rims, the same in both themes                                                                                   | CC-329 |
| Chess board             | A night board, `#a59ef0` and `#5d52c4` framed in `#1b1a3d`, in both themes                                                             | CC-329 |
| Gaming components       | Six components now (part A), placed in Wave 3 behind `gaming_layer` (part B)                                                           | CC-330 |
| Home                    | Phone hero at most 60svh, "Play <last game>" for returning players, three columns from 48rem, art to the edges                         | CC-331 |
| Profile                 | Three tabs as routes (Overview, Achievements, Settings) and a danger zone                                                              | CC-331 |
| Two languages           | Hinglish main line (body, medium), English second line (label, muted), caps 80 and 100 characters, titles and controls in English      | CC-332 |
| Flags                   | Only the event themes and CC-330 part B have flags; the layout and token changes ship without one and roll back by revert              | all    |
