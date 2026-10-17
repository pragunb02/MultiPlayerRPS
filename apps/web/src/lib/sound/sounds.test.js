import { describe, expect, it } from "vitest";
import { RECIPES, SOUNDS } from "./sounds.js";

const LOUD_WAVES = new Set(["square", "sawtooth"]);

describe("sound catalogue (CC-103)", () => {
  it("has notes for every sound, and nothing that is not a sound", () => {
    expect(Object.keys(RECIPES).sort()).toEqual(Object.values(SOUNDS).sort());
    for (const notes of Object.values(RECIPES)) {
      expect(notes.length).toBeGreaterThan(0);
    }
  });

  it("covers the catalogue the games and rewards ask for", () => {
    expect(Object.values(SOUNDS)).toEqual(
      expect.arrayContaining([
        "move",
        "capture",
        "check",
        "castle",
        "game-start",
        "your-turn",
        "win",
        "loss",
        "draw",
        "low-time",
        "notify",
        "achievement",
        "level-up",
        "click",
      ]),
    );
  });

  it.each(Object.entries(RECIPES))("keeps %s short and soft", (_name, notes) => {
    for (const note of notes) {
      expect(note.gain).toBeGreaterThan(0);
      // Nothing near full scale, and the harsh waves stay far quieter still.
      expect(note.gain).toBeLessThanOrEqual(LOUD_WAVES.has(note.wave) ? 0.1 : 0.6);
      expect(note.freq).toBeGreaterThanOrEqual(100);
      expect(note.freq).toBeLessThanOrEqual(2000);
      expect(note.at + note.dur).toBeLessThanOrEqual(0.7);
      expect(note.dur).toBeGreaterThan(0.01);
    }
  });

  it("makes the sounds that happen all the time the quietest", () => {
    const peak = (name) => Math.max(...RECIPES[name].map((note) => note.gain));

    expect(peak(SOUNDS.CLICK)).toBeLessThan(peak(SOUNDS.MOVE));
    expect(peak(SOUNDS.LOW_TIME)).toBeLessThan(peak(SOUNDS.WIN));
  });
});
