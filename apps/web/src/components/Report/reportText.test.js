import { describe, expect, it } from "vitest";
import { REPORT_REASONS } from "@classicade/shared";
import { REPORT_REASON_LABELS, reportText } from "./reportText.js";

// The no-aap test the other Hinglish lines use (CC-217, CC-290).
const AAP = /\b(aap|aapka|aapke|aapki|aapko|aapne)\b|(ein|iye|ijiye)\?/i;

const linesOf = (text) => Object.values(text).flatMap((value) => (typeof value === "object" ? [value] : []));

describe("report dialog words (CC-044, ADR-071)", () => {
  it("names every reason in Hinglish and English", () => {
    expect(Object.keys(REPORT_REASON_LABELS)).toEqual([...REPORT_REASONS]);
    for (const label of Object.values(REPORT_REASON_LABELS)) {
      expect(label.hinglish).not.toBe("");
      expect(label.english).not.toBe("");
    }
  });

  it('speaks to the player with "tum", never "aap" (owner, 2026-10-20)', () => {
    const lines = [...linesOf(reportText("Bob")), ...Object.values(REPORT_REASON_LABELS)];

    for (const line of lines) {
      expect(line.hinglish).not.toMatch(AAP);
    }
    expect(lines.some((line) => /\b(tum|tumhe|tumhara|tumne)\b/i.test(line.hinglish))).toBe(true);
  });

  it("puts the player's name in the title and the block button, and promises nothing about what happens", () => {
    const text = reportText("Bob");

    expect(text.title.english).toBe("Report Bob");
    expect(text.blockToo).toBe("Block Bob too");
    expect(`${text.sentBody.english} ${text.sentBody.hinglish}`).not.toMatch(/ban|suspend|remove|delete/i);
    expect(text.help.english).toMatch(/1098/);
    expect(text.help.english).toMatch(/1930/);
  });
});
