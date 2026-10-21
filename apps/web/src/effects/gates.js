import { LOW_END_SHARE } from "./registry.js";

/**
 * The gates every effect passes, in ADR-075's order, as pure functions: the host gives them the facts and does
 * what they answer. Kept apart from the host so each gate is tested on its own (`gates.test.js`).
 */

const INDIA_OFFSET_MS = 330 * 60 * 1000;

/**
 * The India day of a moment, YYYY-MM-DD: the day a theme's window and removeBy are written in.
 *
 * @param {number} ms
 */
export const indiaDay = (ms) => new Date(ms + INDIA_OFFSET_MS).toISOString().slice(0, 10);

/** The milliseconds from a moment to the next India midnight, when a theme's window may open or close. */
export const msToIndiaMidnight = (ms) => 86_400_000 - ((ms + INDIA_OFFSET_MS) % 86_400_000);

/** Whether an India day is inside a theme's window, both ends included. */
export const inWindow = (entry, day) => entry.window.from <= day && day <= entry.window.to;

/**
 * Whether a device gets the low-end tier: save-data, at most 2 GB of memory or at most 4 cores.
 *
 * @param {{ connection?: { saveData?: boolean }, deviceMemory?: number, hardwareConcurrency?: number }} navigator
 */
export const isLowEnd = (navigator) =>
  navigator.connection?.saveData === true ||
  navigator.deviceMemory <= 2 ||
  navigator.hardwareConcurrency <= 4;

/** What each gate is called when it says no. */
export const GATES = Object.freeze({
  REDUCED_MOTION: "reduced-motion",
  FLAG: "flag",
  WINDOW: "window",
  HIDDEN: "hidden",
  IN_GAME: "in-game",
  BUSY: "busy",
});

/**
 * Whether an effect may start now, gate by gate in ADR-075's order: reduced motion, the flag, the window, the
 * device (which only sets the tier), a hidden tab, a game being played (themes only), and one effect at a time. The first gate
 * that says no is named, so the host can queue a celebration that only waits for another one.
 *
 * @param {{
 *   entry: Readonly<import("./registry.js").EffectEntry>,
 *   now: number,
 *   reducedMotion: boolean,
 *   flags: Readonly<Record<string, boolean>>,
 *   device: { lowEnd: boolean },
 *   hidden: boolean,
 *   inGame?: boolean,
 *   busy: boolean,
 * }} facts
 * @returns {{ ok: true, particles: number } | { ok: false, gate: string }}
 */
export function canPlay({ entry, now, reducedMotion, flags, device, hidden, inGame = false, busy }) {
  if (reducedMotion) return { ok: false, gate: GATES.REDUCED_MOTION };
  if (entry.flag && flags[entry.flag] !== true) return { ok: false, gate: GATES.FLAG };
  if (entry.window && !inWindow(entry, indiaDay(now))) return { ok: false, gate: GATES.WINDOW };
  const particles = device.lowEnd ? Math.ceil(entry.particles * LOW_END_SHARE) : entry.particles;
  if (hidden) return { ok: false, gate: GATES.HIDDEN };
  // A theme's burst never plays during a game. A celebration is called from the result, as the game ends, so the
  // host may not have heard yet that the game is over: it is not held back by this gate.
  if (inGame && entry.kind === "theme") return { ok: false, gate: GATES.IN_GAME };
  if (busy) return { ok: false, gate: GATES.BUSY };
  return { ok: true, particles };
}

/**
 * The theme on today, or undefined: one the owner previews in this tab (it ignores the flag and the window), else
 * the first whose flag is on and whose window holds today. Reduced motion does not matter here: a theme keeps its
 * colours and greeting, and only its burst waits for `canPlay`.
 *
 * @param {{
 *   entries: ReadonlyArray<Readonly<import("./registry.js").EffectEntry>>,
 *   today: string,
 *   flags: Readonly<Record<string, boolean>>,
 *   preview?: string,
 * }} facts
 */
export function activeTheme({ entries, today, flags, preview }) {
  const themes = entries.filter((entry) => entry.kind === "theme");
  return (
    themes.find((entry) => entry.name === preview) ??
    themes.find((entry) => flags[entry.flag] === true && inWindow(entry, today))
  );
}
