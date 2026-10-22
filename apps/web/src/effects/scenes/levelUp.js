import { between, centreOf, readInks, run, SHAPES } from "../particles.js";

const RAYS = 12;

/**
 * A level up (CC-328, M-328-3): twelve rays out from the level badge, and sparks rising from it, then falling.
 * No sound: the reward beat has its own.
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
    gravity: 900,
    drag: 1.4,
    spawn: (index) => {
      const ray = index < RAYS;
      const angle = ray ? (index / RAYS) * 6.2832 : -1.5708 + between(-0.7, 0.7);
      const speed = ray ? 520 : between(380, 820);
      const shape = index % 3 === 0 ? SHAPES.STAR : SHAPES.DOT;
      return [
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0,
        between(-6, 6),
        ray ? 9 : between(3, 6),
        index,
        ray ? SHAPES.RAY : shape,
      ];
    },
  });
}
