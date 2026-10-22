import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeApi, GUEST } from "../testing/fakes.js";
import { findUsableButton, renderApp } from "../testing/render.jsx";
import { PlayPage } from "./routePages.js";

/** The list of game cards, inside the Games section, once the catalogue has loaded. */
const gameList = () => within(screen.getByRole("region", { name: "Games" })).findByRole("list");

describe("App", () => {
  describe("the realtime connection (CC-333)", () => {
    it("leaves the download of Socket.IO to an idle moment on a page that can wait", () => {
      const { socket } = renderApp({ path: "/" });

      expect(socket.needNow).not.toHaveBeenCalled();
    });

    it("needs it at once on a page that cannot wait", () => {
      const { socket } = renderApp({ path: "/friends" });

      expect(socket.needNow).toHaveBeenCalled();
    });

    it("needs it at once when the player goes to such a page", () => {
      const { socket, back } = renderApp({ path: "/", history: ["/challenge/abcdefghijklmnopqrst"] });

      back();

      expect(socket.needNow).toHaveBeenCalled();
    });
  });

  it("links to the daily chess puzzle from the home page (CC-144)", async () => {
    renderApp();

    const daily = screen.getByRole("region", { name: "Daily puzzle" });

    expect(within(daily).getByRole("link", { name: "Today's puzzle" })).toHaveAttribute(
      "href",
      "/daily/chess",
    );
    expect(within(daily).getByRole("listitem")).toHaveClass("chess");
  });

  it("names the daily puzzle's link so it is never taken for a game's own link", async () => {
    renderApp();

    const daily = screen.getByRole("region", { name: "Daily puzzle" });

    // Browser tests find a link by a part of its name, so "Daily chess puzzle" would also answer to "Chess".
    for (const game of ["Chess", "Rock Paper Scissors", "Tic Tac Toe"]) {
      expect(within(daily).queryByRole("link", { name: new RegExp(game, "i") })).toBeNull();
    }
  });

  it("shows the pitch and the game catalog", async () => {
    renderApp();

    expect(screen.getByRole("heading", { level: 1, name: /play the classics/i })).toBeInTheDocument();
    const games = await gameList();
    expect(
      within(games)
        .getAllByRole("listitem")
        .map((li) => within(li).getByRole("heading").textContent),
    ).toEqual(["Rock Paper Scissors", "Chess"]);
  });

  it("illustrates each game card with its art and accent, keeping the game's name as the link", async () => {
    renderApp();

    const games = await gameList();
    const [rps, chess] = within(games).getAllByRole("listitem");
    expect(rps).toHaveClass("rps");
    expect(chess).toHaveClass("chess");
    expect(rps.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(rps).getByRole("link")).toHaveAccessibleName("Rock Paper Scissors");
  });

  it("gives a game this build has no art for the joystick and the default accent", async () => {
    renderApp({
      api: fakeApi({
        getGames: async () => [{ id: "ludo", slug: "ludo", name: "Ludo", minPlayers: 2, maxPlayers: 4 }],
      }),
    });

    expect((await within(await gameList()).findByRole("listitem")).className).toContain("primary");
  });

  it("shows the arcade scene in the hero once it has loaded", async () => {
    const { container } = renderApp();

    await vi.waitFor(() => expect(container.querySelector(".heroArt svg")).not.toBeNull());
  });

  it("brands the header with the logo, named by its link", () => {
    renderApp();

    const home = screen.getByRole("link", { name: "ClassiCade home" });
    expect(home.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("starts playing as a guest in one click", async () => {
    const user = userEvent.setup();
    const { api } = renderApp();

    await user.click(await findUsableButton(/play as a guest/i));

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(await screen.findByText(`You're playing as ${GUEST.displayName}.`)).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText(GUEST.displayName)).toBeInTheDocument();
  });

  it("explains a failure to start a guest session", async () => {
    const user = userEvent.setup();
    renderApp({
      api: fakeApi({
        startGuest: async () => Promise.reject(new Error("Too many requests, try again later")),
      }),
    });

    await user.click(await findUsableButton(/play as a guest/i));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests, try again later");
  });

  it("tells how many can play: an exact number, or a range", async () => {
    renderApp({
      api: fakeApi({
        getGames: async () => [
          { id: "chess", slug: "chess", name: "Chess", minPlayers: 2, maxPlayers: 2 },
          { id: "ludo", slug: "ludo", name: "Ludo", minPlayers: 2, maxPlayers: 4 },
        ],
      }),
    });

    expect(await screen.findByText("2 players")).toBeInTheDocument();
    expect(screen.getByText("2–4 players")).toBeInTheDocument();
  });

  it("explains when the catalog cannot load", async () => {
    renderApp({
      api: fakeApi({ getGames: async () => Promise.reject(new Error("Can't reach ClassiCade")) }),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach ClassiCade");
  });

  it("shows a not-found page for unknown URLs", async () => {
    renderApp({ path: "/nope" });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /game over, page not found/ })).toBeInTheDocument();
    expect(screen.getByText(/That page doesn't exist. The link may be old or mistyped./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the games" })).toHaveAttribute("href", "/");
  });

  it("hints the lobby's files when its card's link is pointed at, and runs none of its code (CC-322)", async () => {
    const user = userEvent.setup();
    const hint = vi.spyOn(PlayPage, "prefetch");
    const run = vi.spyOn(PlayPage, "preload");
    renderApp();

    await user.hover(within(await gameList()).getByRole("link", { name: "Chess" }));

    expect(hint).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    hint.mockRestore();
    run.mockRestore();
  });

  it("draws the page a redirect lands on, for each old or short address", async () => {
    for (const [path, heading] of [
      ["/leaderboards", /leaderboard/i],
      ["/login-signup.html", /log in/i],
    ]) {
      const view = renderApp({ path });
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("offers a skip link to the main content (keyboard users)", () => {
    renderApp();

    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });
});
