import { describe, expect, it } from "vitest";
import { SOUNDS } from "../sound/sounds.js";
import { CATEGORIES, categoryOf, NOTIFICATION_CATEGORIES, SOUND_CATEGORIES } from "./categories.js";

describe("notification categories (CC-208)", () => {
  it("has the six kinds of notice, each with its own sound, place, priority and rate limit", () => {
    expect(NOTIFICATION_CATEGORIES.map(({ id }) => id)).toEqual(Object.values(CATEGORIES));
    const sounds = NOTIFICATION_CATEGORIES.map(({ sound }) => sound);
    expect(new Set(sounds).size).toBe(sounds.length);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(Object.values(SOUNDS)).toContain(category.sound);
      expect(category.label).not.toBe("");
      expect(["banner", "board", "result", "toast", "connection"]).toContain(category.place);
      expect(category.minGapMs).toBeGreaterThanOrEqual(0);
      expect(Object.isFrozen(category)).toBe(true);
    }
  });

  it("lets a request go ahead of rewards, and a lost connection ahead of everything", () => {
    const priority = (id) => categoryOf(id).priority;

    expect(priority(CATEGORIES.REQUEST)).toBeGreaterThan(priority(CATEGORIES.REWARD));
    expect(Math.max(...NOTIFICATION_CATEGORIES.map((category) => category.priority))).toBe(
      priority(CATEGORIES.SYSTEM),
    );
  });

  it("puts every sound but the button click in a category", () => {
    const uncategorised = Object.values(SOUNDS).filter((sound) => !Object.hasOwn(SOUND_CATEGORIES, sound));

    expect(uncategorised).toEqual([SOUNDS.CLICK]);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(SOUND_CATEGORIES[category.sound]).toBe(category.id);
    }
  });

  it("refuses a category that does not exist, because that is a mistake in the code", () => {
    expect(() => categoryOf("ads")).toThrow("Unknown notification category: ads");
  });
});
