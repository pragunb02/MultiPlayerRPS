import { describe, expect, it } from "vitest";
import { activeTheme, canPlay, GATES, indiaDay, inWindow, isLowEnd, msToIndiaMidnight } from "./gates.js";
import { EFFECTS, effectNamed } from "./registry.js";

// The gates of ADR-075, in order (CC-328).
const WIN = effectNamed("win_burst");
const DIWALI = effectNamed("diwali_2026");
/** 8 November 2026, noon in India: Lakshmi Puja. */
const PUJA = Date.parse("2026-11-08T12:00:00+05:30");
const ALL_CLEAR = Object.freeze({
  now: PUJA,
  reducedMotion: false,
  flags: { event_diwali_2026: true },
  device: { lowEnd: false },
  hidden: false,
  inGame: false,
  busy: false,
});

describe("the effect gates (CC-328)", () => {
  it("the gates in order", () => {
    // Every gate shut: the first one in ADR-075's order answers.
    const shut = {
      entry: DIWALI,
      now: Date.parse("2026-11-12T00:30:00+05:30"),
      reducedMotion: true,
      flags: {},
      device: { lowEnd: true },
      hidden: true,
      inGame: true,
      busy: true,
    };
    const order = [
      ["reducedMotion", false, GATES.FLAG],
      ["flags", ALL_CLEAR.flags, GATES.WINDOW],
      ["now", PUJA, GATES.HIDDEN],
      ["hidden", false, GATES.IN_GAME],
      ["inGame", false, GATES.BUSY],
    ];
    const facts = { ...shut };
    expect(canPlay(facts)).toEqual({ ok: false, gate: GATES.REDUCED_MOTION });
    for (const [field, open, next] of order) {
      facts[field] = open;
      expect(canPlay(facts), `with ${field} open`).toEqual({ ok: false, gate: next });
    }
    facts.busy = false;
    // The device gate never refuses: it sets the tier, a third of the particles.
    expect(canPlay(facts)).toEqual({ ok: true, particles: 20 });
    expect(canPlay({ ...facts, device: { lowEnd: false } })).toEqual({ ok: true, particles: 60 });
  });

  it("lets a celebration through without a flag or a window, and gives the low-end tier a third", () => {
    expect(canPlay({ ...ALL_CLEAR, entry: WIN, flags: {} })).toEqual({ ok: true, particles: 120 });
    const thirds = EFFECTS.map(
      (entry) =>
        canPlay({
          ...ALL_CLEAR,
          entry: { ...entry, window: undefined, flag: null },
          device: { lowEnd: true },
        }).particles,
    );
    expect(thirds).toEqual([40, 16, 30, 20, 14]);
  });

  it("keeps a theme's burst out of a game, and lets a celebration from the result through", () => {
    expect(canPlay({ ...ALL_CLEAR, entry: DIWALI, inGame: true })).toEqual({
      ok: false,
      gate: GATES.IN_GAME,
    });
    expect(canPlay({ ...ALL_CLEAR, entry: WIN, inGame: true })).toEqual({ ok: true, particles: 120 });
  });

  it("tells a low-end device by save-data, memory or cores", () => {
    expect(isLowEnd({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(false);
    expect(isLowEnd({ hardwareConcurrency: 8 })).toBe(false);
    expect(isLowEnd({ hardwareConcurrency: 8, connection: { saveData: true } })).toBe(true);
    expect(isLowEnd({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(true);
    expect(isLowEnd({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe(true);
  });

  it("reads days in India time, both ends of a window included", () => {
    expect(indiaDay(Date.parse("2026-11-05T18:29:59Z"))).toBe("2026-11-05");
    expect(indiaDay(Date.parse("2026-11-05T18:30:00Z"))).toBe("2026-11-06");
    expect(msToIndiaMidnight(Date.parse("2026-11-05T18:29:00Z"))).toBe(60_000);
    expect(
      ["2026-11-05", "2026-11-06", "2026-11-11", "2026-11-12"].map((day) => inWindow(DIWALI, day)),
    ).toEqual([false, true, true, false]);
  });

  it("turns a theme on with its flag inside its window, and a preview ignores both", () => {
    const on = { event_diwali_2026: true, event_winter_2026: true };
    expect(activeTheme({ entries: EFFECTS, today: "2026-11-08", flags: on })?.name).toBe("diwali_2026");
    expect(activeTheme({ entries: EFFECTS, today: "2026-11-08", flags: {} })).toBeUndefined();
    expect(activeTheme({ entries: EFFECTS, today: "2026-11-12", flags: on })).toBeUndefined();
    expect(activeTheme({ entries: EFFECTS, today: "2026-12-25", flags: on })?.name).toBe("winter_2026");
    expect(
      activeTheme({ entries: EFFECTS, today: "2026-10-21", flags: {}, preview: "winter_2026" })?.name,
    ).toBe("winter_2026");
    expect(
      activeTheme({ entries: EFFECTS, today: "2026-11-08", flags: on, preview: "win_burst" })?.name,
    ).toBe("diwali_2026");
  });
});
