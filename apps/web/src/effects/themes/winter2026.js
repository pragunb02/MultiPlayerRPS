import { between, readInks, run, SHAPES } from "../particles.js";
import tokens from "./winter2026.module.css";

/** The theme's CSS module: only `:root[data-event-theme]` token overrides, no classes. Exported so the build keeps it. */
export { tokens };

/** The one line on the home hero, above the headline: Hinglish first, English second (CC-332). */
export const greeting = Object.freeze({
  hi: "Sardi ki raatein, garma garam games.",
  en: "Winter nights, warm games.",
});

/**
 * The winter nights theme (CC-328, M-328-5), ready and off. Its CSS holds the decoration tokens under
 * `data-event-theme`; this is its one entrance burst, once per visit on the home page: snow motes drifting down
 * from the frost band at the top of the page.
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
    gravity: 10,
    spawn: (index) => [
      band.left + between(0, band.width),
      band.top + between(0, 24),
      between(-20, 20),
      between(30, 70),
      0,
      0,
      between(2.5, 5),
      index,
      SHAPES.DOT,
    ],
  });
}
