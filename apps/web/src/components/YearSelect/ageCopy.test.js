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

  // "tum", never "aap": the one shared test in src/copy.hinglish.test.js reads these lines (CC-351).

  it("refuses an under 13 year in the server's own English words", () => {
    expect(AGE_COPY.tooYoung.en).toBe(TOO_YOUNG_MESSAGE);
  });

  it("never names the age that would change a default", () => {
    for (const { hi, en } of [AGE_COPY.hint, AGE_COPY.setOnce, AGE_COPY.hiddenOnBoards]) {
      expect(`${hi} ${en}`).not.toMatch(/\b1[3-9]\b|adult|bade/i);
    }
  });
});
