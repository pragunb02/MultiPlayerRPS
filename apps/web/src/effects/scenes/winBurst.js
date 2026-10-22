import { between, readInks, run, SHAPES } from "../particles.js";

/**
 * A big win (CC-328, M-328-1): two cones of confetti rectangles and stars from the result's top corners, or from
 * the sides of the screen, falling with gravity and spinning. No sound: the result's own sound plays.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ origin?: { x: number, y: number, width?: number }, particles: number, durationMs: number }} play
 */
export function start(canvas, { origin, particles, durationMs }) {
  const corners = origin
    ? [
        [origin.x, origin.y],
        [origin.x + (origin.width ?? 0), origin.y],
      ]
    : [
        [0, innerHeight * 0.4],
        [innerWidth, innerHeight * 0.4],
      ];
  return run(canvas, {
    count: particles,
    durationMs,
    inks: readInks(),
    gravity: 1100,
    drag: 1.2,
    spawn: (index) => {
      const side = index % 2;
      // Up and inwards from each corner: -60° on the left, -120° on the right, 50° wide.
      const angle = (side ? -2.09 : -1.05) + between(-0.45, 0.45);
      const speed = between(450, 1000);
      return [
        ...corners[side],
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        between(0, 6.28),
        between(-12, 12),
        between(7, 13),
        index,
        index % 4 === 0 ? SHAPES.STAR : SHAPES.RECT,
      ];
    },
  });
}
