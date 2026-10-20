import { describe, expect, it } from "vitest";
import {
  DAILY_PUZZLES,
  describePage,
  gameForSlug,
  getGame,
  gamePreviewImage,
  GAMES,
  LEADERBOARDS,
  PUBLIC_PAGE_PATHS,
  SITE_NAME,
  SITE_PREVIEW_IMAGE,
} from "./index.js";

describe("gameForSlug", () => {
  it.each([
    ["rock-paper-scissors", "rps"],
    ["tic-tac-toe", "tictactoe"],
    ["chess", "chess"],
    ["Chess", "chess"],
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

describe("describePage", () => {
  it("describes the home page as listed, with the site image", () => {
    const home = describePage("/");

    expect(home).toMatchObject({ found: true, indexable: true, path: "/", image: SITE_PREVIEW_IMAGE });
    expect(home.title).toContain(SITE_NAME);
    expect(home.description.length).toBeLessThanOrEqual(160);
  });

  it("describes every game lobby with the game's name and its own preview image", () => {
    for (const game of GAMES) {
      const lobby = describePage(`/games/${game.slug}`);

      expect(lobby).toMatchObject({ found: true, indexable: true, path: `/games/${game.slug}` });
      expect(lobby.title).toBe(`Play ${game.name} with a friend on ClassiCade`);
      expect(lobby.image).toBe(gamePreviewImage(game));
      expect(lobby.imageAlt).toContain(game.name);
    }
  });

  it("does not list old or mistyped lobby URLs, and points them at the canonical one", () => {
    for (const path of ["/play/chess", "/games/Chess", "/games/rockpaperscissors"]) {
      expect(describePage(path)).toMatchObject({ found: true, indexable: false });
    }
    expect(describePage("/play/rps").path).toBe("/games/rock-paper-scissors");
  });

  it("describes pass and play for every game, never listed, at its canonical path (CC-223)", () => {
    expect(describePage("/games/rps/Pass-And-Play")).toMatchObject({
      found: true,
      indexable: false,
      title: "Rock Paper Scissors on one phone · ClassiCade",
      path: "/games/rock-paper-scissors/pass-and-play",
      image: expect.stringMatching(/^\/og\/rock-paper-scissors\.[0-9a-f]{8}\.jpg$/),
    });
    expect(describePage("/games/ludo/pass-and-play")).toMatchObject({ found: false });
    expect(describePage("/play/chess/pass-and-play")).toMatchObject({ found: false });
    expect(describePage("/games/chess/pass-and-play").description.length).toBeLessThanOrEqual(160);
  });

  it("invites to a room by the game its URL names, with an upper case code, never listed", () => {
    const invite = describePage("/games/chess/rooms/ab2cd3");

    expect(invite).toMatchObject({
      found: true,
      indexable: false,
      title: "Join my Chess game on ClassiCade",
      path: "/games/chess/rooms/AB2CD3",
      image: expect.stringMatching(/^\/og\/chess\.[0-9a-f]{8}\.jpg$/),
    });
  });

  it("invites to a room of a game it does not know, and to an old room link, in general words", () => {
    for (const path of ["/games/ludo/rooms/AB2CD3", "/room/ab2cd3"]) {
      expect(describePage(path)).toMatchObject({
        found: true,
        title: "Join my game on ClassiCade",
        path: "/room/AB2CD3",
        image: SITE_PREVIEW_IMAGE,
      });
    }
  });

  it.each([
    "/games/chess/rooms/AB2CD",
    "/games/chess/rooms/AB2CD0",
    "/games/chess/rooms/AB2CD3/extra",
    "/games/chess/seats/AB2CD3",
    "/play/chess/rooms/AB2CD3",
    "/room/nope",
    "/room",
    "/games",
    "/games/ludo",
  ])("finds no room or lobby at %s", (path) => {
    expect(describePage(path).found).toBe(false);
  });

  it("describes every leaderboard, and the bare leaderboards URL as the default board", () => {
    for (const board of LEADERBOARDS) {
      expect(describePage(`/leaderboards/${board.id}`)).toMatchObject({
        found: true,
        indexable: true,
        title: `${board.name} leaderboard · ClassiCade`,
      });
    }
    expect(describePage("/leaderboards").path).toBe(`/leaderboards/${LEADERBOARDS[0].id}`);
    expect(describePage("/leaderboards/nope").found).toBe(false);
    expect(describePage("/leaderboards/overall/extra").found).toBe(false);
  });

  it("describes each daily puzzle with its game's preview image, listed, and nothing for an unknown kind (CC-144)", () => {
    for (const puzzle of DAILY_PUZZLES) {
      expect(describePage(`/daily/${puzzle.id}`)).toMatchObject({
        found: true,
        indexable: true,
        path: `/daily/${puzzle.id}`,
        title: `${puzzle.name} · ClassiCade`,
        image: gamePreviewImage(getGame(puzzle.gameId)),
      });
    }
    expect(describePage("/Daily/chess/").path).toBe("/daily/chess");
    expect(describePage("/daily/sudoku").found).toBe(false);
    expect(describePage("/daily").found).toBe(false);
    expect(PUBLIC_PAGE_PATHS).toContain("/daily/chess");
  });

  it("describes a player's profile without naming anyone, never listed, and nothing for a malformed handle (CC-034)", () => {
    expect(describePage("/players/0123456789abcdef")).toMatchObject({
      found: true,
      indexable: false,
      title: "A player on ClassiCade",
      path: "/players/0123456789abcdef",
    });
    for (const path of ["/players", "/players/user_abc", "/players/0123456789ABCDEF", "/players/a/b"]) {
      expect(describePage(path).found, path).toBe(false);
    }
  });

  it("lists the legal pages, whatever the letter case and trailing slash", () => {
    expect(describePage("/privacy")).toMatchObject({ found: true, indexable: true, path: "/privacy" });
    expect(describePage("/Terms/")).toMatchObject({ found: true, indexable: true, path: "/terms" });
  });

  it("keeps account pages and old account URLs out of search results", () => {
    for (const path of [
      "/login",
      "/signup",
      "/profile",
      "/login-signup.html",
      "/u/Old%20Timer/userprofile",
    ]) {
      expect(describePage(path), path).toMatchObject({ found: true, indexable: false });
    }
    expect(describePage("/u/someone/elsewhere").found).toBe(false);
  });

  it("finds nothing at unknown URLs or broken percent encoding", () => {
    for (const path of ["/no/such/page", "/constructor", "/%E0%A4%A", "/privacy/extra"]) {
      expect(describePage(path), path).toMatchObject({ found: false, indexable: false });
    }
  });

  it("lists the public pages once each, every one of them a listed page", () => {
    expect(new Set(PUBLIC_PAGE_PATHS).size).toBe(PUBLIC_PAGE_PATHS.length);
    for (const path of PUBLIC_PAGE_PATHS) {
      expect(describePage(path), path).toMatchObject({ found: true, indexable: true, path });
    }
    expect(PUBLIC_PAGE_PATHS.some((path) => path.includes("/rooms/"))).toBe(false);
  });

  it("keeps every description short enough for a search result", () => {
    const paths = [...PUBLIC_PAGE_PATHS, "/games/chess/rooms/AB2CD3", "/room/AB2CD3", "/login", "/nope"];
    for (const path of paths) {
      expect(describePage(path).description.length, path).toBeLessThanOrEqual(160);
    }
  });
});
