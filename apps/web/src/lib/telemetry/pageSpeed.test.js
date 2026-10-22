import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measurePageSpeed, PAGE_SPEED_AFTER_MS } from "./pageSpeed.js";

/** A PerformanceObserver that a test feeds by hand: `observers.get(type)(entries)`. */
function fakeObserver(supported) {
  const observers = new Map();
  class Observer {
    static supportedEntryTypes = supported;
    constructor(callback) {
      this.callback = callback;
    }
    observe({ type }) {
      observers.set(type, (entries) => this.callback({ getEntries: () => entries }));
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  return { Observer, observers };
}

const performanceWith = (navigation) => ({ getEntriesByType: () => (navigation ? [navigation] : []) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function measure({
  supported = ["paint", "largest-contentful-paint", "event", "layout-shift"],
  navigation,
} = {}) {
  const tracked = [];
  const { Observer, observers } = fakeObserver(supported);
  const speed = measurePageSpeed({
    performance: performanceWith(navigation),
    PerformanceObserver: Observer,
    wasWaking: true,
    track: (name, fields) => tracked.push([name, fields]),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer),
  });
  return { speed, tracked, observers };
}

describe("page speed (CC-174, EVENTS.md 3.1)", () => {
  it("sends the browser's own timings once, rounded, after 30 seconds", () => {
    const { tracked, observers } = measure({ navigation: { responseStart: 123.4 } });
    observers.get("paint")([
      { name: "first-paint", startTime: 100 },
      { name: "first-contentful-paint", startTime: 456.7 },
    ]);
    observers.get("largest-contentful-paint")([{ startTime: 900 }, { startTime: 1234.5 }]);
    observers.get("event")([
      { interactionId: 1, duration: 88 },
      { interactionId: 0, duration: 999 },
      { interactionId: 2, duration: 160 },
    ]);
    observers.get("layout-shift")([
      { value: 0.031, hadRecentInput: false },
      { value: 0.5, hadRecentInput: true },
      { value: 0.02 },
    ]);

    vi.advanceTimersByTime(PAGE_SPEED_AFTER_MS);
    vi.advanceTimersByTime(PAGE_SPEED_AFTER_MS);

    expect(tracked).toEqual([
      [
        "page_speed_measured",
        { ttfb_ms: 120, fcp_ms: 460, lcp_ms: 1230, inp_ms: 160, cls: 0.05, was_waking: true },
      ],
    ]);
  });

  it("sends earlier when the page is hidden, and leaves out what the browser does not measure", () => {
    const { speed, tracked, observers } = measure({ supported: ["paint"] });
    observers.get("paint")([{ name: "first-paint", startTime: 10 }]);

    speed.send();
    speed.send();
    vi.advanceTimersByTime(PAGE_SPEED_AFTER_MS);

    expect(tracked).toEqual([["page_speed_measured", { cls: 0, was_waking: true }]]);
  });

  it("measures nothing without PerformanceObserver, and sends nothing once stopped", () => {
    const tracked = [];
    const speed = measurePageSpeed({
      performance: performanceWith(undefined),
      PerformanceObserver: undefined,
      wasWaking: false,
      track: (name, fields) => tracked.push([name, fields]),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer),
    });
    speed.stop();
    vi.advanceTimersByTime(PAGE_SPEED_AFTER_MS);
    speed.send();

    expect(tracked).toEqual([]);
  });

  it("keeps the last largest paint when a later report has none", () => {
    const { speed, tracked, observers } = measure();
    observers.get("largest-contentful-paint")([{ startTime: 500 }]);
    observers.get("largest-contentful-paint")([]);

    speed.send();

    expect(tracked[0][1].lcp_ms).toBe(500);
  });

  it("stops its observers when stopped", () => {
    const { speed, tracked } = measure();

    speed.stop();
    vi.advanceTimersByTime(PAGE_SPEED_AFTER_MS);

    expect(tracked).toEqual([]);
  });
});
