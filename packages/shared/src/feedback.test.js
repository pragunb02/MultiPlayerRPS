import { describe, expect, it } from "vitest";
import {
  FEEDBACK_DEFAULT_TYPE,
  FEEDBACK_DEVICE,
  FEEDBACK_DEVICES,
  FEEDBACK_INITIAL_STATUS,
  FEEDBACK_KEEP_DAYS,
  FEEDBACK_KIND,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_STATUS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE,
  FEEDBACK_TYPES,
  GAMES,
  isFeedbackPage,
  LEADERBOARDS,
} from "./index.js";

describe("feedback names shared by the page and the server (CC-290)", () => {
  it("names the types, statuses, devices and kinds, and lists them in that order", () => {
    expect(FEEDBACK_TYPE).toEqual({ BUG: "bug", IDEA: "idea", OTHER: "other" });
    expect(FEEDBACK_STATUS).toEqual({ NEW: "new", READ: "read", DONE: "done" });
    expect(FEEDBACK_DEVICE).toEqual({ PHONE: "phone", TABLET: "tablet", DESKTOP: "desktop" });
    expect(FEEDBACK_KIND).toEqual({ VISITOR: "visitor", GUEST: "guest", ACCOUNT: "account" });
    expect(FEEDBACK_TYPES).toEqual(Object.values(FEEDBACK_TYPE));
    expect(FEEDBACK_STATUSES).toEqual(Object.values(FEEDBACK_STATUS));
    expect(FEEDBACK_DEVICES).toEqual(Object.values(FEEDBACK_DEVICE));
    expect(FEEDBACK_KINDS).toEqual(Object.values(FEEDBACK_KIND));
  });

  it("names the status a new item starts in and the type the dialog starts on, not by their place in a list", () => {
    expect(FEEDBACK_INITIAL_STATUS).toBe(FEEDBACK_STATUS.NEW);
    expect(FEEDBACK_DEFAULT_TYPE).toBe(FEEDBACK_TYPE.BUG);
  });

  it("caps a message at 1000 characters and keeps it 180 days", () => {
    expect(FEEDBACK_MESSAGE_MAX).toBe(1000);
    expect(FEEDBACK_KEEP_DAYS).toBe(180);
  });

  it.each([
    FEEDBACK_TYPE,
    FEEDBACK_STATUS,
    FEEDBACK_DEVICE,
    FEEDBACK_KIND,
    FEEDBACK_TYPES,
    FEEDBACK_STATUSES,
    FEEDBACK_DEVICES,
    FEEDBACK_KINDS,
  ])("is frozen", (names) => {
    expect(Object.isFrozen(names)).toBe(true);
  });
});

describe("isFeedbackPage: a route pattern with no code, name or query in it (CC-290)", () => {
  it.each([
    "/",
    "/*",
    "/profile",
    "/games/:slug/rooms/:code",
    "/u/:username/userprofile",
    "/admin/feedback",
    "/leaderboards/weekly",
  ])("takes %s", (page) => {
    expect(isFeedbackPage(page)).toBe(true);
  });

  it("takes every game's page and every board's page from the catalog, digits and all", () => {
    for (const game of GAMES) {
      expect(isFeedbackPage(`/games/${game.slug}`), game.slug).toBe(true);
      expect(isFeedbackPage(`/play/${game.id}`), game.id).toBe(true);
    }
    for (const board of LEADERBOARDS) {
      expect(isFeedbackPage(`/leaderboards/${board.id}`), board.id).toBe(true);
    }
  });

  it.each([
    ["a room code", "/games/chess/rooms/AB2CD3"],
    ["a code in lower case with digits", "/room/ab2cd3"],
    ["a name", "/u/Riya_99/userprofile"],
    ["a word with a digit that is no game or board", "/games/chess2"],
    ["a query", "/games/chess?next=/x"],
    ["a hash", "/profile#matches"],
    ["another site", "https://evil.example/"],
    ["a trailing slash", "/profile/"],
    ["an empty segment", "/games//rooms"],
    ["an upper case placeholder", "/games/:Slug"],
    ["no slash in front", "profile"],
    ["too many segments", `/${Array.from({ length: 9 }, () => "a").join("/")}`],
    ["too long", `/${"a".repeat(120)}`],
    ["not text", 42],
  ])("refuses %s", (_, page) => {
    expect(isFeedbackPage(page)).toBe(false);
  });
});
