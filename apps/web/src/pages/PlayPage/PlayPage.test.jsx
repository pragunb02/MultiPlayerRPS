import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeSocket } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

describe("PlayPage", () => {
  it("creates a room with the game's options (starting a guest first) and opens it", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockImplementation(async (event) =>
      event === "room:create" ? { code: "AB2CD3" } : new Promise(() => {}),
    );
    const { api } = renderApp({ path: "/games/rock-paper-scissors", socket });

    await user.selectOptions(screen.getByRole("combobox", { name: /match length/i }), "5");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(socket.request).toHaveBeenCalledWith("room:create", { gameId: "rps", options: { bestOf: 5 } });
    expect(await screen.findByText(/Joining room AB2CD3/)).toBeInTheDocument();
  });

  it("shows the game's banner with its art and accent", () => {
    renderApp({ path: "/games/tic-tac-toe" });

    const banner = screen.getByRole("heading", { level: 1, name: "Tic Tac Toe" }).parentElement;
    expect(banner).toHaveClass("tictactoe");
    expect(banner.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("offers chess time controls", () => {
    renderApp({ path: "/games/chess" });

    expect(screen.getByRole("combobox", { name: /time control/i })).toHaveDisplayValue("Blitz 5 min");
  });

  it("creates a chess room with the chosen time control", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockImplementation(async (event) =>
      event === "room:create" ? { code: "AB2CD3" } : new Promise(() => {}),
    );
    renderApp({ path: "/games/chess", socket });

    await user.selectOptions(screen.getByRole("combobox", { name: /time control/i }), "Rapid 15 min + 10 s");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(socket.request).toHaveBeenCalledWith("room:create", {
      gameId: "chess",
      options: { timeControl: "rapid-15+10" },
    });
  });

  it("shows an error when the room cannot be created", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockRejectedValue(new Error("Slow down — too many requests"));
    renderApp({ path: "/games/tic-tac-toe", socket });

    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Slow down");
  });

  it("says what is missing when Join room is pressed before the code is complete (CC-164)", async () => {
    const user = userEvent.setup();
    const { url } = renderApp({ path: "/games/rock-paper-scissors" });
    const join = screen.getByRole("button", { name: "Join room" });
    await user.type(screen.getByRole("textbox", { name: "Room code" }), "ab2");

    await user.click(join);

    expect(join).toHaveAttribute("aria-disabled", "true");
    expect(join).toHaveAccessibleDescription("Enter the 6-character room code");
    expect(screen.getAllByText("Enter the 6-character room code")).toHaveLength(2);
    expect(url()).toBe("/games/rock-paper-scissors");
  });

  it("keeps Join room explained when Enter is pressed in a short code", async () => {
    const user = userEvent.setup();
    const { url } = renderApp({ path: "/games/rock-paper-scissors" });

    await user.type(screen.getByRole("textbox", { name: "Room code" }), "ab2{Enter}");

    expect(url()).toBe("/games/rock-paper-scissors");
  });

  it("joins by code (normalised) once the code is complete", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/games/rock-paper-scissors" });
    const join = screen.getByRole("button", { name: "Join room" });

    await user.type(screen.getByRole("textbox", { name: "Room code" }), "ab2cd3");
    await user.click(join);

    // A visitor without a session first chooses how to join (CC-086).
    expect(
      await screen.findByRole("heading", { name: "You're invited to play Rock Paper Scissors" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AB2CD3")).toBeInTheDocument();
  });

  describe("playing the computer character (CC-221)", () => {
    it("makes Play Rocky the main action, starting at the easiest level with one tap", async () => {
      const user = userEvent.setup();
      const socket = fakeSocket();
      socket.request.mockImplementation(async (event) =>
        event === "room:play-computer" ? { code: "AB2CD3" } : new Promise(() => {}),
      );
      const { api } = renderApp({ path: "/games/rock-paper-scissors", socket });
      const panels = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);

      await user.click(screen.getByRole("button", { name: "Play Rocky" }));

      expect(panels[0]).toBe("Play Rocky");
      expect(api.startGuest).toHaveBeenCalledOnce();
      expect(socket.request).toHaveBeenCalledWith("room:play-computer", {
        gameId: "rps",
        level: "easy",
        options: {},
      });
      expect(await screen.findByText(/Joining room AB2CD3/)).toBeInTheDocument();
    });

    it("says before the game that the character is a computer and how its games count", () => {
      renderApp({ path: "/games/chess" });

      expect(screen.getByRole("heading", { name: "Play Queen Vee" })).toBeInTheDocument();
      expect(screen.getByText("Computer")).toBeInTheDocument();
      expect(screen.getByText(/count for quests and up to 100 XP a day/)).toBeInTheDocument();
      expect(screen.getByText(/never count on leaderboards/)).toBeInTheDocument();
    });

    it("plays at the level picked with one tap", async () => {
      const user = userEvent.setup();
      const socket = fakeSocket();
      socket.request.mockImplementation(async () => ({ code: "AB2CD3" }));
      renderApp({ path: "/games/tic-tac-toe", socket });
      const levels = screen.getByRole("group", { name: "Level" });

      await user.click(within(levels).getByRole("button", { name: "Unbeatable" }));

      expect(within(levels).getByRole("button", { name: "Unbeatable" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(within(levels).getByRole("button", { name: "Easy" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByText(/Never loses\. A draw is the best you can do\./)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Play Pip" }));
      expect(socket.request).toHaveBeenCalledWith("room:play-computer", {
        gameId: "tictactoe",
        level: "hard",
        options: {},
      });
    });

    it("answers a press of the level already picked by showing how it plays again (CC-164)", async () => {
      const user = userEvent.setup();
      renderApp({ path: "/games/rock-paper-scissors" });
      const line = () => screen.getByText(/Throws at random/).closest("p");
      const before = line();

      await user.click(
        within(screen.getByRole("group", { name: "Level" })).getByRole("button", { name: "Easy" }),
      );

      expect(line()).toHaveTextContent("Easy: Throws at random, so there is no habit to read.");
      expect(line()).not.toBe(before);
    });

    it("keeps inviting a friend as the second way to play", () => {
      renderApp({ path: "/games/rock-paper-scissors" });

      expect(screen.getByRole("heading", { name: "Play a friend" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create room" })).toHaveClass("secondary");
      expect(screen.getByRole("button", { name: "Play Rocky" })).toHaveClass("primary");
    });

    it("explains a failure under the button", async () => {
      const user = userEvent.setup();
      const socket = fakeSocket();
      socket.request.mockRejectedValue(new Error("Slow down"));
      renderApp({ path: "/games/rock-paper-scissors", socket });

      await user.click(screen.getByRole("button", { name: "Play Rocky" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Slow down");
    });
  });

  it("shows not-found for an unknown game", () => {
    renderApp({ path: "/games/ludo" });

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
