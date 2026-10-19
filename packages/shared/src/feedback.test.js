import { describe, expect, it } from "vitest";
import {
  FEEDBACK_DEVICES,
  FEEDBACK_KEEP_DAYS,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
} from "./index.js";

describe("feedback lists shared by the page and the server (CC-290)", () => {
  it("offers Bug, Idea and Other, in that order", () => {
    expect(FEEDBACK_TYPES).toEqual(["bug", "idea", "other"]);
  });

  it("moves an item from new to read to done", () => {
    expect(FEEDBACK_STATUSES).toEqual(["new", "read", "done"]);
  });

  it("names three coarse devices and three kinds of player, never more detail", () => {
    expect(FEEDBACK_DEVICES).toEqual(["phone", "tablet", "desktop"]);
    expect(FEEDBACK_KINDS).toEqual(["visitor", "guest", "account"]);
  });

  it("caps a message at 1000 characters and keeps it 180 days", () => {
    expect(FEEDBACK_MESSAGE_MAX).toBe(1000);
    expect(FEEDBACK_KEEP_DAYS).toBe(180);
  });

  it.each([FEEDBACK_TYPES, FEEDBACK_STATUSES, FEEDBACK_DEVICES, FEEDBACK_KINDS])("is frozen", (list) => {
    expect(Object.isFrozen(list)).toBe(true);
  });
});
