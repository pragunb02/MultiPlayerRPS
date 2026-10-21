import { between, readInks, run, SHAPES } from "../particles.js";
import tokens from "./diwali2026.module.css";

/** The theme's CSS module: only `:root[data-event-theme]` token overrides, no classes. Exported so the build keeps it. */
export { tokens };

/**
 * The one line on the home hero, above the headline: the same for every player, no ask, no countdown (CC-328 D4).
 * Hinglish first, English second (CC-332).
 */
export const greeting = Object.freeze({
  hi: "Diwali ki shubhkamnayein! Roshni aur khushiyan tumhare saath.",
  en: "Happy Diwali from all of us at ClassiCade.",
});

/**
 * The Diwali 2026 theme (CC-328, M-328-4). Its CSS holds the decoration tokens under `data-event-theme`; this is
 * its one entrance burst, once per visit on the home page: warm gold sparks rising gently from the band of diyas
 * at the top of the page and fading. No gravity, no flashing (WCAG 2.3.1).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ particles: number, durationMs: number }} play
 */
export function start(canvas, { particles, durationMs }) {
  const band = document.querySelector("main")?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: innerWidth,
  };
  return run(canvas, {
    count: particles,
    durationMs,
    inks: readInks(),
    gravity: -12,
    spawn: (index) => [
      band.left + between(0, band.width),
      band.top + between(8, 24),
      between(-12, 12),
      between(-55, -20),
      0,
      0,
      between(2.5, 4.5),
      index,
      SHAPES.DOT,
    ],
  });
}
