import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installVisibility } from "../testing/visibility.js";
import { readInks, run, SHAPES } from "./particles.js";
import { PARTICLE_CAP } from "./registry.js";

// Our canvas particle module (CC-328, ADR-075 point 3), drawn on a fake 2D context that records what it is asked.
function fakeCanvas() {
  const calls = [];
  const context = new Proxy(
    { calls },
    {
      get: (target, key) =>
        key === "calls"
          ? calls
          : (...args) => calls.push([key, ...args.map((arg) => Math.round(arg) || arg)]),
      set: (_, key, value) => {
        calls.push([key, value]);
        return true;
      },
    },
  );
  return { width: 0, height: 0, getContext: () => context, calls };
}

const particle = (index) => [10, 20, 100, 0, 0, 0, 8, index, index % 4];
const drawn = (calls) => calls.filter(([name]) => ["fillRect", "arc", "moveTo"].includes(name)).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  window.devicePixelRatio = 3;
});

afterEach(() => {
  vi.useRealTimers();
  window.devicePixelRatio = 1;
});

describe("the particle module (CC-328)", () => {
  it("pool, cap and stop", async () => {
    const canvas = fakeCanvas();
    const spawn = vi.fn(particle);
    const removed = vi.spyOn(window, "removeEventListener");
    const removedFromDocument = vi.spyOn(document, "removeEventListener");

    const { done, stop } = run(canvas, { count: 999, durationMs: 1200, inks: ["#fff"], spawn });

    // The cap: never more than PARTICLE_CAP, whatever an effect asks for.
    expect(spawn).toHaveBeenCalledTimes(PARTICLE_CAP);
    vi.advanceTimersByTime(17);
    // The device pixel ratio is clamped to 1.5 (ADR-075 allows up to 2; 1.5 holds the frame budget): a DPR 3 phone
    // draws at 1.5.
    expect([canvas.width, canvas.height]).toEqual([
      Math.round(innerWidth * 1.5),
      Math.round(innerHeight * 1.5),
    ]);
    expect(drawn(canvas.calls)).toBeGreaterThanOrEqual(PARTICLE_CAP);

    stop();
    await done;
    const after = canvas.calls.length;
    expect(canvas.calls.at(-1)).toEqual([
      "clearRect",
      0,
      0,
      Math.round(innerWidth * 1.5),
      Math.round(innerHeight * 1.5),
    ]);
    vi.advanceTimersByTime(500);
    expect(canvas.calls.length, "no frame after stop").toBe(after);
    expect(removed).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removedFromDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    stop();
    expect(canvas.calls.length, "stopping twice does nothing more").toBe(after);
  });

  it("reuses one pool: a second play starts from its own particles", () => {
    const first = fakeCanvas();
    run(first, {
      count: 2,
      durationMs: 100,
      inks: ["#fff"],
      spawn: () => [500, 500, 0, 0, 0, 0, 8, 0, 0],
    }).stop();
    const second = fakeCanvas();
    run(second, { count: 2, durationMs: 100, inks: ["#fff"], spawn: () => [1, 2, 0, 0, 0, 0, 8, 0, 0] });
    vi.advanceTimersByTime(17);

    const points = second.calls.filter(([name]) => name === "moveTo" || name === "lineTo");
    expect(points.length).toBeGreaterThan(0);
    // Every corner is within a particle's size of (1, 2), none near the first play's (500, 500).
    expect(points.every(([, x, y]) => Math.abs(x - 1) <= 8 && Math.abs(y - 2) <= 8)).toBe(true);
  });

  it("draws each frame as one path and one fill per ink, never one call per particle", () => {
    const canvas = fakeCanvas();
    const inks = ["#1", "#2", "#3", "#4", "#5"];
    run(canvas, { count: PARTICLE_CAP, durationMs: 1200, inks, spawn: particle });
    vi.advanceTimersByTime(17);
    const frame = canvas.calls.slice(canvas.calls.findLastIndex(([name]) => name === "clearRect"));

    expect(frame.filter(([name]) => name === "fill")).toHaveLength(inks.length);
    expect(frame.filter(([name]) => name === "fillStyle")).toHaveLength(inks.length);
    expect(frame.filter(([name]) => ["fillRect", "arc", "setTransform"].includes(name))).toEqual([]);
    expect(frame.filter(([name]) => name === "moveTo").length).toBeGreaterThanOrEqual(PARTICLE_CAP);
  });

  it("ends by itself after its duration and clears the canvas", async () => {
    const canvas = fakeCanvas();
    const ended = vi.fn();
    run(canvas, { count: 10, durationMs: 300, inks: ["#fff"], spawn: particle }).done.then(ended);

    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(ended).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(ended).toHaveBeenCalled();
    expect(canvas.calls.at(-1)[0]).toBe("clearRect");
  });

  it("stops when the tab is hidden", async () => {
    const visibility = installVisibility();
    const canvas = fakeCanvas();
    const { done } = run(canvas, { count: 10, durationMs: 1200, inks: ["#fff"], spawn: particle });
    vi.advanceTimersByTime(17);

    visibility.setHidden(true);
    await done;
    const after = canvas.calls.length;
    vi.advanceTimersByTime(100);
    expect(canvas.calls.length).toBe(after);
  });

  it("fades out without flashing: the opacity only ever goes down", () => {
    const canvas = fakeCanvas();
    run(canvas, { count: 1, durationMs: 1000, inks: ["#fff"], spawn: particle });
    vi.advanceTimersByTime(1100);

    const alphas = canvas.calls.filter(([name]) => name === "globalAlpha").map(([, value]) => value);
    expect(alphas.length).toBeGreaterThan(10);
    expect(alphas).toEqual([...alphas].sort((a, b) => b - a));
  });

  it("draws nothing where a canvas cannot draw", async () => {
    const { done } = run(
      { getContext: () => null },
      { count: 5, durationMs: 100, inks: [], spawn: particle },
    );
    await expect(done).resolves.toBeUndefined();
  });

  it("reads a theme's inks, else the neon inks", () => {
    const style = {
      getPropertyValue: (name) =>
        ({ "--effect-ink-2": " #ff9e1b", "--color-neon-gold": "#ffd34d" })[name] ?? "",
    };
    expect(readInks(style).slice(0, 2)).toEqual(["#ffd34d", "#ff9e1b"]);
    expect(Object.values(SHAPES)).toEqual([0, 1, 2, 3]);
  });
});
