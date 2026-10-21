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
const drawn = (calls) => calls.filter(([name]) => name === "fillRect" || name === "arc").length;

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
    // The device pixel ratio is clamped to 2: a DPR 3 phone draws at 2.
    expect([canvas.width, canvas.height]).toEqual([innerWidth * 2, innerHeight * 2]);
    expect(drawn(canvas.calls)).toBeGreaterThanOrEqual(PARTICLE_CAP);

    stop();
    await done;
    const after = canvas.calls.length;
    expect(canvas.calls.at(-1)).toEqual(["clearRect", 0, 0, innerWidth * 2, innerHeight * 2]);
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

    expect(second.calls.filter(([name]) => name === "setTransform").at(-1)).toEqual([
      "setTransform",
      2,
      0,
      -0,
      2,
      2,
      4,
    ]);
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
