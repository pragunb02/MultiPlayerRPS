import { PARTICLE_CAP } from "./registry.js";

/**
 * Our canvas particle module (ADR-075 point 3, CC-328): one canvas, one typed-array pool shared by every effect,
 * at most PARTICLE_CAP particles, the device pixel ratio clamped to 1.5 (ADR-075 allows 2; 1.5 holds 150 ms/s of
 * main thread on the throttled phone), the canvas resized at most once a frame, each frame one path and one fill per
 * ink with only the last frame's box cleared, and a stop that clears the canvas and removes every listener. It stops
 * by itself after its duration and when the tab is hidden. Loaded lazily with the first scene; never on the first
 * route (at most 1.5 kB gzip).
 */

/** The most device pixels per CSS pixel the canvas draws. */
const MAX_SCALE = 1.5;

/** The shapes a particle can have. */
export const SHAPES = Object.freeze({ RECT: 0, STAR: 1, DOT: 2, RAY: 3 });

// x, y, x speed, y speed, angle, spin, size: per particle, in CSS pixels, seconds and radians.
const FIELDS = 7;
const pool = new Float32Array(PARTICLE_CAP * FIELDS);
const looks = new Uint8Array(PARTICLE_CAP * 2);

const FALLBACK_INKS = [
  "--color-neon-gold",
  "--color-neon-accent",
  "--color-neon-xp",
  "--color-neon-tictactoe",
  "--color-neon-rps",
];

/**
 * The five particle colours, read once per play: `--effect-ink-1` to `-5` when a theme sets them, else the neon
 * inks of the token files. So a scene draws in a theme's colours without knowing the theme.
 *
 * @param {CSSStyleDeclaration} [style]
 * @returns {string[]}
 */
export const readInks = (style = getComputedStyle(document.documentElement)) =>
  FALLBACK_INKS.map(
    (fallback, at) =>
      style.getPropertyValue(`--effect-ink-${at + 1}`).trim() || style.getPropertyValue(fallback).trim(),
  );

/**
 * The middle of where an effect starts: a point, the centre of a box, or the middle of the screen.
 *
 * @param {{ x: number, y: number, width?: number, height?: number }} [origin]
 * @returns {[number, number]}
 */
export const centreOf = (origin) =>
  origin
    ? [origin.x + (origin.width ?? 0) / 2, origin.y + (origin.height ?? 0) / 2]
    : [innerWidth / 2, innerHeight / 2];

/** A random number from `low` to `high`. */
export const between = (low, high) => low + Math.random() * (high - low);

/**
 * Plays particles on a canvas for `durationMs`, then clears it.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   count: number,
 *   durationMs: number,
 *   inks: string[],
 *   spawn: (index: number, count: number) => [number, number, number, number, number, number, number, number, number],
 *   gravity?: number,
 *   drag?: number,
 * }} effect  `spawn` gives a particle's x, y, x speed, y speed, angle, spin, size, ink and shape; `gravity` is in
 *   pixels per second squared (negative rises), `drag` the share of speed lost per second
 * @returns {{ done: Promise<void>, stop: () => void }}
 */
export function run(canvas, { count, durationMs, inks, spawn, gravity = 0, drag = 0 }) {
  const total = Math.min(count, PARTICLE_CAP);
  const context = canvas.getContext("2d");
  let frame = 0;
  let started = -1;
  let last = 0;
  let scale = 1;
  let sized = false;
  let stopped = false;
  // The box the last frame drew in, in CSS pixels: left, top, right, bottom. Nothing yet.
  const drawn = [0, 0, 0, 0];
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  // A browser that cannot draw on a canvas just shows no effect.
  if (context === null) {
    finish();
    return { done, stop() {} };
  }

  for (let index = 0; index < total; index += 1) {
    const particle = spawn(index, total);
    pool.set(particle.slice(0, FIELDS), index * FIELDS);
    looks[index * 2] = particle[7] % inks.length;
    looks[index * 2 + 1] = particle[8];
  }

  const resize = () => {
    sized = false;
  };
  const hide = () => document.hidden && stop();

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", hide);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    finish();
  }

  function draw(now) {
    if (started < 0) started = last = now;
    if (!sized) {
      scale = Math.min(MAX_SCALE, devicePixelRatio || 1);
      canvas.width = Math.round(innerWidth * scale);
      canvas.height = Math.round(innerHeight * scale);
      sized = true;
    }
    const age = now - started;
    const step = Math.min(now - last, 50) / 1000;
    last = now;
    // One transform a frame: everything below is in CSS pixels. Only the box the last frame drew in is cleared.
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(drawn[0], drawn[1], drawn[2] - drawn[0], drawn[3] - drawn[1]);
    if (age >= durationMs) return stop();
    // Every particle fades out over the last 40 %, never flashing (WCAG 2.3.1).
    context.globalAlpha = Math.min(1, (durationMs - age) / (durationMs * 0.4));
    const slow = Math.max(0, 1 - drag * step);
    drawn[0] = drawn[1] = Infinity;
    drawn[2] = drawn[3] = -Infinity;
    for (let at = 0; at < total * FIELDS; at += FIELDS) {
      pool[at + 2] *= slow;
      pool[at + 3] = pool[at + 3] * slow + gravity * step;
      pool[at] += pool[at + 2] * step;
      pool[at + 1] += pool[at + 3] * step;
      pool[at + 4] += pool[at + 5] * step;
      // A ray reaches twice its size from its middle; anything else less.
      const reach = pool[at + 6] * 2 + 2;
      drawn[0] = Math.min(drawn[0], pool[at] - reach);
      drawn[1] = Math.min(drawn[1], pool[at + 1] - reach);
      drawn[2] = Math.max(drawn[2], pool[at] + reach);
      drawn[3] = Math.max(drawn[3], pool[at + 1] + reach);
    }
    // One path and one fill per ink: the canvas's cost is in its calls, not in the corners of a path.
    for (let ink = 0; ink < inks.length; ink += 1) {
      context.beginPath();
      for (let index = 0; index < total; index += 1) {
        if (looks[index * 2] !== ink) continue;
        const at = index * FIELDS;
        const size = pool[at + 6];
        const shape = looks[index * 2 + 1];
        const angle = shape === SHAPES.RAY ? Math.atan2(pool[at + 3], pool[at + 2]) : pool[at + 4];
        if (shape === SHAPES.RAY) {
          quad(pool[at], pool[at + 1], angle, size * 2, size / 6);
        } else if (shape === SHAPES.DOT) {
          // A small diamond: a mote of light, four corners instead of a curve.
          quad(pool[at], pool[at + 1], 0.7854, size / 2, size / 2);
        } else {
          quad(pool[at], pool[at + 1], angle, size / 2, size / 4);
          if (shape === SHAPES.STAR) quad(pool[at], pool[at + 1], angle, size / 4, size / 2);
        }
      }
      context.fillStyle = inks[ink];
      context.fill();
    }
    frame = requestAnimationFrame(draw);
  }

  /** Adds a rectangle turned by `angle` around (x, y), `half` wide and `side` high from its middle, to the path. */
  function quad(x, y, angle, half, side) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ax = cos * half;
    const ay = sin * half;
    const bx = -sin * side;
    const by = cos * side;
    context.moveTo(x + ax + bx, y + ay + by);
    context.lineTo(x - ax + bx, y - ay + by);
    context.lineTo(x - ax - bx, y - ay - by);
    context.lineTo(x + ax - bx, y + ay - by);
    context.closePath();
  }

  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", hide);
  frame = requestAnimationFrame(draw);
  return { done, stop };
}
