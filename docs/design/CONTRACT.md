# Design contract

The rules every screen of ClassiCade follows (CC-314). Builders pick from here, and reviewers quote it. A machine
checks what it can (`npm run lint`), and the design lens of the review (CC-316) checks the rest.

- **Values** live only in the token files, one per role, which
  [`apps/web/src/styles/tokens.css`](../../apps/web/src/styles/tokens.css) imports from
  [`styles/tokens/`](../../apps/web/src/styles/tokens/): `palette.css` (every colour, base and role), `type.css`
  (fonts, sizes, type roles, leading), `space.css` (space and radius), `elevation.css` (shadows, glows, elevation),
  `layers.css` and `motion.css`. **Retuning a role is a change of values in its one file**: a palette refresh
  touches `palette.css` only, a deeper glow `elevation.css` only. A test fails when a token sits in another
  role's file (`tokens.test.js`).
- **The roles** are named in [`apps/web/src/styles/tokenRoles.js`](../../apps/web/src/styles/tokenRoles.js), which
  the token test and the design page read.
- **The living page** is `/admin/design` in the owner console, behind the `design_page` flag. It draws every token
  and the real components in their states, so it cannot drift from the app. This file holds the rules, the page shows
  them.

Recorded as ADR-076. Decided by the owner on 2026-10-20 ("Accept all, with stylelint"): the decisions D1 to D7 in
[CC-314](../tickets/CC-314.md#open-decisions).

## 1. Tokens by role

Components pick a **role**, never a hue or a number. A role is an alias over a value we already had, so a role
changes nothing on screen unless it is new.

### Colour roles

Every role has the solid colour `--color-<role>`, a pale background `--color-<role>-soft`, and the text colour on the
solid one, `--color-on-<role>`. In both themes each solid colour is at least 4.5:1 on `--color-bg`, on
`--color-surface` and on its own `-soft`, and each `on` colour is at least 4.5:1 on its solid colour
(`tokens.test.js`). The focus ring, `--color-focus`, is at least 3:1 on both backgrounds.

| Role       | Means                                                                   | Never                         |
| ---------- | ----------------------------------------------------------------------- | ----------------------------- |
| `success`  | Something went well: saved, a quest done, connected                     | A won game on its own         |
| `warning`  | Needs the player soon: away, reconnecting, a timer running out          | Decoration                    |
| `danger`   | The player may lose something they made: their data, a game in progress | A lost game (ADR-050 point 2) |
| `info`     | Neutral news, always with words. The same colour as `primary` (D3)      | The only signal               |
| `you`      | The player looking at the screen: "Your turn", their seat. XP blue (D2) | Success, or the only signal   |
| `opponent` | Anyone else in the game: their turn, their seat. Accent magenta (D2)    | Danger, or the only signal    |

**Never colour alone** (WCAG 1.4.1). A status always has its words, and a player colour always comes with a word
("Your turn") and the seat marker, because about 8 % of men have a colour vision deficiency.

**Brand colours are decoration and identity, never status:** `--color-primary`, `--color-accent`, `--color-xp`,
`--color-gold`, `--color-streak`, the game accents `--color-game-*`, the tiers `--color-tier-*`, the neon art inks
`--color-neon-*` and the chess squares `--color-board-*`.

### Type

| Token             | Size         | Use                                    |
| ----------------- | ------------ | -------------------------------------- |
| `--type-caption`  | `--text-xs`  | Small print, tags, counts              |
| `--type-label`    | `--text-sm`  | Field labels, secondary lines, chips   |
| `--type-body`     | `--text-md`  | Reading text                           |
| `--type-title`    | `--text-xl`  | A page or dialog title                 |
| `--type-display`  | `--text-2xl` | The one big line of a hero or a result |
| `--leading-tight` | 1.2          | Headings and one-line labels           |
| `--leading-body`  | 1.5          | Reading text                           |

**Page and section titles (CC-323).** `--type-page-title` (`--text-2xl`) is the one `h1` style, set once in
`global.css`; on a phone (up to `--breakpoint-sm`) it steps down to `--type-title`. No page module styles its own
`h1`: use `PageHeader`. `--type-section-title` (`--text-lg`) is the title of a `Section` and of a card. A hero's
display line is the one exception.

**Weights (CC-323).** `--weight-regular` (400) for reading text, `--weight-medium` (600) for a quiet emphasis,
`--weight-bold` (700) for labels, links and numbers, `--weight-heavy` (800) for headings and buttons. The header
(CC-324) and the match stage still hold 46 raw weights; the check refuses raw weights once those move.

The seven sizes `--text-xs` to `--text-3xl` stay. Two families are for drawings, not text blocks:
`--type-board-*` (the Tic-Tac-Toe mark, the chess coordinates) and `--type-svg-*`, written in the SVG's own units so
the text grows and shrinks with the picture.

### Space and radius

| Token                        | Use                                                        |
| ---------------------------- | ---------------------------------------------------------- |
| `--space-1`, `--space-2`     | Inside a control: an icon and its label, a chip's padding  |
| `--space-3`, `--space-4`     | Between controls, a card's padding                         |
| `--space-6`, `--space-8`     | Between groups and sections                                |
| `--space-12`                 | Between the big parts of a page                            |
| `--radius-sm`                | A small control, a tooltip                                 |
| `--radius-md`                | A control, a seat, a game square                           |
| `--radius-lg`, `--radius-xl` | A card, a sheet, a dialog                                  |
| `--radius-full`              | A pill, a dot, an avatar                                   |
| `--target-min`               | 24 px, the smallest tap target anywhere (WCAG 2.5.8)       |
| `--target-touch`             | 44 px, our own floor on a touch screen (`pointer: coarse`) |

**Breakpoints (CC-323).** A media query cannot read `var()`, so the four widths are tokens by name and the check
refuses any other width in `@media`: `--breakpoint-sm` 30rem (a phone upright), `--breakpoint-md` 40rem (a large
phone), `--breakpoint-lg` 48rem (a tablet upright), `--breakpoint-xl` 64rem (a laptop).

### Elevation

| Token               | Is                                 | Use                                                     |
| ------------------- | ---------------------------------- | ------------------------------------------------------- |
| `--elevation-1`     | `--shadow-sm`                      | A card resting on the page                              |
| `--elevation-2`     | `--shadow-md`                      | A raised panel, a toast                                 |
| `--elevation-3`     | `--shadow-md` and `--glow-primary` | A dialog over the page                                  |
| `--elevation-hover` | `--shadow-md` and `--glow-primary` | An interactive card under the pointer or focus (CC-323) |

### Layers

Every `z-index` is one of these. The order is the one the app had before CC-314, written once.

| Token                     | Value | Use                                                   |
| ------------------------- | ----- | ----------------------------------------------------- |
| `--layer-raised`          | 1     | A badge drawn over its own picture                    |
| `--layer-banner`          | 10    | A sticky banner, such as a request in a room          |
| `--layer-tooltip`         | 15    | A button's reason why it cannot act                   |
| `--layer-toast`           | 20    | The toast column                                      |
| `--layer-banner-alert`    | 20    | The lost connection strip, over the other banners     |
| `--layer-menu`            | 20    | A panel that opens from the header, such as the inbox |
| `--layer-dialog`          | 30    | A dialog and its backdrop                             |
| `--layer-effect`          | 40    | Celebrations that never take a press, the rising XP   |
| `--layer-skip`            | 50    | The skip link, over everything once it has focus      |
| `--layer-board-piece`     | 1     | Inside the chess board: a piece on its square         |
| `--layer-board-slide`     | 3     | Inside the chess board: a piece sliding               |
| `--layer-board-ghost`     | 5     | Inside the chess board: a dragged piece               |
| `--layer-board-promotion` | 10    | Inside the chess board: the promotion picker          |

### Motion

The five durations and three easings in `tokens/motion.css` stay. The exit curve, the motion recipes and the check
on raw timings are [CC-281](../tickets/CC-281.md)'s, and this contract links them rather than repeating them.

Which tool animates what is [ADR-075](../DECISIONS.md) and [EFFECTS-STACK.md](EFFECTS-STACK.md): CSS on these tokens
for simple motion, Motion presets for intermediate, and the effect registry's canvas for celebrations. Its one
measured rule for this contract: **no `var()` inside `@keyframes`**, because it moves the animation off the
compositor. A keyframe holds literal values. Timing and easing still come from the tokens on the `animation` line. One keyframe
breaks this today, `confetti-fall` in `art/effects/effects.module.css`, and it goes when CC-099 moves the confetti
into the effect registry (ADR-075). Review checks this rule, not lint.

## 2. Component contracts

Seven components cover everything a player sees. Use the app's own component (in `apps/web/src/components/`), not a
look-alike.

| Component   | When to use it                                                                                                                                                                                    | States                                                                                                                            | Accessibility rules                                                                                                                                                                                 | Most per screen                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Button      | Every action (ADR-038). Primary for the one main next step, secondary and ghost for the rest, danger only for losing something you made                                                           | rest, hover, focus-visible, pressed (under 100 ms), waiting (after 400 ms "Sending…"), done, cannot act (with the reason), failed | The app's `Button` only. Target at least 24 × 24 CSS px (WCAG 2.5.8), 44 × 44 on touch screens by our own rule. Visible text or an `aria-label`. Focus ring 3:1 (WCAG 1.4.11)                       | One primary per region (page, dialog, card, sheet)             |
| Dialog      | Only for a decision the player started and must finish before going on: a destructive confirm, required input, a choice that blocks (NN/g, Fessenden 2017). Never for news, rewards or promotions | closed, waiting for another dialog, open, waiting (its action), closing                                                           | The app's `Modal`. `role="dialog"`, `aria-modal`, labelled by its title, focus moves in, **Tab stays inside and the page behind is `inert`**, Escape closes, focus returns                          | One open. Never stacked. Never opened by the app during a game |
| Toast       | A passive note about something that happened and needs no decision (saved, copied, "+30 XP" off the room page). Never the only way to an action                                                   | waiting (held by CC-315), entering, shown, leaving                                                                                | One polite live region (WCAG 4.1.3). Never takes focus. Never covers the focused element (WCAG 2.4.11). An action in a toast is also reachable somewhere else, because toasts time out (WCAG 2.2.1) | 1 visible on a phone, 2 on desktop (CC-315 enforces)           |
| Banner      | A state of the page or a question waiting for the player: a request, the connection, a site-wide request, whose turn it is. Stays until the state ends or the player answers                      | info, warning, danger, request, turn; with or without actions                                                                     | `role="status"`, or `role="alert"` only for a lost connection. Its actions are the app's `Button`. Never pushes the board down during a game (it takes the match bar's row, ADR-049 point 5)        | 1 per screen. Higher priority replaces lower (CC-315)          |
| Card        | A group of things about one subject (a game tile, the result, a quest, a profile section)                                                                                                         | rest, interactive (hover, focus, press), selected, cannot act                                                                     | A clickable card has one link or button, not nested ones. Its heading is a real heading                                                                                                             | No limit. One "featured" card per screen                       |
| Badge       | A short label or count on something else (level, tier, "New", unread count)                                                                                                                       | neutral, status role, count                                                                                                       | Not interactive. Text, not colour alone. 4.5:1. A count says what it counts to screen readers                                                                                                       | One per item. At most 3 "New" badges per screen                |
| Empty state | A region with nothing to show yet (CC-259): what this is, how it fills, one button                                                                                                                | empty, empty with Bit (CC-153b)                                                                                                   | Art `aria-hidden`, the meaning in text                                                                                                                                                              | One per region                                                 |

### The shared components (CC-323)

Each lives in `apps/web/src/components/`, and its choices are listed in `components/looks.js`, so a typo fails the
first test that renders it. `/admin/design` draws every one in every state.

| Component                           | API                                                                                                                                                                                                                                                                                                                                                                                  | States                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Button`                            | `control`, `variant` (`primary`, `secondary`, `ghost`, `danger`, and `accent`: the primary's look on the hero art only), `size` (`sm`, `md`, `lg`), `as="link"` with `to` (a router link) or `href` (an `<a>`), `icon`, `label` (the name of an icon-only button, required), `action`, `reason`, `pendingLabel`, `doneLabel`                                                         | default, hover, focus-visible, pressed, waiting (after 400 ms), done, cannot act with its reason, failed with Retry |
| `Card` and its parts                | `as`, `variant` (`surface`, `raised`, `accent` with a game tone (that game's colour) or a brand or gold tone (the one featured card of a screen), `notice` with a status `tone`), `interactive`, `selected`, `reason`. Parts in order: `CardMedia` (art to the edges), `CardHeader` (`title`, `description`, `aside`), `CardLink` (the one stretched link), `CardBody`, `CardFooter` | rest, hover and focus (lift and glow, CSS only), pressed, selected, cannot act with its reason                      |
| `PageHeader`, `Section`, `Sections` | `PageHeader`: `title`, `lede`, `aside`. `Section`: `title`, `description` (one line), `headingLevel`, `actions`. `Sections` spaces them and draws the divider                                                                                                                                                                                                                        | (layout)                                                                                                            |
| `EmptyState`                        | `title`, one line as children, `art` (hidden from readers), `action` (one button), `secondary`, `headingLevel` (1 on a dead-end page)                                                                                                                                                                                                                                                | empty, dead end                                                                                                     |
| `ErrorState`                        | `title`, one line as children, `control`, `onRetry` (only when trying again can help). An alert                                                                                                                                                                                                                                                                                      | failed, failed with Retry                                                                                           |
| `Skeleton`                          | `label` (read once as a status), `shape` (`line`, `row`, `tile`, `card`, `board`, `block`, each the height of what it stands in for), `count`                                                                                                                                                                                                                                        | loading. Reserves the room, so nothing jumps. Pulses on opacity ten times, then rests; still under reduced motion   |
| `Field`                             | `label`, `kind` (`text`, `select`, `textarea`, `date`, `copy`), `hint`, `error`, `maxLength` with `showCount` (on for a textarea), and for `copy` `control`, `copyLabel`, `onCopied`                                                                                                                                                                                                 | default, hover, focus-visible, invalid, disabled, counted, full, copied, copy failed                                |
| `Tabs`                              | `label`, `items` (`id`, `label`, `to`, `icon`), `current`, `control`. Navigation links with `aria-current="page"`, not an ARIA tab list, because each tab is its own page                                                                                                                                                                                                            | rest, hover, focus-visible, current                                                                                 |

**Rules that go with them:**

1. **One primary per region**: a page, a dialog, a card or a sheet. Every button carries `data-cc-variant`, so a
   reviewer (or a test) can count them. A second main action is `secondary`.
2. **No underlined text link as an action.** An action that goes somewhere is `<Button as="link">`.
3. **Danger only where the player may lose something they made**, never for a lost game (ADR-050).
4. **A destructive confirm** (resign, leave a game in progress, block, remove a friend, delete) is a `Modal` with
   `destructive`: a click on the backdrop does nothing; Escape and its own buttons still close it.
5. **Focus.** Controls draw the ring on `:focus-visible` only. A heading, `main` or a dialog that script focuses so
   a screen reader reads it (`tabindex="-1"`) draws no ring, because browsers treat focus moved by script on a new
   page as keyboard focus and the ring showed to mouse and touch players. No module writes `:focus` for a ring.
6. **Tap targets.** Every button, link and control is at least `--target-min` tall, and a button is at least
   `--target-touch` on a touch screen.
7. **No bare "Loading…".** Loading is a `Skeleton` of the content's shape, failing is an `ErrorState`, nothing to
   show is an `EmptyState`.

**Whose turn it is** is a banner with a player role: "Your turn" in `--color-you` and "Waiting for Riya" in
`--color-opponent`, each with the word and the seat marker's dot (`TurnBanner`). The seats use the same two
colours for the viewer's own seat and everyone else's (`Seats`). A spectator, who has no seat, sees the seats in
their seat colours.

**Focus moved in code** (CC-100). A screen that moves focus to its heading or container, so a screen reader starts
there, gives it `tabIndex={-1}` and no focus style of its own. `global.css` draws the usual ring on it only while
the player is using the keyboard (the `using-keyboard` class from `app/inputModality.js`): no ring on page load or
after a click, the ring after a key press. Never `outline: none` on such a target, and never `:focus-visible`
alone, which Chromium matches on page load. A target whose ring another element draws (the pass-and-play board's
region) may turn its own off. The app's focus rules are in `@layer focus`, below every component style, so a
component's own focus style or opt-out always wins.

## 3. Pages, sections and data (owner, 2026-10-21)

The owner likes interfaces where everything is written cleanly and in detail, colour is precise and meaningful,
and sections are clearly separated. These rules hold on every page, and most of all on the dense ones: the profile,
the leaderboards, the owner console and the game rules.

1. **Every page is built from titled sections.** A `PageHeader`, then `Sections` of `Section`s. Each section has a
   heading, one line saying what it holds, then its content. Sections are separated by the same space
   (`--space-8`) and a thin divider. Nothing floats on its own between sections.
2. **Colour always carries meaning.** A colour is a status role or a player role from the tokens, never a hue for
   decoration (brand colours stay on art and identity). Every number or state that has a colour also has a word or
   an icon, such as "▲ 12% up" in `success`.
3. **Data shows its unit, its time window and its empty state.** "Games, last 7 days, India time", not a bare
   number. A list or chart with nothing in it shows an `EmptyState`, never a blank box.
4. **Short, precise labels and aligned numbers.** Numbers use `tabular-nums` and line up on the right. A dense table
   or list has a header row in `--type-caption`, heavy and muted.
5. **One rhythm.** The same paddings (a card's `--space-4`, `--space-6` from `--breakpoint-lg`), the same title sizes
   (`--type-page-title`, `--type-section-title`) and the same gaps on every page, from the type roles and space
   tokens. No page invents its own.

## 4. Most per screen (D5)

At most, at the same time:

1. **One dialog.** A second `Modal` opened while one is open waits until the first closes. Two are never open
   together (`Modal.test.jsx`).
2. **One banner.** A higher priority one replaces a lower one (CC-315 routes them).
3. **One toast on a phone, two on desktop** (CC-315 enforces).
4. **One primary button per region**: a page, a dialog, a card or a sheet.

## 5. Copy limits (D6)

One line per language, Hinglish first where we use it (CC-217). Checked in the CC-316 review, not by CI, because
Hinglish lines vary.

| Component    | Limit         |
| ------------ | ------------- |
| Button       | 3 words       |
| Toast        | 70 characters |
| Banner       | 90 characters |
| Dialog title | 6 words       |
| Dialog body  | 2 sentences   |
| Badge        | 12 characters |

## 6. Pop-ups

A **pop-up** is anything that draws over the page or speaks in a live region: a portal, `position: fixed`,
`role="dialog"` or `role="alertdialog"`, or `aria-live` (other than `"off"`). Only the files below may make one.
**A new pop-up type needs a change to this contract first**: a new row here, and the same entry in
`POPUP_COMPONENTS` in [`eslint-rules/popupContract.mjs`](../../eslint-rules/popupContract.mjs). `npm run lint`
refuses the rest (`classicade/popup-contract` for JavaScript, `classicade/popup-position` for CSS), and a test fails
when this list and the code differ. The list may only shrink.

An **announcer** is a hidden line a screen reader reads out (a new page, a move, a sign-in). It draws nothing, but it
speaks, so it is listed too.

<!-- popup-components:start -->

| File                                                         | Kind         | Why                                          |
| ------------------------------------------------------------ | ------------ | -------------------------------------------- |
| `apps/web/src/components/Modal/Modal.jsx`                    | dialog       | The one dialog: a portal with a dialog role. |
| `apps/web/src/components/Modal/Modal.module.css`             | dialog       | The dialog's fixed backdrop.                 |
| `apps/web/src/components/Toast/ToastProvider.jsx`            | toast        | The one polite live region of toasts.        |
| `apps/web/src/components/Toast/Toast.module.css`             | toast        | The fixed toast column.                      |
| `apps/web/src/components/GamificationToasts.jsx`             | toast        | Reward toasts drawn on the body.             |
| `apps/web/src/components/GamificationToasts.module.css`      | toast        | The rising quest XP.                         |
| `apps/web/src/components/ProgressToasts.jsx`                 | celebration  | The level-up burst on the body.              |
| `apps/web/src/components/Celebrations/ResultCelebration.jsx` | celebration  | Confetti after a win, drawn on the body.     |
| `apps/web/src/art/effects/effects.module.css`                | celebration  | The fixed celebration overlay.               |
| `apps/web/src/components/TurnBanner/TurnBanner.jsx`          | banner       | Whose turn it is, read out.                  |
| `apps/web/src/components/PageAnnouncer/PageAnnouncer.jsx`    | announcer    | Reads out a new page.                        |
| `apps/web/src/components/MatchShell/MatchAnnouncer.jsx`      | announcer    | Reads out moves and results.                 |
| `apps/web/src/components/Layout/Layout.jsx`                  | announcer    | Reads out a sign-in change.                  |
| `apps/web/src/components/PlayComputer/PlayComputer.jsx`      | announcer    | Reads out the chosen level.                  |
| `apps/web/src/games/chess/ChessBoard.jsx`                    | announcer    | Reads out the last move and a low clock.     |
| `apps/web/src/pages/AdminPage/AdminRoute.jsx`                | announcer    | Reads out that the console loads.            |
| `apps/web/src/pages/DailyPuzzlePage/DailyPuzzlePage.jsx`     | announcer    | Reads out puzzle moves.                      |
| `apps/web/src/games/chess/PromotionPicker.jsx`               | board picker | The promotion choice, inside the board.      |

<!-- popup-components:end -->

**Coming with ADR-075:** the effect registry's `EffectHost` and its canvas (`apps/web/src/effects/`) are a
celebration. They join this list, at `--layer-effect`, in the pull request that builds them (CC-099). The list only
names files that exist, so the row is added then.

The banners that do not need a live region of their own (`RequestBanner`, `SiteRequests`, `ConnectionBanner`,
`StreakAtRisk`, `SaveProgressCard`, `ComputerNote`) use `role="status"` or `role="alert"`, which the rule allows.

## 7. The check

`npm run lint` runs `scripts/check-css-tokens.mjs` over every CSS file of the web app except the token files. It refuses:

1. **A raw colour**: a hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` or a named
   colour. `transparent` and `currentColor` are fine.
2. **A raw `z-index`**: anything but `var(--layer-*)`, `auto` or a global keyword.
3. **A raw size** in `font-size`, `line-height`, `border-radius`, `gap`, `padding` or `margin` (and their longhands),
   written in `px` or `rem`, also inside `calc()` or a `var()` fallback. Zero, `auto`, percentages, `em`, `ch`,
   viewport units and `calc()` over tokens are fine.
4. **A custom property** that holds a raw colour or a raw `px` or `rem` size. Values are defined in the token files
   only. One allowance: a seasonal event theme in `apps/web/src/effects/themes/` (ADR-075) overrides tokens under
   `[data-event-theme="…"]`, so its custom properties may hold raw values. Every other declaration in it follows
   these rules.
5. **`position: fixed`** outside the pop-up components above.
6. **An unknown custom property** (CC-323): a `var(--name)` that no stylesheet declares, which made the
   declaration do nothing (`--text-base` and `--space-5` did). Names declared in any of the app's stylesheets count,
   so a theme set on a parent still works.
7. **A media query width that is not a breakpoint token** (CC-323).

A unit test also fails when a component names a CSS module class that its module does not define
(`styles/classNames.test.js`), which found three (`cookies`, `shell`, `page`).

Each message names the file, the line and the token to use. When a token already holds the raw value, the message
names it, for example `z-index: 40 is not a layer. Use var(--layer-effect)`.

**Built as stylelint rules, run by our own script for now.** The owner chose stylelint (D4). stylelint 17.16.0, the
latest, brings a high `npm audit` finding with no fix (GHSA-vfj7-8cjw-p6xm in `braces`), and the audit is a
required check. So each rule in [`scripts/design/cssTokens.mjs`](../../scripts/design/cssTokens.mjs) has a stylelint
plugin rule's shape over a PostCSS parse, and the script runs them. Moving to stylelint 18, which drops `braces`, is
a wrap with `stylelint.createPlugin` (CC-314, "D4 and ADR-008").

### Exceptions

One list, each entry one property in one file with its reason, in
[`scripts/design/tokenExceptions.mjs`](../../scripts/design/tokenExceptions.mjs). **The list may only shrink.** A test
fails when this table and the list differ, when the list grows past its ceiling, or when an entry no longer lets
anything through (then delete it and lower the ceiling).

<!-- token-exceptions:start -->

| File                                             | Property        | Why                                                                                            |
| ------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web/src/art/effects/effects.module.css`    | `border-radius` | A confetti piece's 2px corner is part of the drawing, not a control's radius.                  |
| `apps/web/src/art/effects/effects.module.css`    | `--drift`       | Each confetti piece's sideways drift, in pixels, is part of the drawing.                       |
| `apps/web/src/components/Toast/Toast.module.css` | `border-radius` | The toast's small diamond gem has a 3px corner, smaller than any control radius.               |
| `apps/web/src/games/chess/ChessBoard.module.css` | `margin-right`  | Captured pieces overlap by a fixed part of their own 1.25rem size.                             |
| `apps/web/src/games/chess/Board.module.css`      | `padding`       | The board's coordinates sit a fixed distance in from the square's corner, at every board size. |

<!-- token-exceptions:end -->

Inline styles stay blocked by the CSP and by the `style` lint rule (ADR-012 point 6), so a raw value cannot hide in
a `style` attribute.

## Known gaps (from [AUDIT-2026-10](AUDIT-2026-10.md), "Since CC-314")

CC-323 closed the four gaps listed here when ADR-076 was written: a destructive confirm no longer closes on a
backdrop click, the check refuses a `var()` that names no custom property (`--text-base` and `--space-5` are
replaced), weights and breakpoints have tokens, and `Card`, `EmptyState` and Button's danger look and link form
exist. Still open: no letter-spacing tokens yet, and 46 raw weights in the header (CC-324) and the match stage,
which the check refuses once those files move.

## 8. Changing the contract

1. Change this file first, in the same pull request as the code: a new role, a new pop-up row, a new exception.
2. A new token goes in its role's file under `styles/tokens/`, in both themes, and in `tokenRoles.js` if it is a role, so the token test checks
   its contrast and the design page shows it.
3. Anything a machine cannot see (is this the right component, is this copy short enough) is the design lens's job in
   review (CC-316), with this file to point at.
