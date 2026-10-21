# Domain: Look and feel

How ClassiCade looks, moves and sounds: the arcade identity, Bit and the art, animation and effects, sound feel,
loading and empty states, page transitions, responsive polish, themes and reduced motion. This file sets the scope,
the rules, the research, every ticket in the domain and the order to build them. Written 2026-10-19 (research and
planning only, no code). The owner accepted every decision on 2026-10-19 (ADR-052).

## 1. Purpose and scope

**Purpose.** Make every screen feel warm, alive and finished on a budget Android phone, without slowing the first
move, without hiding meaning in motion or sound, and without pushing anyone (PRODUCT_VISION principles 9, 10, 11).

### In scope

| Area                    | What it covers                                                                                                                       | Existing base                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Visual identity         | Tokens (colour, type, space, radius, shadow, motion), the neon arcade theme, the logo, game accents                                  | ADR-009, ADR-012, `styles/tokens.css`               |
| Art and mascot          | Hand-drawn SVG components, Bit and his poses, character art, avatars and frames as drawings, the chess piece set, icons              | `apps/web/src/art/`, CC-230, ADR-024 point 6        |
| Art pipeline, licences  | CREDITS.md and its test, the licence allowlist, the assignment deed for commissioned art, the in-app credits page                    | CC-230, `docs/art/README.md`, `docs/CREDITS.md`     |
| Animation and effects   | Keyframes, Motion where it is already used, confetti, bursts, XP pops, the reward choreography, exit animations                      | ADR-012 rule 3, ADR-016, ADR-050 point 1            |
| Sound feel              | The synthesised recipes and how each moment sounds (not the notification routing, which is shared)                                   | ADR-018, CC-103, CC-208                             |
| Outcome moments         | Tone, effect, sound and Bit's face for each way a game ends, and the kind loss lines                                                 | ADR-050 point 2, CC-163                             |
| Empty and loading       | Empty states with one line and one button, loading and skeleton states, the waking-up screen, the 404                                | CC-259, CC-232, NN/g                                |
| Page transitions        | Cross-fades between routes through the View Transitions API                                                                          | ADR-050 point 4                                     |
| Responsive polish       | Nothing clipped or wider than the screen on any page, long names, 320 px to 1280 px, visual baselines                                | CC-154, CC-155, CC-256, CC-270                      |
| Themes                  | Light and dark, a player's own choice, `theme-color`, the hook seasonal skins plug into                                              | ADR-012, `tokens.css` dark block                    |
| Reduced motion, haptics | The OS setting, an in-app choice, and the rule that every animated or sounded state also has words; vibration on Android as an extra | ADR-012 rule 4, `useReducedMotion`, global.css rule |

### Out of scope

Game rules and engines, matchmaking and bots (`packages/games`, ADR-040), social features (friends, circles, emotes
as a feature, sharing), progression rules (XP, unlocks, coins, seasons as rules), analytics and telemetry, the
string catalogue and translations (CC-218), hosting, bundle splitting as infrastructure (CC-135).

### Boundaries with the neighbouring domains

| Neighbour            | They own                                                                                                                                           | Look and feel owns                                                                                                                                                           | Shared files and the rule                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match experience     | `MatchShell` and its slots, the match bar, presence, requests, the layout and board sizing (CC-157 done, CC-161, CC-165, CC-166 to CC-168, CC-172) | What goes into the result slot: the outcome moment (CC-163), the reward queue (CC-099), Bit's face, the effects and their sounds. Tokens and keyframe recipes the shell uses | `MatchShell.jsx`, `MatchShell.module.css` and `Celebrations/*` are touched by both. CC-163 and CC-099 never run at the same time as CC-161 or CC-172 (section 6). The shell keeps CSS keyframes, not Motion (ADR-049 point 3) |
| Social and sharing   | Emotes as a feature (CC-169), win and share cards (CC-217, CC-153h), public profiles and picking an avatar (CC-034), who sees what (ADR-028)       | The drawings: Bit's emote poses, the avatar and frame art, the card's visual template and tokens                                                                             | Art is delivered as components in `art/`; the feature that shows it lives with Social                                                                                                                                         |
| Story mode           | Levels, dialogue, the story map and level pages, quest inside the shell (CC-188 to CC-201)                                                         | Character art production (CC-194), Bit's drawing and poses, the art rules of STORY_MODE §3, the deed (CC-267)                                                                | `art/characters/` is ours; story pages import it                                                                                                                                                                              |
| Accessibility        | Keyboard, focus, roles, screen reader wording, the axe audit (CC-048, CC-100, CC-183)                                                              | Contrast of every token pair, reduced motion, "never sound or motion alone", flashing limits (WCAG 2.3.1), clipped text (CC-154)                                             | Contrast and clipping checks live in CC-154's browser check; Accessibility reuses them                                                                                                                                        |
| Platform and growth  | Bundle splitting and the CI budget (CC-135), PWA manifest and push (CC-148), link preview images (CC-047, CC-216), the brand domain (CC-123)       | The size budget each look and feel PR must keep, the app icon drawings a manifest needs                                                                                      | CC-135 is the gate that enforces our budget                                                                                                                                                                                   |
| Progression, seasons | Unlock rules (CC-143), seasons and event quests (CC-055), cosmetics store (CC-063), the Founder frame as a product (CC-212)                        | How an unlock, a frame or a seasonal skin looks and animates                                                                                                                 | Skins and frames are art and tokens; when they unlock is a rule                                                                                                                                                               |

## 2. Principles

1. **Fast on a ₹8,000 to ₹15,000 Android phone on patchy 4G.** 94 % of mobile use in India is Android (StatCounter,
   September 2026). Budgets:
   1. The first route stays at or under 150 KB gzip of JavaScript (vision §6.11), the main chunk and its
      preloads together. CI fails a PR over it (`node scripts/bin/check-bundle.mjs`, CC-135, CC-322). Since CC-322
      the first route is about 146 kB (the main chunk about 132 kB). A look and feel PR records its gzip growth; the whole of CC-153 may add at most
      6 kB to the main chunk (CC-153 acceptance). Effects, Bit poses below the fold and the reward queue load lazily.
   2. Animate only `transform` and `opacity` (ADR-012, web.dev animations guide). The two documented exceptions
      stay the only ones. No canvas backgrounds, no video, no full-screen particle systems (ADR-016 amendment).
      The one exception is a finite, capped celebration burst through the effect registry (ADR-075).
   3. At most one full-screen effect at a time, nothing loops forever, celebrations finish within 1.5 s (ADR-012,
      ADR-050). UI transitions 300 ms or less (vision §5.13, NN/g).
   4. Layout never shifts because something loaded (target CLS under 0.1, Core Web Vitals) and a press answers
      within 100 ms (ADR-038). Nothing in this domain may delay the first move (CC-220 measures it).
   5. Tested on a throttled profile: Chrome DevTools CPU 4x slowdown and a slow 4G profile, the stand-in for Alex
      Russell's Galaxy A51-class reference device (section 3.6).
   6. SVG components only, each file under 20 KB (the credits test). A file asset only when code cannot draw it.
2. **CSP-safe.** The CSP is `script-src 'self'; style-src 'self'; img-src 'self' data:` (`requestGuards.js`). No
   `style` attribute and no `<style>` element (lint rule), no `eval` (so no full Lottie build), no fonts or images from
   another origin, styles set from script are fine (ADR-016 point 4).
3. **Reduced motion is complete.** Under `prefers-reduced-motion` (and the in-app choice, CC-280) durations are 0,
   `global.css` stops animations, effect components render nothing, and every beat still comes in the same order as
   words. No luminance flashing at all (WCAG 2.3.1). Motion from interaction can be turned off (WCAG 2.3.3).
4. **Meaning never lives in motion, colour or sound alone.** Every animated or sounded state also has text and a
   screen reader announcement (ADR-012 rule 3, CC-208).
5. **Licences per CC-230.** Every asset has a row in `docs/CREDITS.md` before it merges. Allowed:
   `LicenseRef-ClassiCade`, `CC0-1.0`, `CC-BY-4.0`, `MIT`, `BSD-3-Clause`, `OFL-1.1`. Never BY-SA, NC or ND. Bit is
   drawn by a person, never AI. Commissioned art only after the signed deed (CC-267).
6. **No dark patterns.** No countdowns, "at risk" lines, loss-framed or shaming words, random reveals or a sad Bit
   used to guilt (CCPA 2023 guidelines, ADR-050 point 2, CC-229). Celebration is never a reason to stay.
7. **Minors.** The look is the same for everyone, because it is cosmetic. Nothing in this domain shows a minor's or
   guest's name to others, asks for permissions, or personalises by behaviour (ADR-028, vision principle 5). Haptics
   and sound follow the player's settings, never on before a tap.
8. **Tokens are the only source** of colour, size and motion (ADR-009, ADR-012). New screens use tokens and the art
   registries.

## 3. Research

Sources read on 2026-10-19 unless another date is given. Earlier research for this domain is in
[CC-099](../tickets/CC-099.md) (reward choreography, game feel, sound etiquette, WCAG), [CC-153](../tickets/CC-153.md)
(mascot, home, transitions, trophy cabinet, avatars), [CC-163](../tickets/CC-163.md) (outcome moments),
[CC-259](../tickets/CC-259.md) (empty states) and [CC-230](../tickets/CC-230.md) (licences); it is not repeated here.

### 3.1 How our code does it today

1. **Tokens** (`styles/tokens.css`): colours for light and dark, a system display font, seven text sizes, spacing,
   radii, shadows, glows, and five durations (80, 120, 200, 360, 1200 ms) with three easings. Dark follows
   `prefers-color-scheme` only. There is no in-app theme choice, no `theme-color` meta tag, and the vision's "dark
   theme by default" (§5.13) is not what the code does: the OS decides.
2. **Motion**: 37 `@keyframes` across the CSS modules, mostly on tokens, but raw values remain (Bit's 400 ms glow,
   the flame's 900 ms flicker, staggered delays in `effects.module.css`, the waking-up screen's timings), and two
   names are defined twice (`spin`, `slide-in`). Motion (ADR-016) loads only on the chess page. There are no exit
   animations: toasts and dialogs vanish. Reduced motion is the OS setting only; the vision's "Motion: full / reduced"
   setting (§5.12) does not exist.
3. **Art**: hand-drawn SVG in `art/` (hero, game tiles, glyphs, medals, achievement icons, effects, 404, empty
   matches, invite). The placeholder Bit (`art/bit/Bit.jsx`, six poses) is not placed on any page yet. UI icons are
   drawn per component (`MenuIcon` in `Layout`, the sound icons, `TabIcon`, `QuestIcon`), and some are text glyphs
   or emoji (`✓`, `×`, `🔒`, `⚠`), which look different on each Android maker's font.
4. **Sound**: 21 synthesised sounds (`lib/sound/sounds.js`), six notification categories with volume and on or off
   (CC-208). Every outcome reason sounds the same apart from win, loss and draw (CC-163 fixes it).
5. **Loading**: twelve ad hoc "Loading…" paragraphs (profile, quests, streaks, achievements, leaderboard, home,
   room, admin), no reserved space, so content jumps in. The cold start has its own screen (CC-232).
6. **Known breakages**: confetti or the level-up burst makes the page wider than a phone (CC-270), a 20 character
   name breaks the header and profile on phones (CC-256), chess move numbers clip (CC-154).

### 3.2 Game feel and juice

- **Jonasson and Purho, "Juice it or lose it"** (GDC Europe 2012, gdcvault.com/play/1016487) and **Steve Swink,
  _Game Feel_** (2008): many small, immediate responses to the player's own action make it feel good; too many at
  once become noise. **Our take:** juice the player's own actions (a press, a placed mark, a win), one effect and one
  sound per beat (ADR-050), less for a win the player did not earn by play (forfeit).
- **Duolingo** (blog.duolingo.com, 2022-01-21 and 2022-01-31): one reward per moment, tuned timings, the mascot as
  the celebration; the streak animation raised day 7 retention by 1.7 %. **Our take:** Bit is the face of each
  feeling (CC-153b), and the queue sets the order (CC-099).
- **Haptics.** The Vibration API (MDN, "limited availability") works in Chrome on Android, not in Safari on iOS
  (general knowledge, high confidence), and must be feature detected and stopped when the page is hidden. With 94 %
  Android in India, a short tap on "your turn", a placed move and a win reaches almost every player; a phone game
  without any touch response feels flat (general knowledge from playing, medium confidence). **Our take:** a small,
  optional extra, after the sound work (CC-284), following the sound settings and never before a tap.

### 3.3 Design systems and motion tokens

- **IBM Carbon motion** (carbondesignsystem.com/elements/motion/overview): six duration tokens from
  `duration-fast-01` 70 ms to `duration-slow-02` 700 ms, and two families of easing, "productive" (subtle, fast, for
  tasks) and "expressive" (vivid, for significant moments), each with standard, entrance and exit curves.
- **Material Design 3** (m3.material.io, easing and duration tokens; the page did not render for the fetch, general
  knowledge, high confidence): named durations short1 to extra-long4 and "emphasized" and "standard" easings, with
  separate entrance (decelerate) and exit (accelerate) curves.
- **Our take:** our five durations and three easings already match this shape. What is missing is the **exit**
  curve, named recipes (enter, exit, pop, stagger step, celebrate) so 37 keyframes do not drift, and a check that no
  CSS module writes a raw duration. That is CC-281, a small standard, not a new library.

### 3.4 Lottie, SVG, CSS and Motion

| Option                                   | Fit for us                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS keyframes and transitions on SVG     | What we use. Zero download, compositor-friendly on `transform` and `opacity`, works under the CSP, reduced motion is one media query. `@starting-style` and `transition-behavior: allow-discrete` (MDN, Baseline 2024, August 2024) now give entry and exit animations for dialogs, popovers and `display: none` in CSS |
| Motion (`motion/react`)                  | Kept for chess slides and drag (ADR-016), where elements change parent. 17.9 kB gzip of features, so never on the first route                                                                                                                                                                                           |
| Lottie (`lottie-web`)                    | The full build and the SVG build call `eval` for After Effects expressions, so they need `'unsafe-eval'`; only `lottie_light` with the SVG renderer avoids it (github.com/airbnb/lottie-web/issues/289, 2017 to 2023). The player weighs tens of kB gzip (general knowledge, medium confidence) plus JSON per animation |
| Rive, GSAP, react-spring, canvas effects | A second animation system and a runtime download (ADR-016 amendment rules them out); canvas backgrounds drain batteries on low-end phones                                                                                                                                                                               |

**Our take:** CSS on SVG for everything that can be drawn in code; Motion only where it already is; Lottie
(`lottie_light`, lazily, never on the first route) only if an artist delivers real After Effects animation for the
characters (ADR-016 amendment point 2). No change to ADR-016 here; ADR-075 later set the whole effects stack by
tier, with measurements ([design/EFFECTS-STACK.md](../design/EFFECTS-STACK.md)).

### 3.5 Page transitions

- **View Transitions API** (MDN; caniuse.com/view-transitions): same-document transitions are in Chrome 111+,
  Safari and iOS Safari 18+, Samsung Internet 23+ and Firefox 144+, about 93 % of global users. They became Baseline
  "newly available" on 2025-10-14 with Firefox 144 (web.dev, 2025-10-16). Browsers without it simply navigate.
- **React Router** (reactrouter.com/how-to/view-transitions): the `viewTransition` prop on `Link` and `navigate`
  still works but is **deprecated** in favour of React's own `<ViewTransition>` component for apps on React 19.3 and
  later; using both can interrupt animations. We are on React 19.3.1 and React Router 8.4.
- **Our take:** ADR-050 point 4 stands (View Transitions, no added bundle), but CC-153d should use React's
  `<ViewTransition>` around the outlet if it is in the stable `react` export we ship, and the router prop only if not.
  The reduced motion rule turns `::view-transition-*` animations off. Rooms do not transition during a game.

### 3.6 Performance on low-end Android

- **Alex Russell, "The Performance Inequality Gap, 2024"** (infrequently.org, 2024-01): for a 3 s first load at the
  75th percentile, about 365 KiB of compressed JavaScript for a JS-heavy site; the reference device is a Galaxy A51
  class phone on 7.2 Mbps down, 94 ms RTT. India's spread is very wide and iOS is about 7 % of it.
- **web.dev animations guide** (Basques and Andrew, updated 2020-10-06): restrict animation to `opacity` and
  `transform`; `will-change` only when a measured problem needs it.
- **Our take:** our 150 KB first-route target is well inside the budget; the risk is not bytes but main-thread work
  and paint. Rules in principle 1.

### 3.7 Themes and dark mode

- **`light-dark()`** (MDN, Baseline 2024, May 2024) picks a colour by the active `color-scheme`; with
  `color-scheme: light dark` on `:root` it can replace the duplicated dark block, and `color-scheme: dark` on
  `[data-theme="dark"]` makes a player's choice override the OS without a second list of colours.
- **The flash of the wrong theme** (Josh Comeau, "The quest for the perfect dark mode", 2020-04-22, updated
  2026-02-23): a theme saved in storage and applied after the app starts paints the wrong colours first. His fix is a
  blocking inline script. Our CSP forbids inline scripts, so the same-origin options are a tiny blocking
  `/theme.js` file in `<head>` (allowed by `script-src 'self'`), or the server writing `data-theme` into the page it
  already rewrites (ADR-042) from a cookie.
- **Seasonal skins** (CC-205, vision §5.13 point 5: colours and board art only, never layout) need the same hook: one
  attribute on `<html>` that switches a token set.
- **Our take:** CC-280: a theme choice (system, dark, light) and a motion choice (system, reduced), with the
  `data-theme` hook CC-205 reuses. The choice is kept in the allowed `cc.look` key (section 8, decision 6).

### 3.8 Loading and empty states

- **NN/g, "Skeleton Screens 101"** (Tankala, 2023-06-04, reviewed 2026-09-02): show nothing for waits under about
  1 s, a skeleton for full-page loads of 1 to 10 s, a spinner for one module, a progress bar past 10 s; a skeleton
  that shows only the frame looks broken; shimmer can distract and needs care for accessibility.
- **NN/g, empty states** (2021-09-19, in CC-259): what this is, how it fills, one button.
- **Our take:** CC-282: one loading standard. Nothing for the first 300 to 400 ms (the same threshold as the button
  standard, ADR-038), then a skeleton that reserves the real layout (so no shift), a static tint under reduced
  motion, `aria-busy` and one polite "Loading" for screen readers, and the empty states of CC-259 when it is truly
  empty.

### 3.9 Icons

- Open icon sets under MIT (Heroicons, Phosphor, Tabler) would fit our licence allowlist, and Lucide is ISC, which is
  not on it (general knowledge of those licences, high confidence). The owner chose to draw our own instead
  (ADR-052 point 9), so none is copied.
- Emoji and text symbols are drawn by the phone's own font, so `🔒` and `⚠` look different on Samsung, Xiaomi and
  Pixel phones and can be missing on old ones (general knowledge, high confidence).
- **Our take:** CC-283: one `art/icons/` registry of about 16 icons drawn by us in the arcade stroke (ADR-052 point 9), replacing the per-component icons and the emoji, all `aria-hidden` next to text.

### 3.10 Sound

ADR-018's synthesised sounds need no files, no licence and no CSP change, and CC-163 already gives each outcome
reason its own sound. No research points to a "sound pack" problem players have today, so **no sound refresh ticket
is proposed**. Sound feel changes ride on CC-163 (outcomes), CC-099 (at most three sounds per result) and CC-156
(the unlock sound).

### 3.11 What is best for ClassiCade

Keep the stack (CSS on SVG, tokens, Motion only for chess, synthesised sound). Fix what is broken first (CC-270,
CC-256), then the moments that matter most for a new player (CC-163, CC-099), put the safety nets in place
(CC-155, CC-154), then the polish (CC-153), and only then the settings and standards that make it last (CC-281,
CC-282, CC-280, CC-283). Haptics and the phase 3 skins come last.

## 4. Tickets in the domain

The Step column is the step of the build order in section 6; tickets in the same step can run in parallel. Status from the board on 2026-10-19.

### Done (the base this domain builds on)

| Ticket | What                                                                     | Status                                                        |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| CC-022 | Frontend scaffold, shared layout, design tokens                          | ✅ Done                                                       |
| CC-087 | Neon arcade identity, vector art, celebrations (ADR-012)                 | ✅ Done                                                       |
| CC-103 | Synthesised sounds for every game, mute (ADR-018)                        | ✅ Done                                                       |
| CC-208 | Notification and sound categories (shared with Social)                   | ✅ Done (#67)                                                 |
| CC-232 | "Waking up the arcade" loading screen                                    | ✅ Done (#62)                                                 |
| CC-230 | Art pipeline, CREDITS.md and its test, placeholder Bit                   | ✅ Done (#91)                                                 |
| CC-259 | Screens with dead space: empty states, how to play, one-row phone header | Done in #90; the board still shows 🟦, the next sync flips it |
| CC-275 | Main red: waking-up stylesheet race, seat row wider than a phone         | ✅ Done (#96)                                                 |

### Open

| Step | Ticket       | What                                                                                    | In or out                                                      | Pri | Phase | Status                 |
| ---- | ------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --- | ----- | ---------------------- |
| 1    | CC-270       | Effects past the phone's edge after a win                                               | In                                                             | P1  | 1     | ✅ Done                |
| 1    | CC-256       | 20 character name breaks the phone header and profile                                   | In                                                             | P1  | 1     | ✅ Done                |
| 1    | CC-155       | Visual regression baselines, light and dark, desktop and phone                          | In (test)                                                      | P1  | 2     | ⬜ Todo                |
| 1    | CC-267       | Lawyer-drafted assignment deed for commissioned art                                     | In (moved in, section 5)                                       | P2  | 2     | ⬜ Todo                |
| 2    | CC-163       | Outcome moments: tone, words, sound, effect per reason                                  | In (writes into the shell's result slot)                       | P1  | 1     | ⬜ Todo, research done |
| 2    | CC-153 c     | Animated home: hover tilt, stagger in, hero intro once                                  | In                                                             | P1  | 2     | ⬜ Todo, research done |
| 2    | CC-153 e     | Trophy cabinet: shelves by tier, locked silhouettes                                     | In                                                             | P1  | 2     | ⬜ Todo, research done |
| 3    | CC-099       | Rewards one beat at a time in the result card                                           | In (writes into the shell's result slot)                       | P1  | 1     | ⬜ Todo, research done |
| 3    | CC-154       | Nothing clipped or overlapping on any screen, contrast, stress data                     | In (Accessibility reuses its check)                            | P1  | 1     | ⬜ Todo                |
| 3    | CC-153 d     | Page transitions through React's `<ViewTransition>` (ADR-052 point 7)                   | In                                                             | P1  | 2     | ⬜ Todo, research done |
| 4    | CC-153 b     | Bit in the result, empty states and 404 (part a, the Bit component, was done in CC-230) | In                                                             | P1  | 2     | ⬜ Todo, research done |
| 4    | CC-282 (new) | Loading states standard: delay, reserved-space skeletons                                | In                                                             | P2  | 1     | ⬜ Todo                |
| 5    | CC-281 (new) | Motion tokens and recipes standard, exit animations in CSS                              | In                                                             | P2  | 1     | ⬜ Todo                |
| 6    | CC-280 (new) | Appearance settings: theme and motion choice, no flash, `theme-color`, skin hook        | In                                                             | P2  | 2     | ⬜ Todo                |
| 6    | CC-283 (new) | One icon set in `art/icons/`, no emoji as icons                                         | In                                                             | P3  | 2     | ⬜ Todo                |
| 7    | CC-092       | Motion for interaction animation (chess done)                                           | In, narrowed: its open parts move (section 5), then it closes  | P1  | 2     | 🟦 In progress         |
| 7    | CC-194       | Character art: the artist's Bit and 18 characters, five poses                           | In (art production; Story places it)                           | P1  | 2     | ⬜ Todo                |
| 7    | CC-153 f     | Preset avatars and frames (the drawings and picker)                                     | In, after CC-034 (Social)                                      | P1  | 2     | ⬜ Todo                |
| 7    | CC-284 (new) | Haptic taps on Android through the Vibration API                                        | In                                                             | P3  | 2     | ⬜ Todo                |
| 7    | CC-266       | In-app credits page from CREDITS.md                                                     | In (moved in)                                                  | P3  | 2     | ⬜ Todo                |
| 8    | CC-265       | Our own neon chess piece set                                                            | In (moved in)                                                  | P3  | 3     | ⬜ Todo                |
| 8    | CC-156       | "Coming soon" tiles, next-unlock teaser, unlock animation and sound                     | In, narrowed: unlock rules move to CC-143                      | P1  | 3     | ⬜ Todo                |
| 8    | CC-205       | Seasonal skins: colours, board art, event banner                                        | In, narrowed: event quests and badges move to seasons (CC-055) | P2  | 3     | ⬜ Todo                |

### Listed by the neighbours, not here

CC-161, CC-165, CC-166 to CC-168, CC-172 (Match experience); CC-169 (emotes), CC-217, CC-034, CC-153 g and h
(Social and sharing); CC-188 to CC-201 except CC-194 (Story mode); CC-048, CC-100, CC-183 (Accessibility); CC-135,
CC-148, CC-216, CC-123 (Platform and growth); CC-143, CC-055, CC-063, CC-212 (Progression and money).

## 5. Proposed new tickets and moves

### New tickets (⬜ Todo, accepted by the owner on 2026-10-19 as an exception to the feature freeze)

| Ticket | Title                                                                                                      | Why (one line)                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-280 | Appearance settings: theme (system, dark, light) and motion (system, reduced), no wrong-theme flash        | The vision promises both settings (§5.12, §5.13) and the code has neither; seasonal skins (CC-205) need the same `data-theme` hook                |
| CC-281 | Motion tokens and recipes: exit curves, named enter, exit, pop and stagger recipes, a check on raw timings | 37 keyframes with raw timings and two duplicate names drift; Carbon and Material show the shape; CSS `@starting-style` now covers exit animations |
| CC-282 | Loading states standard: nothing under 400 ms, then a skeleton that reserves the real layout               | Twelve ad hoc "Loading…" lines make content jump on slow phones; NN/g's thresholds and CLS give the rule                                          |
| CC-283 | One icon set in `art/icons/`, replacing per-component icons and emoji used as icons                        | Emoji differ by phone maker and can be missing; one registry keeps the stroke, size and licence consistent                                        |
| CC-284 | Haptic taps on Android (your turn, a placed move, a win), optional, following the sound settings           | 94 % of our phones are Android, where the Vibration API works; touch feedback is part of game feel and costs no download                          |

Not proposed, because the research does not support it now: a sound pack refresh (section 3.10), a separate seasonal
theme hook (it is part of CC-280 and CC-205), a performance ticket of our own (CC-135 and CC-220 measure it).

### Moves

| Ticket                 | Move                                                                                                                                                                             | Reason                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CC-092                 | Page transitions go to CC-153d; exit animations (toasts, dialogs, result) and card flips go to CC-281 in CSS; CC-092 then closes as done (Motion adopted, chess slides and drag) | ADR-050 point 4 chose View Transitions, ADR-049 point 3 keeps the shell on CSS keyframes |
| CC-153 g               | Out to Social and sharing: it is CC-169 (emotes). Bit's emote poses stay with us as art                                                                                          | The feature is about safety, rate limits and minors (ADR-028), not looks                 |
| CC-153 h               | Out to Social and sharing, with CC-217 (win cards; CC-043 was closed as replaced by CC-217, ADR-051). The card's visual template stays with us                                   | Who appears on a card and how it is shared are ADR-028 questions                         |
| CC-156                 | The rules (early access for Level 10+, level-gated variants) move to CC-143; CC-156 keeps the tiles, the teaser, the unlock animation and sound                                  | When something unlocks is progression, how it looks is ours                              |
| CC-205                 | Event quests and the collectible badge move to seasons (CC-055); CC-205 keeps skins, board art and the event banner                                                              | Quests are gamification rules                                                            |
| CC-265, CC-266, CC-267 | Moved in from "CC-230 follow-ups" with no domain                                                                                                                                 | They are the art pipeline                                                                |
| CC-194                 | In for production of the art; Story mode keeps where and when it shows                                                                                                           | One art pipeline, one set of art rules (STORY_MODE §3)                                   |
| CC-163, CC-099         | Stay in, but are sequenced with Match experience because they write into `MatchShell`'s result slot                                                                              | Shared files (section 6)                                                                 |

Scope widened to include the art pipeline and licences (CC-230's follow-ups) and the microcopy of feel moments (Bit's
lines, outcome words), because both decide how the product feels and neither had a home.

## 6. Build order

Rule: at most six builders, only on work that touches separate files (working agreement rule 6).

| Step | Tickets that can run together                                                                          | Files each touches                                                                                                                                          | Why this order                                                          |
| ---- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | CC-270 · CC-256 · CC-155 · CC-267 (lawyer, no code)                                                    | CC-270: `art/effects/*`, `Celebrations/*`. CC-256: `Layout.module.css`, profile forms. CC-155: CI workflow, Playwright config, a new screenshot spec        | Bugs first; baselines before the polish so every later PR shows a diff  |
| 2    | CC-163 · CC-153c (home) · CC-153e (trophy cabinet)                                                     | CC-163: `outcome.js`, `outcomeText.js`, `roomUpdates.js`, `sounds.js`, `ResultCelebration`. 153c: `HomePage`, `HeroArt`, `gameArt`. 153e: `AchievementGrid` | Separate files. Not with CC-161 or CC-172 (both touch `MatchShell`)     |
| 3    | CC-099 · CC-154 · CC-153d (page transitions)                                                           | CC-099: `Celebrations/*`, toasts, `MatchShell` result slot, a small server change. CC-154: e2e layout check and fixes. 153d: router outlet, `global.css`    | CC-099 after CC-163 (same component). CC-154 after CC-270 and CC-256    |
| 4    | CC-153b (Bit in the result, empty states, 404) · CC-282                                                | 153b: `ResultCelebration`, `VisitorProfile`, `NotFoundPage`, `illustrations/`. CC-282: a new `Loading` component and the list pages                         | 153b after CC-099 (same result card). CC-282 after 153e (same grid)     |
| 5    | CC-281                                                                                                 | `tokens.css`, `global.css`, every CSS module with keyframes, toasts and dialogs                                                                             | Touches many files: alone, after the steps that edit those modules      |
| 6    | CC-280 · CC-283                                                                                        | CC-280: `tokens.css`, `index.html` head, the page head writer, settings UI, storage allowlist. CC-283: `art/icons/`, `Layout`, `SoundControl`, quests       | CC-280 after CC-281 (both `tokens.css`). CC-283 after CC-256 and CC-282 |
| 7    | CC-092 closes · CC-194 (when the artist and deed are ready) · CC-153f (after CC-034) · CC-284 · CC-266 | CC-194: `art/characters/`, `art/bit/`. CC-284: `lib/sound` preferences and player. CC-266: a new page and the footer                                        | Gated on people (artist, lawyer) and on Social's CC-034                 |
| 8    | Phase 3: CC-265 · CC-156 · CC-205                                                                      | CC-265: `public/pieces/`. CC-156: home tiles. CC-205: token sets on the CC-280 hook                                                                         | CC-205 needs CC-280                                                     |

Shared-file locks with other domains: `MatchShell.*` (CC-163, CC-099, CC-153b against CC-161, CC-172, CC-166 to
CC-168), `Layout.*` (CC-256, CC-283 against anything in the header), `e2e/fixtures.js` (CC-154, CC-155, CC-280's
storage allowlist), `tokens.css` (CC-281, CC-280, CC-205).

## 7. Measures

Per PR: gzip growth of the main chunk and of the lazy chunk it touches, the CSS growth, screenshots in light and
dark at 1280 x 720, 390 x 844 and 360 x 800 (CC-155 once built), the reduced motion run, and no CSP violation in the
e2e suite. For the domain: page width never above the viewport (CC-270 and CC-154 checks), CLS under 0.1 on the
list pages (CC-282), first route at or under 150 KB gzip (CC-135).

## 8. Decisions

Recorded as ADR-052, accepted by the owner on 2026-10-19 with every recommendation.

| #   | Decision                                                                                                                                                                                                                                                                                                               | Status                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | The domain's scope and boundaries as in section 1, widened to the art pipeline and the microcopy of feel moments                                                                                                                                                                                                       | Accepted · 2026-10-19 (owner)               |
| 2   | The five new tickets CC-280 to CC-284 go on the board as ⬜ Todo, an exception to the feature freeze (rule 1 of the working agreement)                                                                                                                                                                                 | Accepted · 2026-10-19 (owner)               |
| 3   | The moves in section 5 (CC-092 narrowed and closed, CC-153 g and h to Social, CC-156 and CC-205 narrowed, CC-265 to CC-267 and CC-194 in)                                                                                                                                                                              | Accepted · 2026-10-19 (owner)               |
| 4   | The build order in section 6                                                                                                                                                                                                                                                                                           | Accepted · 2026-10-19 (owner)               |
| 5   | **Default theme**: follow the phone's (OS) setting, as today, not dark by default                                                                                                                                                                                                                                      | Accepted · 2026-10-19 (owner)               |
| 6   | **Where the choice is kept**: a new allowed localStorage key `cc.look`, `{"theme":"system"\|"dark"\|"light","motion":"system"\|"reduced"}`, added to `STORAGE_ALLOWLIST` with a checker and read before the first paint by a small same-origin `/theme.js` in `<head>`. No cookie, no server change, CSP-safe (CC-280) | Accepted · 2026-10-19 (owner)               |
| 7   | **Page transitions** (amends ADR-050 point 4): React's `<ViewTransition>` if it is in the stable `react` we ship, because React Router deprecated its `viewTransition` prop; the router prop otherwise                                                                                                                 | Accepted · 2026-10-19 (owner)               |
| 8   | **Haptics**: on for the three moments (your turn, a placed move, a win), with a switch next to sound (CC-284)                                                                                                                                                                                                          | Accepted · 2026-10-19 (owner)               |
| 9   | **Icons**: drawn by us in the arcade style (CC-283)                                                                                                                                                                                                                                                                    | Accepted · 2026-10-19 (owner)               |
| 10  | Stack unchanged: CSS on SVG, Motion only on chess, Lottie only as `lottie_light` for real artist animation, no sound refresh                                                                                                                                                                                           | Taken (follows ADR-012, ADR-016, ADR-018)   |
| 11  | Budgets and principles in section 2 bind every ticket in the domain                                                                                                                                                                                                                                                    | Taken (from ADR-012, ADR-050, vision §6.11) |
| 12  | CC-259 is done (#90); the board row is flipped at the next docs sync                                                                                                                                                                                                                                                   | Taken (fact)                                |
