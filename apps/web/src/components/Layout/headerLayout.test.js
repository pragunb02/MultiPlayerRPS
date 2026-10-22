import { describe, expect, it } from "vitest";
import { SECTIONS, sectionOf } from "./headerLayout.js";

describe("sectionOf (CC-324)", () => {
  it.each([
    ["/", SECTIONS.GAMES],
    ["/games/chess", SECTIONS.GAMES],
    ["/games/chess/rooms/AB2CD3", SECTIONS.GAMES],
    ["/daily/chess", SECTIONS.GAMES],
    ["/challenge/c0000000000000000001", SECTIONS.GAMES],
    ["/leaderboards/overall", SECTIONS.LEADERBOARDS],
    ["/leaderboards/weekly", SECTIONS.LEADERBOARDS],
    ["/leaderboards/tic-tac-toe", SECTIONS.LEADERBOARDS],
    ["/friends", SECTIONS.FRIENDS],
    ["/friends/add/token", SECTIONS.FRIENDS],
    ["/profile", SECTIONS.PROFILE],
    ["/admin/flags", SECTIONS.ADMIN],
  ])("puts %s under %s", (path, section) => {
    expect(sectionOf(path)).toBe(section);
  });

  it.each(["/players/abc", "/privacy", "/terms", "/login", "/nowhere"])("marks nothing on %s", (path) => {
    expect(sectionOf(path)).toBeUndefined();
  });
});
