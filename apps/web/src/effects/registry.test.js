import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FLAGS } from "@classicade/shared";
import {
  DEFAULT_PARTICLES,
  EFFECTS,
  effectNamed,
  LOW_END_SHARE,
  MAX_EFFECT_MS,
  PARTICLE_CAP,
  THEMEABLE_TOKENS,
} from "./registry.js";

// The effect registry (CC-328, ADR-075): data and loaders, with the rules a seasonal theme cannot slip past.
const SOURCE = readFileSync(path.join(import.meta.dirname, "registry.js"), "utf8");
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Today as the India day the tests run on, so the removal check bites on the real calendar. */
const today = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
const flagOf = (name) => FLAGS.find((flag) => flag.name === name);

describe("the effect registry (CC-328)", () => {
  it("every entry keeps the ADR-075 rules", async () => {
    const names = EFFECTS.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of EFFECTS) {
      expect(Object.isFrozen(entry), entry.name).toBe(true);
      expect(entry.name, entry.name).toMatch(SNAKE);
      expect(["celebration", "theme"], entry.name).toContain(entry.kind);
      expect(entry.ticket, entry.name).toMatch(/^CC-\d{3,}$/);
      expect(entry.particles, entry.name).toBeGreaterThan(0);
      expect(entry.particles, entry.name).toBeLessThanOrEqual(PARTICLE_CAP);
      expect(entry.durationMs, entry.name).toBeGreaterThan(0);
      expect(entry.durationMs, entry.name).toBeLessThanOrEqual(MAX_EFFECT_MS);
      expect(entry.budgetKB, entry.name).toBeLessThanOrEqual(entry.kind === "theme" ? 6 : 2);
      expect(typeof (await entry.load()).start, entry.name).toBe("function");
    }

    // The bundle check reads each budget from the loader's own text (scripts/build/bundleBudget.mjs), so every
    // loader is written as `load: () => import("./scenes/name.js")`, one per entry.
    const loaders = [...SOURCE.matchAll(/load: \(\) => import\("\.\/(scenes|themes)\/[\w-]+\.js"\)/g)];
    expect(loaders).toHaveLength(EFFECTS.length);

    for (const entry of EFFECTS.filter(({ kind }) => kind === "celebration")) {
      expect(entry.flag, `${entry.name}: a celebration replaces an effect players already get`).toBeNull();
    }
    for (const theme of EFFECTS.filter(({ kind }) => kind === "theme")) {
      const flag = flagOf(theme.flag);
      expect(flag, `${theme.name}: its flag is registered in flags.js`).toBeDefined();
      expect(flag.client, `${theme.name}: the web app reads its flag`).toBe(true);
      expect(theme.window.from, theme.name).toMatch(DAY);
      expect(theme.window.to, theme.name).toMatch(DAY);
      expect(theme.window.from <= theme.window.to, theme.name).toBe(true);
      expect(theme.removeBy, theme.name).toMatch(DAY);
      expect(theme.window.to < theme.removeBy, `${theme.name}: removed after its window`).toBe(true);
      expect(theme.removeBy <= flag.removeBy, `${theme.name}: removed no later than its flag`).toBe(true);
      expect(theme.removeBy >= today(), `${theme.name} is past its removeBy: delete it with its files`).toBe(
        true,
      );
      // Its one greeting, in its module: Hinglish and English within CC-332's caps.
      const { greeting } = await theme.load();
      expect(greeting.hi.length, theme.name).toBeLessThanOrEqual(80);
      expect(greeting.en.length, theme.name).toBeLessThanOrEqual(100);
    }
  });

  it("holds the ticket's numbers", () => {
    expect([PARTICLE_CAP, DEFAULT_PARTICLES, MAX_EFFECT_MS, LOW_END_SHARE]).toEqual([300, 150, 1500, 1 / 3]);
    expect(
      Object.fromEntries(EFFECTS.map(({ name, particles, durationMs }) => [name, [particles, durationMs]])),
    ).toEqual({
      win_burst: [120, 1200],
      achievement: [48, 900],
      level_up: [90, 1200],
      diwali_2026: [60, 1200],
      winter_2026: [40, 1500],
    });
    const diwali = effectNamed("diwali_2026");
    expect([diwali.flag, diwali.window, diwali.removeBy]).toEqual([
      "event_diwali_2026",
      { from: "2026-11-06", to: "2026-11-11" },
      "2026-11-30",
    ]);
    expect(flagOf("event_diwali_2026")).toMatchObject({
      audience: "everyone",
      rollout: "off",
      default: false,
    });
    expect(flagOf("event_winter_2026")).toMatchObject({ rollout: "off", removeBy: "2027-01-15" });
    expect(THEMEABLE_TOKENS).toContain("--event-ambient");
  });

  it("finds an entry by name and throws on an unknown one", () => {
    expect(effectNamed("win_burst").kind).toBe("celebration");
    expect(() => effectNamed("fireworks")).toThrow(RangeError);
  });
});
