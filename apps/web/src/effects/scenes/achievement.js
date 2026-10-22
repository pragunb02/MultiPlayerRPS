import { between, centreOf, readInks, run, SHAPES } from "../particles.js";

/**
 * An achievement (CC-328, M-328-2): a ring of small stars from the badge, moving out and fading, with no gravity.
 * No sound: the reward beat has its own chime.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ origin?: { x: number, y: number, width?: number, height?: number }, particles: number, durationMs: number }} play
 */
export function start(canvas, { origin, particles, durationMs }) {
  const [x, y] = centreOf(origin);
  return run(canvas, {
    count: particles,
    durationMs,
    inks: readInks(),
    drag: 2.4,
    spawn: (index, count) => {
      const angle = (index / count) * 6.2832 + between(-0.08, 0.08);
      const speed = between(240, 330);
      return [
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        angle,
        between(-4, 4),
        between(6, 10),
        index,
        SHAPES.STAR,
      ];
    },
  });
}
