import { describe, expect, it } from "vitest";
import { FEEDBACK_STATUSES, FEEDBACK_TYPES } from "@classicade/shared";
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TEXT, FEEDBACK_TYPE_LABELS } from "./feedbackText.js";

describe("the Feedback dialog's words (CC-290)", () => {
  // "tum", never "aap": the one shared test in src/copy.hinglish.test.js reads these lines (CC-351).
  it("says in Hinglish too that nothing sent says who the player is", () => {
    expect(FEEDBACK_TEXT.context.hinglish).toContain("Tumhari pehchaan nahi.");
  });

  it("has a name for every type and every status", () => {
    expect(Object.keys(FEEDBACK_TYPE_LABELS)).toEqual([...FEEDBACK_TYPES]);
    expect(Object.keys(FEEDBACK_STATUS_LABELS)).toEqual([...FEEDBACK_STATUSES]);
  });
});
