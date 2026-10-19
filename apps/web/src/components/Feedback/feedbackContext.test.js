import { describe, expect, it } from "vitest";
import { GAMES, isFeedbackPage, LEADERBOARDS } from "@classicade/shared";
import { ADMIN_SECTIONS, LEGACY_ROUTES, ROUTES } from "../../app/paths.js";
import { deviceClass, feedbackPage } from "./feedbackContext.js";

describe("feedbackPage: the page as a route pattern, never a code, a name or a query (CC-290)", () => {
  it.each([
    ["/", "/"],
    ["/games/chess", "/games/chess"],
    ["/games/chess/rooms/AB2CD3", "/games/chess/rooms/:code"],
    ["/games/tic-tac-toe/rooms/ZZZZZZ", "/games/tic-tac-toe/rooms/:code"],
    ["/games/not-a-game", "/games/:slug"],
    ["/games/Riya", "/games/:slug"],
    ["/games/riya/rooms/AB2CD3", "/games/:slug/rooms/:code"],
    ["/room/AB2CD3", "/room/:code"],
    ["/play/rps", "/play/rps"],
    ["/play/riya", "/play/:slug"],
    ["/u/Riya_99/userprofile", "/u/:username/userprofile"],
    ["/leaderboards/weekly", "/leaderboards/weekly"],
    ["/leaderboards/riya", "/leaderboards/:board"],
    ["/leaderboards", "/leaderboards"],
    ["/admin/players", "/admin/players"],
    ["/admin/riya", "/admin/:section"],
    ["/admin/feedback", "/admin/feedback"],
    ["/profile", "/profile"],
    ["/login", "/login"],
    ["/privacy", "/privacy"],
    ["/some/typed/address/AB2CD3", "/*"],
    ["/games/chess/", "/games/chess"],
  ])("%s is %s", (pathname, page) => {
    expect(feedbackPage(pathname)).toBe(page);
  });

  it("is the same for any letter case of a game page, without keeping the typed spelling", () => {
    expect(feedbackPage("/Games/Chess")).toBe("/games/chess");
  });
});

describe("every page the dialog can name passes the server's check, the same shared rule (CC-290)", () => {
  const pages = [
    "/",
    "/no/such/page",
    ...[...Object.values(ROUTES), ...Object.values(LEGACY_ROUTES)].map((route) => `/${route}`),
    ...GAMES.flatMap((game) => [
      `/games/${game.slug}`,
      `/games/${game.slug}/rooms/AB2CD3`,
      `/play/${game.id}`,
      `/play/${game.slug}`,
    ]),
    ...LEADERBOARDS.map((board) => `/leaderboards/${board.id}`),
    ...ADMIN_SECTIONS.map((section) => `/admin/${section}`),
  ];

  it.each(pages)("%s", (pathname) => {
    expect(isFeedbackPage(feedbackPage(pathname))).toBe(true);
  });

  it("keeps every game's and every board's own name, digits and all, rather than a placeholder", () => {
    for (const game of GAMES) expect(feedbackPage(`/games/${game.slug}`)).toBe(`/games/${game.slug}`);
    for (const board of LEADERBOARDS) {
      expect(feedbackPage(`/leaderboards/${board.id}`)).toBe(`/leaderboards/${board.id}`);
    }
  });
});

describe("deviceClass: phone, tablet or desktop from the screen's short side and the pointer", () => {
  it.each([
    [{ shortSide: 390, coarsePointer: true }, "phone"],
    [{ shortSide: 599, coarsePointer: true }, "phone"],
    [{ shortSide: 600, coarsePointer: true }, "tablet"],
    [{ shortSide: 1024, coarsePointer: true }, "tablet"],
    [{ shortSide: 1100, coarsePointer: true }, "desktop"],
    [{ shortSide: 390, coarsePointer: false }, "desktop"],
    [{ shortSide: 720, coarsePointer: false }, "desktop"],
  ])("%o is a %s", (screenInfo, device) => {
    expect(deviceClass(screenInfo)).toBe(device);
  });
});
