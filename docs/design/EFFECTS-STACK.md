# UI effects and animation stack

The evaluation behind [ADR-075](../DECISIONS.md) ([CC-321](../tickets/CC-321.md)), 2026-10-21. Every number on this
page was measured for this decision, on a throwaway build of `main` at `8a50188a` that was never committed. How to
repeat the measurements is in [section 12](#12-how-to-repeat-the-measurements).

## 1. The decision in one table

| Tier         | What it is for                                                        | We use                                                                                                                        | Added to the first route |
| ------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Simple       | Hovers, presses, entrances, exits, toasts, dialogs, page changes      | CSS transitions and keyframes on the motion tokens, `@starting-style`, `@property`, the View Transitions API                  | 0 kB                     |
| Intermediate | Piece slides, layout moves, counters, progress, reward reveals        | Motion (`motion/react`, already in, ADR-016), through named presets                                                           | 0 kB (lazy chunks)       |
| Advanced     | Celebration bursts, seasonal event themes, one-off celebration scenes | Our own canvas particle module (about 0.75 kB) and theme CSS, loaded through one effect registry and switched by CC-312 flags | 0.33 kB (the registry)   |
| Not now      | An immersive hero scene in WebGL                                      | Nothing. If a later ticket proves the need, OGL is the only candidate, behind its own ADR                                     | -                        |

**Adopted:** CSS and tokens, the View Transitions API, `@property`, `@starting-style`, Motion (kept), our own canvas
particle module, the effect registry. **Allowed with limits:** the Web Animations API inside `apps/web/src/effects/`
only; scroll-driven animations as an enhancement only (Firefox has none). **Rejected:** GSAP, AutoAnimate, React
Spring, lottie-web (until real After Effects art exists, ADR-016 amendment point 2), the dotLottie player, Rive,
tsParticles, canvas-confetti, PixiJS, three.js, React Three Fiber, OGL (for now), Tailwind v4, Radix Primitives,
React Aria Components, shadcn/ui. Reasons per library are in section 4.

## 2. What we have today (verified in the repository)

| Item                 | Found                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime              | `react` 19.3.1, `react-dom` 19.3.1, `react-router` 8.4.0, `vite` 8.3.4 (`apps/web/package.json`)                                                                                                                                                                                                              |
| Motion               | `motion` 14.3.0 (released 2026-10-15). `components/Motion/MotionProvider.jsx`: `LazyMotion` with `strict`, features from `motionFeatures.js`, `MotionConfig reducedMotion="user"`. Only the chess board uses it today. 14.4.0 came out on 2026-10-19 (+0.1 kB on the features chunk, measured)                |
| Styling              | 79 CSS modules, 6,678 lines, 878 `styles.*` references in 103 files, 37 `@keyframes`. Motion tokens in `styles/tokens.css` (`--duration-instant` to `--duration-celebrate`, three easings), all durations 0 ms under `prefers-reduced-motion: reduce`                                                         |
| Effects              | `art/effects/` (Confetti: 24 CSS pieces, LevelUpBurst, StreakFlame, XpPop), `components/Celebrations/`. Each renders nothing under reduced motion (`hooks/useReducedMotion.js`)                                                                                                                               |
| Sound                | Synthesised with the Web Audio API in `lib/sound/` (ADR-018). No audio files                                                                                                                                                                                                                                  |
| Flags                | `packages/shared/src/flags.js` and `hooks/useFlag.js` (CC-312, ADR-073). The client learns `true` or `false` per flag from `GET /api/flags?names=…`                                                                                                                                                           |
| CSP, from production | `curl -sI https://nocapgaming.onrender.com/` on 2026-10-21: `default-src 'self';script-src 'self';style-src 'self';img-src 'self' data:;font-src 'self';connect-src 'self';object-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'none';upgrade-insecure-requests`. Same as `requestGuards.js` |
| First route          | **192.2 kB gzip of JavaScript** (`main` chunk, `npm run build:web`) plus 15.6 kB of CSS. Production serves it as 185.0 kB gzip or 188.4 kB brotli (measured with `curl`). The brief's "about 153 kB" is out of date: the route is about 42 kB over the 150 kB target (CC-135)                                 |

What the CSP means for effect libraries: there is no `worker-src`, so workers fall back to `script-src 'self'`
(same-origin worker files allowed, `blob:` workers blocked); there is no `'wasm-unsafe-eval'`, so WebAssembly cannot
compile; there is no `'unsafe-eval'`, so `eval` and `new Function` throw; `style-src 'self'` blocks `<style>`
elements and style attributes in markup, but not styles set from script. Section 5 shows each of these in three
browser engines.

## 3. How we measured

- **Sizes.** Every candidate was installed at its latest stable version in a throwaway checkout, and a small module
  using it the way we would (one file per candidate in `src/effectsLab/cases/`) was added as a lazy chunk next to
  the app. `npm run build:web` built both, with Vite's manifest on. The size of a candidate is the gzip size of
  every chunk its module pulls in that the first route does not already load (React and React DOM are free for the
  React wrappers because the app already has them). Runtime downloads were then counted in the browser from the
  files actually fetched, which catches chunks a library imports lazily (PixiJS renderers, tsParticles plugins).
- **CSP.** The built files were served by Express with the production server's own `helmet` call and
  `contentSecurityPolicy()` imported from `apps/server/src/service/http/requestGuards.js` (only
  `upgrade-insecure-requests` dropped, because the test ran on plain HTTP on localhost). Every
  `securitypolicyviolation` event, console error and request to another origin was recorded with Playwright 1.64 in
  Chromium 156, Firefox 157 and WebKit (Safari 27.2).
- **Performance.** One scene for every candidate: confetti pieces falling and spinning over a 390 × 844 phone screen
  at device pixel ratio 2.625, with touch and mobile emulation. Chromium's CPU throttling (CDP
  `Emulation.setCPUThrottlingRate`) at **4×**, our stand-in for a ₹8,000 to ₹15,000 Android phone (LOOK_AND_FEEL
  §2.1.5), with 150 pieces, and at **6×** with 600 pieces as a stress test. After one second of warm-up, four
  seconds of `requestAnimationFrame` intervals and Chromium's `Performance.getMetrics` (main-thread task time).
  Three runs each; the tables show the median and the range.
- **Caveats.** Headless Chromium draws WebGL with SwiftShader on the CPU, so the WebGL rows overstate main-thread
  cost and say nothing about a real phone GPU. CPU throttling does not slow the GPU or the compositor. Frame rate
  alone did not separate the candidates at 150 pieces (all held 60 fps), so main-thread time per second is the
  number to compare: it is what a player's taps and our game code compete with.
- **Support numbers.** `caniuse-lite` 1.0.30001816 (global usage and its India region table), and `web-features`
  for features caniuse does not track (scroll-driven animations, `@property`), with usage summed from the same
  caniuse tables. The India numbers are the share of page views in India on a browser that has the feature.

## 4. Evaluation

### 4.1 The full table

Sizes are gzip, added on top of the first route. "Main thread" is the median main-thread task time per second
while the 150-piece scene plays at 4× CPU throttling (lower is better; the browser idling is about 5 ms/s).

| Candidate                                       | Version, released       | Licence                                                      | Maintenance (GitHub, 2026-10-21)                               | React 19                            | Under our CSP (measured)                                                                                                     | Size added (gzip)                                                         | Main thread, 150 at 4×                       | Reduced motion                                                                  | Overlap with what we have                   | Complexity | Verdict                         |
| ----------------------------------------------- | ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- | ---------- | ------------------------------- |
| CSS keyframes and transitions, tokens           | Platform                | -                                                            | -                                                              | -                                   | Works (module CSS files are `'self'`)                                                                                        | 0                                                                         | 149 ms/s literal keyframes, 255 with `var()` | One media query; the tokens already go to 0 ms                                  | Is what we have                             | Low        | **Adopt** (simple)              |
| View Transitions API                            | Platform                | -                                                            | -                                                              | `<ViewTransition>` in 19.3.1        | Works in all three engines                                                                                                   | 0                                                                         | not measured (page change)                   | Turn `::view-transition-*` animations off                                       | Replaces route animation code               | Low        | **Adopt** (simple)              |
| `@property`                                     | Platform, Baseline 2024 | -                                                            | -                                                              | -                                   | Works, interpolates in all three engines                                                                                     | 0                                                                         | -                                            | Same media query                                                                | None                                        | Low        | **Adopt** (simple)              |
| Scroll-driven animations                        | Platform, not Baseline  | -                                                            | -                                                              | -                                   | Works in Chromium and WebKit; **Firefox 157 has none**                                                                       | 0                                                                         | -                                            | Same media query                                                                | None                                        | Low        | Enhancement only                |
| Web Animations API                              | Platform, Baseline 2020 | -                                                            | -                                                              | -                                   | Works                                                                                                                        | 0                                                                         | 121 ms/s                                     | None built in; our code checks                                                  | Motion uses it underneath                   | Low        | Inside `effects/` only          |
| **Motion** (`motion/react`)                     | 14.3.0, 2026-10-15      | MIT                                                          | Pushed 2026-10-20, 31 open issues, 110 closed in 90 days       | Peer `^18 \|\| ^19`                 | No violations                                                                                                                | 0 (core 17.1 kB with the boards, features 17.9 kB, both lazy); 33.0 alone | 202 ms/s                                     | `MotionConfig reducedMotion="user"`: measured, nothing moved                    | Is what we have                             | Low        | **Keep** (intermediate)         |
| GSAP                                            | 3.15.0, 2026-04-13      | GSAP Standard "no charge" licence (Webflow), not open source | Pushed 2026-04-13, 7 open issues, 1 closed in 90 days          | Framework-free; `@gsap/react` 2.1.2 | No violations                                                                                                                | 27.8                                                                      | 160 ms/s                                     | Only if we wrap every tween in `gsap.matchMedia()`                              | Full overlap with Motion                    | Medium     | Reject                          |
| AutoAnimate                                     | 0.10.0, 2026-07-10      | MIT                                                          | 39 open issues, **0 closed in 90 days**, pre-1.0               | Hook works                          | No violations                                                                                                                | 3.4                                                                       | -                                            | Built in (measured: 7.6 ms/s, no animation)                                     | Motion `layout` does this                   | Low        | Reject                          |
| React Spring (`@react-spring/web`)              | 10.1.2, 2026-06-24      | MIT                                                          | 62 open issues, 10 closed in 90 days                           | Peer includes `^19`                 | No violations                                                                                                                | 17.6                                                                      | 234 ms/s (script 118, the most)              | `useReducedMotion` plus `immediate`: with `loop` the tab **crashed** in our run | Full overlap with Motion                    | Medium     | Reject                          |
| lottie-web, `lottie_light`                      | 5.13.0, 2025-05-21      | MIT                                                          | Last push 2025-09-01, **788 open issues, 1 closed in 90 days** | Framework-free                      | No violations                                                                                                                | 48.4, plus about 7 kB of JSON per 150-layer animation                     | 207 ms/s                                     | None built in (no `prefers-reduced-motion` in its code)                         | CSS and Motion for anything we draw in code | Medium     | Reject now (ADR-016 am. 2 kept) |
| lottie-web, full build                          | 5.13.0                  | MIT                                                          | as above                                                       | as above                            | **An animation with one expression is blocked** (`script-src` eval) and stops; without expressions it plays                  | 78.4                                                                      | 241 ms/s                                     | None built in                                                                   | as above                                    | Medium     | Reject                          |
| dotLottie player (`@lottiefiles/dotlottie-web`) | 0.81.0, 2026-10-06      | MIT                                                          | 8 open issues, 9 closed in 90 days, pre-1.0                    | `dotlottie-react` 0.20.0            | **Fails to start**: WebAssembly blocked (`script-src`); its default wasm from jsDelivr and unpkg is blocked by `connect-src` | 15.1 + **499.4 kB wasm**                                                  | 422 ms/s (with `'wasm-unsafe-eval'` added)   | None built in                                                                   | Same as Lottie                              | Medium     | Reject                          |
| Rive (`@rive-app/canvas-lite`)                  | 2.45.0, 2026-10-17      | MIT                                                          | 53 open issues, 9 closed in 90 days                            | `react-canvas` 4.37.0, peer `^19.0` | **Fails to start**: WebAssembly blocked; default wasm from unpkg, fallback jsDelivr, both blocked by `connect-src`           | 53.8 + **328.8 kB wasm** (React wrapper: 75.0 + 866.8 kB wasm)            | 119 ms/s (with `'wasm-unsafe-eval'`)         | None built in                                                                   | Story characters only (CC-194)              | High       | Reject now                      |
| tsParticles (`@tsparticles/slim` + motion)      | 4.4.0, 2026-08-31       | MIT                                                          | 8 open issues, 1 closed in 90 days                             | `@tsparticles/react` 4.4.0          | No violations                                                                                                                | 29.4 static, **50.1 fetched** (plugins load lazily), 39 packages          | 167 ms/s, start 109 ms                       | Motion plugin stops movement but keeps drawing (44.8 ms/s while still)          | Our own module                              | Medium     | Reject                          |
| canvas-confetti (comparison)                    | 1.9.4, 2025-10-25       | ISC                                                          | 38 open issues, 0 closed in 90 days                            | Framework-free                      | Main thread works; **`useWorker` is blocked** (`blob:` worker)                                                               | 4.4                                                                       | 119 ms/s                                     | `disableForReducedMotion` (measured)                                            | Our own module                              | Low        | Reject (close second)           |
| **Our own canvas module**                       | ours                    | ours                                                         | ours                                                           | Plain module                        | No violations, nothing to allow                                                                                              | **0.75** shared + about 0.2 per scene                                     | 121 ms/s, start 16 ms                        | Never starts (measured: 3 ms/s)                                                 | Replaces the 24-span CSS confetti           | Low        | **Adopt** (advanced)            |
| PixiJS                                          | 8.22.0, 2026-10-01      | MIT                                                          | 303 open issues, 45 closed in 90 days                          | Framework-free                      | **Fails to start** ("does not allow unsafe-eval, please use pixi.js/unsafe-eval"); works with that module                    | 135.1 static, 154.5 fetched                                               | 329 ms/s (WebGL, see caveats)                | None built in                                                                   | Our own module for 2D                       | High       | Reject                          |
| three.js                                        | 0.186.1, 2026-09-24     | MIT                                                          | 255 open issues, 203 closed in 90 days                         | Framework-free                      | No violations                                                                                                                | **186.3**                                                                 | 331 ms/s (WebGL)                             | None built in                                                                   | None (no 3D today)                          | High       | Reject                          |
| React Three Fiber                               | 9.8.2, 2026-10-14       | MIT                                                          | 13 open issues, 72 closed in 90 days                           | Peer **`>=19 <19.4`**               | No violations                                                                                                                | **241.1** (with three)                                                    | about the same as three                      | None built in                                                                   | None                                        | High       | Reject                          |
| OGL                                             | 1.0.11, 2025-01-27      | Unlicense                                                    | Last push 2025-04-13, 19 open issues, 0 closed in 90 days      | Framework-free                      | No violations                                                                                                                | 13.8                                                                      | 567 ms/s (WebGL, see caveats)                | None built in                                                                   | None                                        | High       | Reject now, the one to revisit  |
| Tailwind CSS v4 (`@tailwindcss/vite`)           | 4.3.3, 2026-07-16       | MIT                                                          | 34 open issues, 43 closed in 90 days                           | -                                   | Static CSS, fine                                                                                                             | 2.6 kB of CSS for one dialog; 16 build packages                           | -                                            | `motion-reduce:` variants                                                       | A second styling system beside CSS Modules  | High       | Reject                          |
| Radix Primitives (`radix-ui`)                   | 1.8.1, 2026-10-12       | MIT                                                          | 124 open issues, 105 closed in 90 days                         | Peer includes `^19`                 | **Violation in all three engines**: an injected `<style>` (scroll lock) is blocked by `style-src`                            | 13.5 for Dialog (24 packages; the umbrella has 73)                        | -                                            | Not its job                                                                     | Our `Modal` (CC-314 adds the focus trap)    | Medium     | Reject                          |
| React Aria Components                           | 1.22.1, 2026-10-09      | Apache-2.0                                                   | 524 open issues, 123 closed in 90 days                         | Peer includes `^19`                 | **Violation in all three engines**: `usePress` injects a `<style>` (it takes a nonce; we have none)                          | 24.4 for a modal Dialog                                                   | -                                            | Not its job                                                                     | Our `Modal`                                 | Medium     | Reject                          |
| shadcn/ui (copied code)                         | CLI 4.22.1, 2026-10-18  | MIT                                                          | 796 open issues, 366 closed in 90 days                         | Yes                                 | The same Radix violation                                                                                                     | 25.3 for Dialog + Button (Radix, cva, clsx, tailwind-merge, Tailwind CSS) | -                                            | Through Tailwind                                                                | Our components and CC-314's contract        | High       | Reject                          |

`npm audit` reported 0 vulnerabilities with every candidate installed at once.

### 4.2 Why each one is adopted or rejected

- **CSS and tokens (adopt).** Zero bytes, runs on the compositor when the keyframes hold literal values, works under
  the CSP, and reduced motion is already handled by the tokens. One measured rule: **no `var()` inside
  `@keyframes`.** The same 150 pieces cost 255 ms/s of main thread with custom properties in the keyframes and
  149 ms/s with literal keyframes and per-piece longhands (`animation-duration`, `animation-delay`); at 600 pieces
  and 6× the `var()` version fell to 39 fps with 54 % of frames over 20 ms, the literal one held 60 fps.
- **View Transitions (adopt).** Same-document transitions reach 92.9 % of users worldwide and 94.2 % in India
  (Chrome 111, Safari 18, Firefox 144, Samsung Internet 23; Baseline since 2025-10-14). They ran under our CSP in all
  three engines. React 19.3.1 exports `ViewTransition` (checked in the installed package), so CC-153d uses React's
  component around the outlet, not React Router's deprecated `viewTransition` prop (LOOK_AND_FEEL §3.5). Browsers
  without it simply change the page. Cross-document transitions (86.8 % and 91.8 %, no Firefox) are not needed in a
  single-page app.
- **`@property` and `@starting-style` (adopt).** `@property` is Baseline since 2024-07-09, about 93.8 % worldwide
  and 94.8 % in India; a registered `<number>` interpolated mid-animation in all three engines. Use it for colour
  and glow on small elements (it repaints, so not on large areas). `@starting-style` (Baseline 2024-08-06, about
  91 %) gives toast and dialog entrances without script.
- **Scroll-driven animations (enhancement only).** Chrome 115 and Safari 26, not Firefox (Firefox 157 reported no
  `animation-timeline` support in our run), about 86 % worldwide and 92 % in India. Fine for a decorative progress
  bar; never for anything a player needs to see.
- **Web Animations API (inside `effects/` only).** 121 ms/s, the cheapest DOM option, no download. It is what Motion
  drives underneath, so components use CSS or Motion, and only the effects module may call `element.animate`
  directly (one place, so there is still one animation system in components).
- **Motion (keep).** Already loaded with the boards (core 17.1 kB in the `useBoardInput` chunk, features 17.9 kB in
  `motionFeatures`), never on the first route, MIT, the most active project in the list, and its reduced motion
  setting worked as documented. It is the only library here that moves an element between parents (ADR-016's
  reason). It is not for particles: 150 `m.span` elements cost 202 ms/s, and 600 at 6× dropped to 53 fps with 14 %
  of frames over 20 ms. Upgrade to 14.4.0 in a normal dependency chore (ADR-008); it adds 0.1 kB.
- **GSAP (reject).** Free for commercial use, plugins included, under Webflow's "Standard no charge" licence (read
  on gsap.com/standard-license on 2026-10-21). That licence is not open source: Webflow "may terminate this GSAP
  License and revoke your access in its discretion", may change it at any time, and forbids use in visual
  animation builders that compete with Webflow. It adds 27.8 kB to do what Motion already does, its script time was
  10 times Motion's (47.8 against 4.8 ms/s), and reduced motion is opt-in per tween. Its last release was
  2026-04-13. The owner's ADR-016 amendment already ruled it out; nothing measured here changes that.
- **AutoAnimate (reject).** Small (3.4 kB) and respects reduced motion, but Motion's `layout` prop does the same,
  and the project closed no issues in 90 days.
- **React Spring (reject).** 17.6 kB, the highest script time of all DOM candidates (118 ms/s at 4×, 575 at 6×), and
  the reduced-motion run with `loop` and `immediate` crashed the tab. A second spring system next to Motion.
- **lottie-web (reject until real art exists).** 48.4 kB for the light build, near-unmaintained (1 issue closed in
  90 days out of 788 open), no reduced-motion support, and the full build's expressions are blocked by our CSP.
  ADR-016 amendment point 2 stays: if a designer delivers After Effects art for the characters (CC-194, CC-230),
  `lottie_light` with the SVG renderer, lazily, with our own reduced-motion check, under its own ticket.
- **dotLottie and Rive (reject).** Both need WebAssembly, which our CSP blocks in every engine; both try to fetch
  their wasm from a CDN by default, which `connect-src 'self'` blocks; and the wasm alone is 499 kB (dotLottie) or
  329 kB (Rive lite) gzip, two to three times the whole first route, about 2 s at Lighthouse's slow 4G. With
  `'wasm-unsafe-eval'` added (tested) both ran. Rive's state machines are the only real reason to come back: an
  interactive Bit or story character (CC-194) would need its own ADR that adds `'wasm-unsafe-eval'` to `script-src`
  and self-hosts the wasm.
- **tsParticles (reject).** 50.1 kB fetched at run time, 39 packages, 109 ms to start at 4× (a visible hitch on the
  result screen), and with reduced motion it stops the particles but keeps drawing every frame.
- **canvas-confetti (reject, close second).** 4.4 kB, decent reduced-motion handling, but its worker mode is blocked
  by our CSP, it only does confetti (no themes, no sparks), and it closed no issues in 90 days. Our module is a
  sixth of its size, faster at 600 pieces (245 against 461 ms/s) and does exactly what the registry needs.
- **Our own canvas module (adopt).** One 2D canvas, one pool in typed arrays (nothing allocated per frame), a hard
  cap, device pixel ratio clamped to 2, paused while the tab is hidden, never started under reduced motion, stopped
  after its duration. 0.75 kB gzip. At 600 pieces and 6× it held 60 fps at 245 ms/s, the lowest of every candidate.
  No CSP change. About 130 lines we own and test, which the owner's ADR-016 amendment accepts for this purpose
  better than a second library.
- **PixiJS (reject).** The default build fails under our CSP (it needs `new Function`); the `pixi.js/unsafe-eval`
  module fixes that, but 154.5 kB to draw 2D sprites we draw in 0.75 kB is not worth it.
- **three.js and React Three Fiber (reject).** 186.3 kB and 241.1 kB, each larger than the 150 kB budget for the
  whole first route, for one scene. R3F also pins React below 19.4, which would hold back React upgrades (ADR-008).
- **OGL (reject now).** 13.8 kB and clean under the CSP, but no release since 2025-01-27 and no issue closed in 90
  days. If a later ticket proves that an immersive hero scene helps players, OGL is the only candidate, behind its
  own ADR, a flag, a static poster for every phone that fails a capability check, and real-device numbers.
- **Tailwind v4 and shadcn/ui (reject).** Migrating mid-project means 79 CSS modules, 6,678 lines and 878 class
  references in 103 files, while CC-314 builds the design contract on `tokens.css`. Two styling systems would
  defeat that contract. shadcn/ui is Tailwind plus Radix, so it inherits both problems.
- **Radix Primitives and React Aria Components (reject).** Both inject a `<style>` element that our CSP blocks, in
  all three engines. The e2e `players` fixture fails on any CSP violation (ADR-016 point 4), so either would need
  `'unsafe-inline'` styles or nonces we do not have. The gaps they would fill (focus trap, `inert`) are in CC-314's
  `Modal` contract with no dependency.

## 5. Measurements

### 5.1 Size, from `npm run build:web`

The first route stays at 192.18 kB gzip of JavaScript with every candidate built as a lazy chunk (192.17 kB before),
so none of them leaks into it when loaded with `import()`. With the effect registry sketch added to `main.jsx` it is
192.51 kB: **+0.33 kB**. The registry's two lazy scenes were 0.19 and 0.21 kB, and the shared particle module 0.75 kB.

| Candidate (what the module imports)                   | JS gzip (kB) | Other files (gzip)        | Fetched in the browser (kB) | At slow 4G (200 kB/s, 150 ms RTT) |
| ----------------------------------------------------- | -----------: | ------------------------- | --------------------------: | --------------------------------: |
| Own canvas module                                     |         0.75 | -                         |                         1.5 |                             0.2 s |
| AutoAnimate (`useAutoAnimate`)                        |          3.4 | -                         |                         3.4 |                             0.2 s |
| canvas-confetti                                       |          4.4 | -                         |                         4.4 |                             0.2 s |
| Radix `Dialog`                                        |         13.5 | -                         |                        13.5 |                             0.2 s |
| OGL (Renderer, Program, Mesh, Geometry)               |         13.8 | -                         |                        13.8 |                             0.2 s |
| React Spring (`useSprings`, `animated`)               |         17.6 | -                         |                        17.6 |                             0.2 s |
| shadcn Dialog + Button                                |         22.7 | 2.6 CSS                   |                        25.3 |                             0.3 s |
| React Aria Components modal `Dialog`                  |         24.4 | -                         |                        24.4 |                             0.3 s |
| GSAP core (`gsap.to`)                                 |         27.8 | -                         |                        27.8 |                             0.3 s |
| tsParticles engine + slim + motion plugin             |         29.4 | lazy plugins              |                        50.1 |                             0.4 s |
| tsParticles confetti bundle                           |         22.8 | lazy plugins              |                        43.1 |                             0.4 s |
| Motion (core + `domAnimation`) on a page without them |         33.0 | -                         |                        33.0 |                             0.3 s |
| lottie-web `lottie_light`                             |         48.4 | about 7 kB JSON per scene |                        48.4 |                             0.4 s |
| Rive `canvas-lite`                                    |         53.8 | 328.8 wasm (256.7 brotli) |                       404.6 |                             2.2 s |
| Rive `react-canvas` (full runtime)                    |         75.0 | 866.8 wasm (690.5 brotli) |                           - |                             4.7 s |
| dotLottie web                                         |         15.1 | 499.4 wasm (388.2 brotli) |                       514.4 |                             2.7 s |
| lottie-web full build                                 |         78.4 | -                         |                        78.4 |                             0.5 s |
| PixiJS (`Application`, `Graphics`) + `unsafe-eval`    |        135.1 | lazy renderer chunks      |                       154.5 |                             0.9 s |
| three.js (`InstancedMesh` scene)                      |        186.3 | -                         |                       186.3 |                             1.1 s |
| React Three Fiber + three                             |        241.1 | -                         |                       241.1 |                             1.4 s |

Gzip is Node's default level, the same as Vite's report. "Fetched" counts only files not already on the first
route. The slow 4G column is Lighthouse's profile (1.6 Mbps), download only.

### 5.2 What the CSP allows, in three engines

The building blocks each library needs, probed under the production policy.

| Capability                              | Chromium 156               | Firefox 157 | WebKit (Safari 27.2) | Who needs it                                 |
| --------------------------------------- | -------------------------- | ----------- | -------------------- | -------------------------------------------- |
| Worker from a same-origin file          | Allowed                    | Allowed     | Allowed              | Off-main-thread drawing, if ever             |
| Worker from a `blob:` URL               | Blocked (`worker-src`)     | Blocked     | Blocked              | canvas-confetti `useWorker`                  |
| `WebAssembly.instantiate` and streaming | Blocked (`script-src`)     | Blocked     | Blocked              | Rive, dotLottie                              |
| `eval`, `new Function`                  | Blocked                    | Blocked     | Blocked              | PixiJS default, lottie-web expressions       |
| A `<style>` element                     | Blocked (`style-src-elem`) | Blocked     | Blocked              | Radix (scroll lock), React Aria (`usePress`) |
| A `style` attribute in markup           | Blocked (`style-src-attr`) | Blocked     | Blocked              | -                                            |
| Styles set from script (`el.style`)     | Allowed                    | Allowed     | Allowed              | Motion, GSAP, all DOM animation              |
| Constructable stylesheets               | Allowed                    | Allowed     | Allowed              | -                                            |
| `OffscreenCanvas`                       | Allowed                    | Allowed     | Allowed              | -                                            |

Per library, in Chromium (and the same results in Firefox and WebKit for every one we ran there: our module,
Motion, `lottie_light`, tsParticles, PixiJS with `unsafe-eval`, three.js, Radix, React Aria):

| Library                                                                                                                        | Result                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| CSS, WAAPI, our module, Motion, GSAP, React Spring, AutoAnimate, `lottie_light`, tsParticles, canvas-confetti, three, R3F, OGL | No violation, no request to another origin                                                               |
| lottie-web full build                                                                                                          | Plays without expressions; one expression: `script-src` blocks eval and the animation stops              |
| dotLottie                                                                                                                      | `script-src` blocks the wasm; default source: `connect-src` blocks `cdn.jsdelivr.net` and `unpkg.com`    |
| Rive lite and React wrapper                                                                                                    | The same, `unpkg.com` then `cdn.jsdelivr.net`                                                            |
| canvas-confetti with `useWorker`                                                                                               | `worker-src` (falling back to `script-src`) blocks the `blob:` worker                                    |
| PixiJS                                                                                                                         | Throws at start: "Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module" |
| Radix Dialog, shadcn Dialog                                                                                                    | `style-src-elem` blocks an injected `<style>`                                                            |
| React Aria modal                                                                                                               | `style-src-elem` blocks an injected `<style>`                                                            |
| Rive and dotLottie with `'wasm-unsafe-eval'` added                                                                             | Run (shows the one change they would need)                                                               |

### 5.3 Frame time and main thread, Chromium with CPU throttling

390 × 844 at DPR 2.625, median of three runs (range in brackets). "Over 20 ms" is the share of frames that took
longer than 20 ms, which a player sees as a stutter.

| Candidate                 | 150 at 4×: fps | p95 frame | Main thread ms/s | Script ms/s | Start (ms) | 600 at 6×: fps | p95 frame | Over 20 ms | Main thread ms/s  |
| ------------------------- | -------------: | --------: | ---------------- | ----------: | ---------: | -------------: | --------: | ---------: | ----------------- |
| Own canvas module         |             60 |      16.8 | 121 (117-122)    |         8.2 |         16 |             60 |      16.8 |        0 % | **245** (194-283) |
| canvas-confetti           |             60 |      16.7 | 119 (102-128)    |        29.3 |         14 |             60 |      16.7 |        0 % | 461 (441-476)     |
| Web Animations API        |             60 |      16.8 | 121 (80-124)     |         2.6 |          6 |             60 |      16.8 |        0 % | 598 (591-724)     |
| CSS, literal keyframes    |             60 |      16.8 | 149 (134-157)    |         2.7 |          3 |             60 |      16.7 |        0 % | 871 (854-901)     |
| CSS, `var()` in keyframes |             60 |      16.8 | 255 (214-282)    |         4.0 |          4 |         **39** |      33.4 |   **54 %** | 1001 (saturated)  |
| Motion                    |             60 |      16.8 | 202 (194-206)    |         4.8 |          5 |         **53** |      33.4 |   **14 %** | 999 (saturated)   |
| GSAP                      |             60 |      16.8 | 160 (139-170)    |        47.8 |         18 |             60 |      16.7 |        0 % | 751 (681-810)     |
| React Spring              |             60 |      16.8 | 234 (203-245)    |       117.5 |          4 |         **54** |      33.4 |   **11 %** | 987 (853-1011)    |
| lottie-web `lottie_light` |             60 |      16.8 | 207 (167-214)    |        85.4 |         43 |             60 |      16.7 |      0.8 % | 949 (828-957)     |
| tsParticles slim          |             60 |      16.7 | 167 (121-174)    |        56.2 |    **109** |             60 |      16.7 |      0.4 % | 548 (489-558)     |
| PixiJS (WebGL)            |             60 |      16.8 | 329 (301-346)    |        30.9 |         86 |             60 |      16.7 |        0 % | 439 (412-549)     |
| three.js (WebGL)          |             60 |      16.7 | 331 (279-350)    |        20.2 |         33 |             60 |      16.8 |        0 % | 515 (501-605)     |
| OGL (WebGL)               |             60 |      16.7 | 567 (565-584)    |        11.3 |         23 |             60 |      16.7 |        0 % | 803 (747-822)     |
| Rive (with wasm allowed)  |             60 |      16.7 | 119              |        36.4 |        113 |              - |         - |          - | -                 |
| dotLottie (wasm allowed)  |             60 |      16.7 | 422              |       390.5 |        110 |              - |         - |          - | -                 |

The WebGL rows run on SwiftShader (software) in headless Chromium, so their main-thread numbers are high for a
reason a phone with a GPU would not have; they are listed for completeness, not compared. Rive played its own sample
file, not our scene, so its row is only a sign of life.

What this says: at the size of a real celebration (150 pieces) every candidate holds 60 fps on the throttled
profile, so frame rate alone cannot choose. What differs is the main thread left for the game: our module and WAAPI
use the least, Motion and CSS with `var()` keyframes about twice that. At 600 pieces only the canvas approaches stay
far from saturation, and our module uses the least main thread of all.

### 5.4 Reduced motion, measured

Chromium with `reducedMotion: "reduce"`. "Moved" compares an element's transform or a frame counter half a second
apart.

| Candidate                              | Moved | Main thread ms/s | Notes                                                                                                                                                                                       |
| -------------------------------------- | ----- | ---------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS (`var()` version)                  | No    |              4.9 | The media query works. Our literal-keyframes test moved because a later `animation-name` rule overrode the media query's `animation: none`: reduced-motion rules go last, or use the tokens |
| Web Animations API                     | No    |              4.8 | Only because our code checks the media query                                                                                                                                                |
| Own canvas module                      | No    |              3.0 | Never starts                                                                                                                                                                                |
| Motion, `reducedMotion="user"`         | No    |              4.9 | Built in. Transforms jump to the end; opacity still fades                                                                                                                                   |
| GSAP with `gsap.matchMedia()`          | No    |              4.5 | Only when every tween is wrapped                                                                                                                                                            |
| React Spring, `useReducedMotion`       | -     |                - | The tab crashed with `loop` and `immediate`                                                                                                                                                 |
| AutoAnimate                            | No    |              7.6 | Built in                                                                                                                                                                                    |
| lottie-web                             | No    |              5.1 | Only because our code did not autoplay; nothing in the library                                                                                                                              |
| tsParticles, motion plugin             | No    |         **44.8** | Stops the particles but keeps drawing every frame                                                                                                                                           |
| canvas-confetti                        | No    |              4.8 | `disableForReducedMotion`                                                                                                                                                                   |
| Rive, dotLottie, PixiJS, three.js, OGL | -     |                - | No `prefers-reduced-motion` anywhere in their code (searched the installed packages)                                                                                                        |

### 5.5 Native features: who has them

| Feature                            | Status              |     Global |      India | First versions                                 | Measured under our CSP                  |
| ---------------------------------- | ------------------- | ---------: | ---------: | ---------------------------------------------- | --------------------------------------- |
| View Transitions, same document    | Baseline 2025-10-14 |     92.9 % |     94.2 % | Chrome 111, Safari 18, Firefox 144, Samsung 23 | Ran in Chromium, Firefox and WebKit     |
| View Transitions, across documents | Not Baseline        |     86.8 % |     91.8 % | Chrome 126, Safari 18.2, no Firefox            | Not needed (single-page app)            |
| Scroll-driven animations           | Not Baseline        | about 86 % | about 92 % | Chrome 115, Safari 26, no Firefox              | Chromium and WebKit yes, Firefox 157 no |
| `@property`                        | Baseline 2024-07-09 | about 94 % | about 95 % | Chrome 85, Safari 16.4, Firefox 128            | Interpolates in all three               |
| `@starting-style`                  | Baseline 2024-08-06 | about 91 % | about 94 % | Chrome 117, Safari 17.5, Firefox 129           | Supported in all three                  |
| Web Animations API                 | Baseline 2020-09-16 |     97.0 % |     96.5 % | Chrome 84, Safari 13.1, Firefox 75             | Works                                   |
| WebAssembly (for comparison)       | Baseline            |     97.2 % |     96.5 % | -                                              | Blocked by our CSP                      |

Exact percentages come from caniuse. The "about" figures are our sum of caniuse usage over the versions
`web-features` lists, with Samsung Internet and Opera mapped to their Chromium version.

## 6. The stack by tier

### 6.1 Simple: CSS and tokens

- Everything that can be a transition or a keyframe is one, on `--duration-*` and `--ease-*` (CC-281 adds the exit
  curve and named recipes). Only `transform` and `opacity` animate (ADR-012), except `@property` colour and glow on
  small elements.
- **No `var()` inside `@keyframes`.** Per-element variation goes in longhands set from script (`animation-delay`,
  `animation-duration`, `left` for a start position) or in a few literal keyframe variants.
- Toasts and dialogs enter with `@starting-style` and `transition-behavior: allow-discrete`; route changes use
  React's `<ViewTransition>` (CC-153d), with `::view-transition-*` animations off under reduced motion; rooms do not
  transition during a game.
- Scroll-driven animations only for decoration that is fine to miss.

### 6.2 Intermediate: Motion presets

- Motion stays the one animation library (ADR-016), through `MotionProvider` (`LazyMotion strict`,
  `reducedMotion="user"`), `m.*` only.
- **Presets** live in one file, `apps/web/src/components/Motion/presets.js` (CC-281 names them): `enter`, `exit`,
  `pop`, `stagger`, `celebrate`, `count` and `progress`, each a Motion `transition` object built from the same token
  values as the CSS (read once from `getComputedStyle(document.documentElement)`, so a token change moves both).
- **Counters** (XP, coins, scores): a `MotionValue` animated with Motion's `animate()` and written to the text with
  `useMotionValueEvent`, at most `--duration-celebrate` (1.2 s), the final number in the DOM from the first render
  for screen readers (`aria-live` stays on the sentence, not on the ticking number). Under reduced motion the final
  value shows at once.
- **Progress** (XP bar, quests): `scaleX` on a bar, never `width`.
- **Reward reveals** (CC-099's beats: result, XP, level up, unlocks, quests): Motion `AnimatePresence` for the
  card, one beat at a time from CC-099's queue, each beat at most 1.5 s (ADR-012).
- Not for particles: more than about 30 animating `m.*` elements at once is the advanced tier's job.

### 6.3 Advanced: the effect registry and our canvas module

- Celebrations (win burst, level-up sparks, streak flame burst) and seasonal event themes (Diwali, Holi, New Year,
  a tournament week) go through the registry in section 8. Nothing temporary is hardcoded in a page or component.
- Particles are drawn by our module (`apps/web/src/effects/particles.js`): one canvas overlay that the effect host
  owns, `aria-hidden`, `pointer-events: none`.
- Event themes are token overrides in a lazy CSS module and static SVG decorations, switched with a
  `data-event-theme` attribute on `<html>` set from script. No ambient loops: a theme may play one entrance burst,
  then it is still.
- **No immersive hero scene.** The home page keeps its CSS and SVG hero (`art/HeroArt.jsx`). A WebGL hero would
  cost more than the whole first route, and nothing shows it would help players choose a game. If a later ticket
  shows it would, it gets its own ADR with OGL, a flag, a static poster for phones that fail a capability check, and
  real-device measurements.

## 7. Lazy loading and code splitting

1. **The first route gets only the registry**: names, flags and loaders, 0.33 kB measured. Scenes, the particle
   module, theme CSS and Motion's chunks are never imported statically by anything on the first route.
2. **One chunk per effect**: each registry entry has `load: () => import("./scenes/winBurst.js")`. Vite emits it as
   its own file; the shared particle module becomes one more shared chunk (0.75 kB). Theme CSS comes with its
   scene's chunk and Vite loads it with a `<link>` from our origin, which the CSP allows.
3. **Prefetch at idle, near the moment.** When a room reaches the last move of a game (or a result is about to
   show), the host calls the entry's loader inside `requestIdleCallback` (a timeout of 0 where it is missing), so the
   chunk is cached before the celebration. Never when `navigator.connection.saveData` is true, and never on the first
   route.
4. **A failed load is silent.** The effect is decoration; the result text is already on screen. The host logs
   nothing a player sees and tries again on the next trigger. A stale deploy's missing chunk falls into CC-181's
   reload rule.
5. **The bundle check (CC-135)** gets two rules from this decision: no file under `apps/web/src/effects/scenes/` or
   `effects/themes/` in the first route's chunks (from Vite's manifest), and each effect's own chunks within its
   budget below.

## 8. The effect registry

One module, `apps/web/src/effects/registry.js`, lists every effect. It is data plus loaders, nothing else.

```js
/** @type {ReadonlyArray<Readonly<EffectEntry>>} */
export const EFFECTS = Object.freeze([
  Object.freeze({
    name: "win_burst", // snake case, how code asks for it
    kind: "celebration", // "celebration" (plays once on a trigger) or "theme" (on while its flag and window allow)
    ticket: "CC-099",
    flag: null, // a permanent celebration needs no flag
    particles: 120, // at most PARTICLE_CAP (300); the low-end tier gets a third
    durationMs: 1200, // at most 1500 (ADR-012)
    budgetKB: 2, // gzip of its own chunks, checked by CC-135's bundle check
    load: () => import("./scenes/winBurst.js"),
  }),
  Object.freeze({
    name: "diwali_2026",
    kind: "theme",
    ticket: "CC-055",
    flag: "event_diwali_2026", // registered in packages/shared/src/flags.js with client: true
    window: { from: "2026-11-05", to: "2026-11-12" }, // India days, inclusive
    removeBy: "2026-11-30", // the same day as its flag's removeBy, or earlier
    particles: 80,
    durationMs: 1500,
    budgetKB: 6,
    load: () => import("./themes/diwali2026.js"), // exports start(canvas) and the theme's CSS class
  }),
]);
```

The files around it:

| File                                 | What it does                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effects/registry.js`                | The list above, `effectNamed(name)` (throws `RangeError` on an unknown name, like `flagNamed`), and the caps. On the first route                             |
| `effects/EffectHost.jsx`             | Mounted once in `Layout`. Owns the one canvas overlay and the queue, asks for every registry flag in one `api.getFlags([...])` call, applies the gates below |
| `effects/useEffects.js`              | `const { play } = useEffects(); play("win_burst")`. The only way a component starts an effect                                                                |
| `effects/particles.js`               | The canvas module (lazy, shared by the scenes)                                                                                                               |
| `effects/scenes/*.js`                | One file per celebration: colours, counts, gravity, which sound recipe from `lib/sound` (ADR-018) goes with it                                               |
| `effects/themes/*.js`, `.module.css` | One pair per seasonal theme: the token overrides under `[data-event-theme="…"]` (CC-314 tokens only, no layout changes) and its optional entrance burst      |

**The gates, in this order, every time `play` is called or a theme could turn on:**

1. **Reduced motion**: the system setting, or the app's own motion setting once CC-280 adds `cc.look.motion`. A
   celebration does not play; a theme still applies its colours, without the burst.
2. **The flag**, when the entry has one: off until the server answers `true` (ADR-073 point 5).
3. **The window** for themes: today's India day inside `from` to `to`.
4. **The device**: `navigator.connection.saveData`, `navigator.deviceMemory <= 2` or `navigator.hardwareConcurrency
<= 4` gives the low-end tier (a third of the particles); save-data also skips prefetching.
5. **Visibility**: nothing starts while `document.hidden`.
6. **One at a time** (ADR-012): a second celebration waits in the queue behind the first (CC-099's beats) or is
   dropped if it would start more than 2 s late. A theme's burst never overlaps a celebration.
7. **Load, play, stop**: load the chunk, play for `durationMs`, then stop and clear the canvas. Leaving the page or
   unmounting the host stops it at once.

**Rules that tests enforce** (the PR that builds the registry adds them):

1. Every `flag` in the registry is registered in `flags.js` with `client: true`, and every theme has a flag, a
   `window` and a `removeBy` no later than its flag's. A test fails on an entry past its `removeBy`, as ADR-073
   point 7 does for flags, so a seasonal theme cannot outlive its season.
2. An ESLint `no-restricted-imports` rule: nothing outside `effects/` imports `effects/scenes/*`,
   `effects/themes/*` or `effects/particles.js`. Pages and components only call `play(name)`.
3. Each entry's `particles` is at most `PARTICLE_CAP` and its `durationMs` at most 1500; each `load()` resolves to a
   module with `start`.
4. Effects are decoration: the host's canvas is `aria-hidden`, and every celebration's meaning is also in text on
   the page (ADR-012). No effect ever takes a click or delays a move (CC-220).

The owner switches a theme on or off from the console's Flags tab, like any flag; the flag's rollout can also take a
theme to a percentage of players first.

## 9. Performance budgets

Each tier must meet these on the throttled profile (Chromium, 4× CPU, 390 × 844 at DPR 2.625), checked in the PR
that adds the effect, numbers in the PR.

| Budget                     | Simple (CSS, tokens)                                                                     | Intermediate (Motion presets)                                       | Advanced (registry, canvas)                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript added (gzip)    | 0 kB                                                                                     | 0 kB new; Motion's chunks (17.1 + 17.9 kB) never on the first route | Registry at most 0.5 kB on the first route; each effect at most 6 kB of its own chunks, theme CSS included; the particle module at most 1.5 kB |
| Frames                     | p95 at most 16.8 ms, under 1 % of frames over 20 ms                                      | p95 at most 16.8 ms, under 1 % over 20 ms                           | p95 at most 16.8 ms, under 1 % over 20 ms                                                                                                      |
| Main thread while it plays | at most 50 ms/s added for a UI transition                                                | at most 100 ms/s added; at most 30 `m.*` elements animating at once | at most 150 ms/s (our module: 121 at 150 particles)                                                                                            |
| Start                      | -                                                                                        | -                                                                   | at most 30 ms from `play` to the first frame once loaded (measured 16 ms)                                                                      |
| Count                      | -                                                                                        | -                                                                   | 150 particles by default, `PARTICLE_CAP` 300, a third on the low-end tier                                                                      |
| Duration                   | at most 300 ms for UI transitions (vision §5.13), 1.2 s for a celebration token          | at most 1.2 s for counters, 1.5 s per reward beat                   | at most 1.5 s per effect (ADR-012); nothing loops; a theme's burst plays once                                                                  |
| Properties                 | `transform`, `opacity`; `@property` colour on small elements; no `var()` in `@keyframes` | `transform`, `opacity`, `scaleX` for progress                       | Canvas only, DPR clamped to 2                                                                                                                  |
| Battery and visibility     | CSS animations stop with the tab                                                         | Motion's frame loop stops with the tab                              | Paused on `visibilitychange`, stopped on unmount; no wake locks; save-data skips prefetch and gets the low-end tier                            |
| Reduced motion             | Durations already 0 ms; reduced-motion rules come last                                   | `reducedMotion="user"`; final values at once                        | Celebrations do not play; themes keep their colours without a burst                                                                            |
| At most on screen          | -                                                                                        | -                                                                   | One full-screen effect at a time (ADR-012)                                                                                                     |

The Battery Status API is not used: only Chromium has it (Firefox removed it, Safari never shipped it), and short, finite effects make
it unnecessary.

## 10. What would reopen this

- A designer delivers After Effects character art: `lottie_light` under its own ticket (ADR-016 amendment point 2).
- Story mode needs an interactive character with states (CC-194): Rive, with an ADR that adds `'wasm-unsafe-eval'`
  and self-hosts the wasm, and a lazy route that only story pages load.
- A ticket shows an immersive hero scene would help: OGL, as in section 6.3.
- Motion stops being maintained or changes licence: the Web Animations API with our own measuring is the fallback
  ADR-016 already named.

## 11. Found along the way

- **The first route is 192.2 kB gzip, not about 153 kB**, about 42 kB over CC-135's 150 kB target. `chess.js`
  (11.6 kB gzip) is in the main chunk, which only chess pages need. This is CC-135's to fix; this decision adds
  0.33 kB.
- **Motion 14.4.0** (2026-10-19) is out; ADR-008 asks for latest stable, so the next dependency chore takes it.
- **React Spring crashed the tab** when `loop` met `immediate` under reduced motion. Another reason not to add it.

## 12. How to repeat the measurements

On a throwaway branch from `main` (never committed):

1. `npm install -w @classicade/web` the candidates, add one module per candidate under `apps/web/src/effectsLab/`
   using it as above, and a second Vite input `lab.html` that loads a case by `?lib=` with `import.meta.glob`.
2. `npm run build:web` with `build.manifest: true`; sum the gzip of each case's chunks that the `index.html` entry
   does not load.
3. Serve `apps/web/dist` with Express and `helmet({ contentSecurityPolicy: contentSecurityPolicy({ isProduction:
false }) })` imported from `apps/server/src/service/http/requestGuards.js`.
4. With Playwright: a 390 × 844 context at DPR 2.625, `Emulation.setCPUThrottlingRate` 4 (and 6), a
   `securitypolicyviolation` listener from `addInitScript`, one second of warm-up, then four seconds of
   `requestAnimationFrame` deltas and `Performance.getMetrics` before and after. Three runs, median.
