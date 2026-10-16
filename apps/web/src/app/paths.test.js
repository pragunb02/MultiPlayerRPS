import { describe, expect, it } from "vitest";
import { gameForSlug, normaliseRoomCode, paths, returnPathFor, safeNext } from "./paths.js";

describe("paths", () => {
  it("builds readable URLs from game ids", () => {
    expect(paths.home()).toBe("/");
    expect(paths.game("rps")).toBe("/games/rock-paper-scissors");
    expect(paths.game("tictactoe")).toBe("/games/tic-tac-toe");
    expect(paths.room("chess", " ab2cd3 ")).toBe("/games/chess/rooms/AB2CD3");
    expect(paths.profile()).toBe("/profile");
  });

  it("keeps an unknown game's id, so the link leads to a clear not-found", () => {
    expect(paths.game("ludo")).toBe("/games/ludo");
  });

  it("adds `next` to account links only when it leads somewhere other than home", () => {
    expect(paths.login()).toBe("/login");
    expect(paths.login("/")).toBe("/login");
    expect(paths.login("/games/chess/rooms/AB2CD3")).toBe("/login?next=%2Fgames%2Fchess%2Frooms%2FAB2CD3");
    expect(paths.signup("https://evil.example")).toBe("/signup");
  });
});

describe("gameForSlug", () => {
  it.each([
    ["rock-paper-scissors", "rps"],
    ["tic-tac-toe", "tictactoe"],
    ["chess", "chess"],
    ["Chess", "chess"],
    // Old URLs: legacy app (/games/rockpaperscissors) and game ids (/play/rps).
    ["rockpaperscissors", "rps"],
    ["rps", "rps"],
    ["tictactoe", "tictactoe"],
  ])("finds the game for %s", (slug, id) => {
    expect(gameForSlug(slug)?.id).toBe(id);
  });

  it("knows nothing else", () => {
    expect(gameForSlug("ludo")).toBeUndefined();
    expect(gameForSlug(undefined)).toBeUndefined();
  });
});

describe("safeNext", () => {
  it.each([
    ["/games/chess/rooms/AB2CD3", "/games/chess/rooms/AB2CD3"],
    ["/profile", "/profile"],
    ["/games/chess?x=1", "/games/chess?x=1"],
  ])("follows same-site paths (%s)", (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    // Back to an account page would loop.
    "/login",
    "/login?next=%2Fprofile",
    "/signup",
  ])("goes home instead of %s", (next) => {
    expect(safeNext(next)).toBe("/");
  });
});

describe("returnPathFor", () => {
  it("returns to the page itself", () => {
    expect(returnPathFor({ pathname: "/games/chess", search: "" })).toBe("/games/chess");
  });

  it("on account pages, passes their `next` on instead of nesting it", () => {
    expect(returnPathFor({ pathname: "/login", search: "?next=%2Fprofile" })).toBe("/profile");
    expect(returnPathFor({ pathname: "/signup", search: "" })).toBe("/");
  });
});

describe("normaliseRoomCode", () => {
  it("upper-cases and trims", () => {
    expect(normaliseRoomCode(" ab2Cd3 ")).toBe("AB2CD3");
  });
});
