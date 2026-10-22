/**
 * The effect registry (ADR-075, CC-328): every celebration and seasonal theme, as data and a lazy loader. It is the
 * only part of the effects on the first route, so it holds nothing else. Components never import a scene or a
 * theme: they call `useEffects().play(name)`, and the one `EffectHost` in the layout loads and plays it.
 *
 * Every rule here is checked by `registry.test.js`, and each effect's chunk by the bundle check
 * (`scripts/bin/check-bundle.mjs`), which reads `budgetKB` from the loader's own text, so a loader is always
 * written as `() => import("./scenes/name.js")`.
 *
 * @typedef {Object} EffectEntry
 * @property {string} name          snake case, how code asks for it
 * @property {"celebration" | "theme"} kind  a celebration plays once on a trigger; a theme is on while its flag
 *   and window allow
 * @property {string} ticket        the ticket that owns it
 * @property {string | null} flag   a flag in packages/shared/src/flags.js marked `client`; null for a celebration
 * @property {{ from: string, to: string }} [window]  themes: the India days it is on, inclusive
 * @property {string} [removeBy]    themes: the India day by which it is deleted, no later than its flag's
 * @property {number} particles     at most PARTICLE_CAP; the low-end tier gets LOW_END_SHARE of them
 * @property {number} durationMs    at most MAX_EFFECT_MS
 * @property {number} budgetKB      gzip of its own chunk with its CSS
 * @property {() => Promise<{ start: Function, greeting?: { hi: string, en: string } }>} load  a theme's module also
 *   exports its `greeting`, the one line on the home hero in Hinglish and English. It lives there, not here, to keep
 *   the registry within its 0.5 kB on the first route; it shows with the theme's colours, when its chunk arrives
 */

/** The most particles any effect may draw (ADR-075). */
export const PARTICLE_CAP = 300;
/** What an effect gets when it does not say. */
export const DEFAULT_PARTICLES = 150;
/** No effect plays longer (ADR-012). */
export const MAX_EFFECT_MS = 1500;
/** The share of its particles an effect draws on a low-end phone or with save-data. */
export const LOW_END_SHARE = 1 / 3;
/**
 * The most particles an effect draws on a phone-sized screen (under 40rem wide), which also shows less of it: what
 * holds 150 ms/s of main thread on the throttled profile (Chromium 4x CPU, 390 x 844, design lead 2026-10-21).
 */
export const PHONE_PARTICLE_CAP = 80;

/**
 * The only tokens a theme may set (CC-328 D5): decoration, never a status, a player, a text colour or a surface,
 * so no contrast in the design contract can change. `themes.test.js` fails on any other property.
 */
export const THEMEABLE_TOKENS = /* @__PURE__ */ Object.freeze([
  "--gradient-hero",
  "--grid-line",
  "--glow-primary",
  "--glow-gold",
  "--color-neon-rps",
  "--color-neon-tictactoe",
  "--color-neon-accent",
  "--color-neon-gold",
  "--color-neon-xp",
  "--effect-ink-1",
  "--effect-ink-2",
  "--effect-ink-3",
  "--effect-ink-4",
  "--effect-ink-5",
  "--event-ambient",
]);

/** @type {ReadonlyArray<Readonly<EffectEntry>>} */
export const EFFECTS = Object.freeze([
  Object.freeze({
    name: "win_burst",
    kind: "celebration",
    ticket: "CC-328",
    flag: null,
    particles: 120,
    durationMs: 1200,
    budgetKB: 2,
    load: () => import("./scenes/winBurst.js"),
  }),
  Object.freeze({
    name: "achievement",
    kind: "celebration",
    ticket: "CC-328",
    flag: null,
    particles: 48,
    durationMs: 900,
    budgetKB: 2,
    load: () => import("./scenes/achievement.js"),
  }),
  Object.freeze({
    name: "level_up",
    kind: "celebration",
    ticket: "CC-328",
    flag: null,
    particles: 90,
    durationMs: 1200,
    budgetKB: 2,
    load: () => import("./scenes/levelUp.js"),
  }),
  Object.freeze({
    name: "diwali_2026",
    kind: "theme",
    ticket: "CC-328",
    flag: "event_diwali_2026",
    // Dhanteras (Friday 6 November) to Bhai Dooj (Wednesday 11 November); Lakshmi Puja is Sunday 8 November
    // (Drik Panchang, read 2026-10-21).
    window: Object.freeze({ from: "2026-11-06", to: "2026-11-11" }),
    removeBy: "2026-11-30",
    particles: 60,
    durationMs: 1200,
    budgetKB: 6,
    load: () => import("./themes/diwali2026.js"),
  }),
  Object.freeze({
    name: "winter_2026",
    kind: "theme",
    ticket: "CC-328",
    flag: "event_winter_2026",
    window: Object.freeze({ from: "2026-12-21", to: "2027-01-04" }),
    removeBy: "2027-01-15",
    particles: 40,
    durationMs: 1500,
    budgetKB: 6,
    load: () => import("./themes/winter2026.js"),
  }),
]);

/**
 * The registry entry of a name. An unknown name is a mistake in code, so it throws rather than playing nothing.
 *
 * @param {string} name
 * @returns {Readonly<EffectEntry>}
 * @throws {RangeError} for a name that is not in EFFECTS
 */
export function effectNamed(name) {
  const entry = EFFECTS.find((effect) => effect.name === name);
  if (entry === undefined) throw new RangeError(`Unknown effect "${name}"`);
  return entry;
}
