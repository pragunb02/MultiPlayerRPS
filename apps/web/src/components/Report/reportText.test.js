import { describe, expect, it } from "vitest";
import { REPORT_REASONS } from "@classicade/shared";
import { REPORT_REASON_LABELS, reportText } from "./reportText.js";

describe("report dialog words (CC-044, ADR-071)", () => {
  it("names every reason in Hinglish and English", () => {
    expect(Object.keys(REPORT_REASON_LABELS)).toEqual([...REPORT_REASONS]);
    for (const label of Object.values(REPORT_REASON_LABELS)) {
      expect(label.hinglish).not.toBe("");
      expect(label.english).not.toBe("");
    }
  });

  // "tum", never "aap": the one shared test in src/copy.hinglish.test.js reads these lines (CC-351).

  it("puts the player's name in the title and the block button, and promises nothing about what happens", () => {
    const text = reportText("Bob");

    expect(text.title.english).toBe("Report Bob");
    expect(text.blockToo).toBe("Block Bob too");
    expect(`${text.sentBody.english} ${text.sentBody.hinglish}`).not.toMatch(/ban|suspend|remove|delete/i);
    expect(text.help.english).toMatch(/1098/);
    expect(text.help.english).toMatch(/1930/);
  });
});
