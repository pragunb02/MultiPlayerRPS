import { afterEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_ROUTES } from "../pages/AdminPage/consolePages.js";
import { HomePage } from "../pages/HomePage/HomePage.jsx";
import { LEGACY_ROUTES, ROUTES } from "./paths.js";
import {
  AdminRoute,
  APP_ROUTES,
  LeaderboardPage,
  LoginPage,
  needsSocketNow,
  NotFoundPage,
  pageFor,
  PlayPage,
  prefetchRouteFor,
  preloadRouteFor,
  ProfilePage,
  RoomPage,
} from "./routePages.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** An address for a route pattern, with every `:param` filled in. */
const addressOf = (path) => `/${path.replace(/:\w+/g, "x1")}`;

describe("APP_ROUTES: the one route table App.jsx draws and the early downloads read (CC-322)", () => {
  it("lists every route the app has, each once", () => {
    const paths = APP_ROUTES.map(({ path, index }) => (index ? "(home)" : path));

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(
      expect.arrayContaining([
        "(home)",
        ...Object.values(ROUTES).filter((path) => !path.startsWith("admin")),
        ...Object.values(LEGACY_ROUTES),
        ...CONSOLE_ROUTES.map(({ path }) => path),
        "*",
      ]),
    );
  });

  it("gives every address the page its own entry draws, by the router's ranking", () => {
    for (const route of APP_ROUTES.filter((each) => each.page !== undefined && each.path !== "*")) {
      const address = route.index ? "/" : addressOf(route.path);
      expect(pageFor(address), address).toBe(route.page);
    }
  });

  it("follows a redirect to the page it lands on, so a direct visit fetches that page and not the 404", () => {
    expect(pageFor("/leaderboards")).toBe(LeaderboardPage);
    expect(pageFor("/u/someone/userprofile")).toBe(ProfilePage);
    expect(pageFor("/login-signup.html")).toBe(LoginPage);
  });

  it("ranks like the router: a room is not its lobby, and an unknown address is the not-found page", () => {
    expect(pageFor("/games/chess")).toBe(PlayPage);
    expect(pageFor("/games/chess/rooms/AB2CD3")).toBe(RoomPage);
    expect(pageFor("/admin/flags")).toBe(AdminRoute);
    expect(pageFor("/nope/at/all")).toBe(NotFoundPage);
    expect(pageFor("/")).toBe(HomePage);
  });
});

describe("needsSocketNow: the pages that cannot wait for an idle moment to connect (CC-333)", () => {
  it.each([
    ["a room", "/games/chess/rooms/AB2CD3"],
    ["a room by its old address", "/room/AB2CD3"],
    ["a challenge", "/challenge/abcdefghijklmnopqrst"],
    ["the friends page", "/friends"],
  ])("says %s needs the realtime connection at once", (_case, address) => {
    expect(needsSocketNow(address)).toBe(true);
  });

  it.each([
    ["home", "/"],
    ["a lobby", "/games/chess"],
    ["a friend link", "/friends/add/sometoken"],
    ["the profile", "/profile"],
    ["a leaderboard, through its redirect", "/leaderboards"],
    ["an unknown address", "/nope/at/all"],
  ])("lets %s connect when the browser is idle", (_case, address) => {
    expect(needsSocketNow(address)).toBe(false);
  });
});

describe("preloadRouteFor: the page of a direct visit, fetched before the first render", () => {
  it("downloads the page's code, through a redirect too", async () => {
    const play = vi.spyOn(PlayPage, "preload").mockResolvedValue({});
    const board = vi.spyOn(LeaderboardPage, "preload").mockResolvedValue({});

    await preloadRouteFor("/play/chess");
    await preloadRouteFor("/leaderboards");

    expect(play).toHaveBeenCalledOnce();
    expect(board).toHaveBeenCalledOnce();
  });

  it("fetches nothing for home, which is in the first download", async () => {
    await expect(preloadRouteFor("/")).resolves.toBeUndefined();
  });

  it("settles even when the download fails, so the first render is never held back by it", async () => {
    vi.spyOn(PlayPage, "preload").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(preloadRouteFor("/games/chess")).resolves.toBeUndefined();
  });
});

describe("prefetchRouteFor: the hint when a link is pointed at", () => {
  it("hints the page's files and never downloads its code", () => {
    const hint = vi.spyOn(PlayPage, "prefetch").mockImplementation(() => {});
    const run = vi.spyOn(PlayPage, "preload");

    prefetchRouteFor("/games/chess");

    expect(hint).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it("does nothing for home", () => {
    expect(() => prefetchRouteFor("/")).not.toThrow();
  });
});
