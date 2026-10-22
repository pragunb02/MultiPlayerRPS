import { describe, expect, it } from "vitest";
import { nextKindOf, ruleOf } from "./authForms.js";
import { entryOf } from "./entry.js";

const ORIGIN = "https://nocapgaming.onrender.com";
const NONE = { entry: "", via: "" };
const entry = (referrer, { pathname = "/", landing = NONE } = {}) =>
  entryOf({ landing, pathname, referrer, origin: ORIGIN });

describe("how a page load arrived (CC-174, CC-279)", () => {
  it("is a shared link with its channel first, then a room's link, then the referrer's kind", () => {
    expect(entry("https://www.google.com/", { landing: { entry: "shared_link", via: "wa" } })).toEqual({
      entry: "shared_link",
      via: "wa",
    });
    expect(entry("https://www.google.com/", { pathname: "/games/chess/rooms/AB2CD3" })).toEqual({
      entry: "room_link",
      via: "",
    });
    expect(entry("")).toEqual({ entry: "direct", via: "" });
    expect(entry(`${ORIGIN}/games/chess`)).toEqual({ entry: "direct", via: "" });
    expect(entry("not a url")).toEqual({ entry: "direct", via: "" });
    expect(entry("https://www.google.co.in/search?q=riya")).toEqual({ entry: "search", via: "" });
    expect(entry("https://duckduckgo.com/")).toEqual({ entry: "search", via: "" });
    expect(entry("https://l.instagram.com/?u=x")).toEqual({ entry: "social", via: "" });
    expect(entry("https://t.co/abc")).toEqual({ entry: "social", via: "" });
    expect(entry("https://someones-blog.example/post")).toEqual({ entry: "other_site", via: "" });
  });
});

describe("what the auth forms tell (CC-174, EVENTS.md 3.3)", () => {
  it("names where next points as a kind, never the path", () => {
    expect(nextKindOf("/games/chess/rooms/AB2CD3")).toBe("room");
    expect(nextKindOf("/room/AB2CD3?x=1")).toBe("room");
    expect(nextKindOf("/profile")).toBe("profile");
    expect(nextKindOf("/leaderboards/weekly")).toBe("leaderboard");
    expect(nextKindOf("/leaderboards")).toBe("leaderboard");
    expect(nextKindOf("/")).toBe("none");
    expect(nextKindOf("/friends")).toBe("none");
  });

  it("names the rule a field broke as a fixed code", () => {
    expect(ruleOf("email", "  ")).toBe("missing");
    expect(ruleOf("password", "short")).toBe("too_short");
    expect(ruleOf("username", "ab")).toBe("too_short");
    expect(ruleOf("username", "riya plays!")).toBe("format");
    expect(ruleOf("email", "riya@")).toBe("format");
  });
});
