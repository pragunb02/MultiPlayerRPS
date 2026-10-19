import { describe, expect, it } from "vitest";
import { createInMemoryFeedbackDao } from "../testing/inMemoryFeedbackDao.js";
import { NotFoundError } from "../utils/errors.js";
import { createFeedbackAccessor } from "./feedbackAccessor.js";

const T0 = Date.UTC(2026, 9, 20, 12);
let counter = 0;
const item = ({ at = T0, ...rest } = {}) => ({
  feedbackId: `00000000-0000-4000-a000-${String(++counter).padStart(12, "0")}`,
  type: "idea",
  message: "Add Ludo",
  page: "/",
  build: "dev",
  device: "desktop",
  kind: "visitor",
  at,
  ...rest,
});

describe("feedbackAccessor (CC-290)", () => {
  it("stores a new item and answers a frozen model with status new and times in milliseconds", async () => {
    const feedback = createFeedbackAccessor({ feedbackDao: createInMemoryFeedbackDao() });
    const input = item({ replyEmail: "riya@example.com" });

    const stored = await feedback.add(input);

    const { at, ...fields } = input;
    expect(stored).toEqual({ ...fields, status: "new", createdAt: at, updatedAt: at });
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it("lists newest first, filtered, and pages on from the last item given", async () => {
    const feedback = createFeedbackAccessor({ feedbackDao: createInMemoryFeedbackDao() });
    const first = await feedback.add(item({ at: T0 + 1 }));
    const second = await feedback.add(item({ at: T0 + 2 }));
    await feedback.add(item({ at: T0 + 3, type: "bug" }));

    const page = await feedback.list({ where: { type: "idea" }, limit: 1 });
    const next = await feedback.list({ where: { type: "idea" }, limit: 1, before: page[0] });

    expect(page.map((each) => each.feedbackId)).toEqual([second.feedbackId]);
    expect(next.map((each) => each.feedbackId)).toEqual([first.feedbackId]);
    expect(Object.isFrozen(page)).toBe(true);
  });

  it("sets a status and answers the changed item", async () => {
    const feedback = createFeedbackAccessor({ feedbackDao: createInMemoryFeedbackDao() });
    const stored = await feedback.add(item());

    const changed = await feedback.setStatus({ feedbackId: stored.feedbackId, status: "done", at: T0 + 60 });

    expect(changed).toEqual({ ...stored, status: "done", updatedAt: T0 + 60 });
  });

  it("answers NotFoundError for an item that is not there", async () => {
    const feedback = createFeedbackAccessor({ feedbackDao: createInMemoryFeedbackDao() });

    await expect(
      feedback.setStatus({ feedbackId: "00000000-0000-4000-a000-0000000000ff", status: "done", at: T0 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("passes other storage failures through", async () => {
    const broken = { ...createInMemoryFeedbackDao(), setStatus: async () => Promise.reject(new Error("down")) };
    const feedback = createFeedbackAccessor({ feedbackDao: broken });

    await expect(feedback.setStatus({ feedbackId: "x", status: "done", at: T0 })).rejects.toThrow("down");
  });
});
