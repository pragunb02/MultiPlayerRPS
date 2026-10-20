import { describe, expect, it } from "vitest";
import { FEEDBACK_STATUSES, FEEDBACK_TYPES } from "@classicade/shared";
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TEXT, FEEDBACK_TYPE_LABELS } from "./feedbackText.js";

/** Every Hinglish line of the dialog. */
const hinglishLines = Object.values(FEEDBACK_TEXT)
  .filter((line) => typeof line === "object")
  .map((line) => line.hinglish);

describe("the Feedback dialog's words (CC-290)", () => {
  it("speaks to the player as tum, never aap (owner, 2026-10-20)", () => {
    for (const line of hinglishLines) {
      expect(line, line).not.toMatch(/\baap(ka|ki|ke|ko|ne)?\b/i);
    }
    expect(FEEDBACK_TEXT.context.hinglish).toContain("Tumhari pehchaan nahi.");
  });

  it("has a name for every type and every status", () => {
    expect(Object.keys(FEEDBACK_TYPE_LABELS)).toEqual([...FEEDBACK_TYPES]);
    expect(Object.keys(FEEDBACK_STATUS_LABELS)).toEqual([...FEEDBACK_STATUSES]);
  });
});
