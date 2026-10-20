import { describe, expect, it } from "vitest";
import { TOO_YOUNG_MESSAGE } from "@classicade/shared";
import { AGE_COPY } from "./ageCopy.js";

describe("AGE_COPY (CC-152)", () => {
  const lines = Object.values(AGE_COPY);

  it("has a Hinglish line and an English line for every part", () => {
    for (const { hi, en } of lines) {
      expect(hi.trim()).not.toBe("");
      expect(en.trim()).not.toBe("");
      expect(hi).not.toBe(en);
    }
  });

  it('speaks to the player with "tum", never "aap" (owner, 2026-10-20)', () => {
    expect(lines.filter(({ hi }) => /\baap(ka|ke|ki|ko|ne)?\b/i.test(hi))).toEqual([]);
    expect(lines.some(({ hi }) => /\btum(hara|hare|hari|he)?\b/i.test(hi))).toBe(true);
  });

  it("refuses an under 13 year in the server's own English words", () => {
    expect(AGE_COPY.tooYoung.en).toBe(TOO_YOUNG_MESSAGE);
  });

  it("never names the age that would change a default", () => {
    for (const { hi, en } of [AGE_COPY.hint, AGE_COPY.setOnce, AGE_COPY.hiddenOnBoards]) {
      expect(`${hi} ${en}`).not.toMatch(/\b1[3-9]\b|adult|bade/i);
    }
  });
});
