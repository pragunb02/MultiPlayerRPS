import { describe, expect, it } from "vitest";
import { describePage, GAMES, LEADERBOARDS, PUBLIC_PAGE_PATHS } from "@classicade/shared";
import {
  gameForSlug,
  normaliseRoomCode,
  paths,
  queryOf,
  returnPathFor,
  returnsToRoom,
  safeNext,
  withShareChannel,
} from "./paths.js";

describe("paths", () => {
  it("builds readable URLs from game ids", () => {
    expect(paths.home()).toBe("/");
    expect(paths.game("rps")).toBe("/games/rock-paper-scissors");
    expect(paths.game("tictactoe")).toBe("/games/tic-tac-toe");
    expect(paths.room("chess", " ab2cd3 ")).toBe("/games/chess/rooms/AB2CD3");
    expect(paths.profile()).toBe("/profile");
    expect(paths.leaderboards()).toBe("/leaderboards/overall");
    expect(paths.leaderboards("tic-tac-toe")).toBe("/leaderboards/tic-tac-toe");
    expect(paths.privacy()).toBe("/privacy");
    expect(paths.terms()).toBe("/terms");
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

describe("withShareChannel (CC-279)", () => {
  it.each(["wa", "share", "copy"])("marks a shared link with via=%s and no other parameter", (channel) => {
    const link = new URL(withShareChannel("https://classicade.example/games/chess", channel));

    expect(link.origin + link.pathname).toBe("https://classicade.example/games/chess");
    expect([...link.searchParams]).toEqual([["via", channel]]);
  });

  it("puts the marker after the room's address, so the invite still opens the room", () => {
    expect(withShareChannel("https://classicade.example/games/chess/rooms/AB2CD3", "copy")).toBe(
      "https://classicade.example/games/chess/rooms/AB2CD3?via=copy",
    );
  });

  it.each(["telegram", "", "u_5f2a9c"])("refuses a channel not on the list (%j)", (channel) => {
    expect(() => withShareChannel("https://classicade.example/games/chess", channel)).toThrow(RangeError);
  });
});

describe("owner console paths (CC-233)", () => {
  it("builds the overview and section URLs, with the range when given", () => {
    expect(paths.admin()).toBe("/admin");
    expect(paths.admin("games")).toBe("/admin/games");
    expect(paths.admin(undefined, { from: "2025-03-03", to: undefined, bucket: "day" })).toBe(
      "/admin?from=2025-03-03&bucket=day",
    );
  });

  it("is not a public page", () => {
    expect(PUBLIC_PAGE_PATHS).not.toContain("/admin");
    expect(describePage(paths.admin("players")).found).toBe(false);
  });
});

describe("queryOf: one way to write a page's query (CC-290)", () => {
  it("writes the given keys in their order, leaves out the missing ones and ignores the rest", () => {
    expect(queryOf({ to: "2025-03-09", from: "2025-03-03", other: "x" }, ["from", "to", "bucket"])).toBe(
      "?from=2025-03-03&to=2025-03-09",
    );
    expect(queryOf({}, ["type", "status"])).toBe("");
  });

  it("is what the console's addresses use", () => {
    expect(paths.admin("games", { bucket: "week", from: "2025-03-03" })).toBe(
      "/admin/games?from=2025-03-03&bucket=week",
    );
    expect(paths.adminFeedback({ status: "done", type: "bug" })).toBe("/admin/feedback?type=bug&status=done");
    expect(paths.adminFeedback()).toBe("/admin/feedback");
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

describe("returnsToRoom (CC-112)", () => {
  it("is true for the room's own page, however it is spelled", () => {
    expect(returnsToRoom("/games/chess/rooms/AB2CD3", "AB2CD3")).toBe(true);
    expect(returnsToRoom("/games/chess/rooms/ab2cd3", "AB2CD3")).toBe(true);
    expect(returnsToRoom("/room/ab2cd3", "AB2CD3")).toBe(true);
  });

  it("is true for logging in or signing up on the way back to the room", () => {
    expect(returnsToRoom(paths.signup("/games/chess/rooms/AB2CD3"), "AB2CD3")).toBe(true);
    expect(returnsToRoom(paths.login("/games/chess/rooms/AB2CD3"), "AB2CD3")).toBe(true);
  });

  it("is false for any other page, another room, or an account page going elsewhere", () => {
    expect(returnsToRoom("/", "AB2CD3")).toBe(false);
    expect(returnsToRoom("/games/chess", "AB2CD3")).toBe(false);
    expect(returnsToRoom("/games/chess/rooms/ZZ9ZZ9", "AB2CD3")).toBe(false);
    expect(returnsToRoom(paths.signup("/profile"), "AB2CD3")).toBe(false);
    expect(returnsToRoom("/signup", "AB2CD3")).toBe(false);
  });
});

describe("normaliseRoomCode", () => {
  it("upper-cases and trims", () => {
    expect(normaliseRoomCode(" ab2Cd3 ")).toBe("AB2CD3");
  });
});

// The server describes pages to crawlers from the shared page list (CC-047). These tests keep that list and the
// links the app builds the same.
describe("the shared page list", () => {
  it("lists exactly the public pages the app links to", () => {
    const linked = [
      paths.home(),
      ...GAMES.map((game) => paths.game(game.id)),
      ...LEADERBOARDS.map((board) => paths.leaderboards(board.id)),
      paths.privacy(),
      paths.terms(),
    ];

    expect([...PUBLIC_PAGE_PATHS].sort()).toEqual(linked.sort());
  });

  it("gives an invite link the URL the app builds for the room", () => {
    for (const game of GAMES) {
      expect(describePage(paths.room(game.id, "ab2cd3")).path).toBe(paths.room(game.id, "AB2CD3"));
    }
  });

  it("knows the account pages the app links to", () => {
    for (const path of [paths.login(), paths.signup(), paths.profile()]) {
      expect(describePage(path)).toMatchObject({ found: true, path });
    }
  });
});
