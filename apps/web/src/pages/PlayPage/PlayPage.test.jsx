import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeApi, fakeSocket } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";

/** Opens a lobby and waits for its cards, which come once the app knows its flags (CC-349). */
async function openLobby(options) {
  const app = renderApp(options);
  await screen.findByRole("heading", { level: 2, name: "Play a friend" });
  return app;
}

describe("PlayPage", () => {
  it("creates a room with the game's options (starting a guest first) and opens it", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockImplementation(async (event) =>
      event === "room:create" ? { code: "AB2CD3" } : new Promise(() => {}),
    );
    const { api } = await openLobby({ path: "/games/rock-paper-scissors", socket });

    await user.selectOptions(screen.getByRole("combobox", { name: /match length/i }), "5");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(socket.request).toHaveBeenCalledWith("room:create", { gameId: "rps", options: { bestOf: 5 } });
    expect(await screen.findByText(/Joining room AB2CD3/)).toBeInTheDocument();
  });

  it("makes a challenge link with the game's options and opens its page (CC-139)", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      createChallenge: vi.fn().mockResolvedValue({ id: "c0000000000000000001" }),
      getChallenge: vi.fn(() => new Promise(() => {})),
    });
    const { url } = await openLobby({ path: "/games/rock-paper-scissors", api });

    await user.selectOptions(screen.getByRole("combobox", { name: /match length/i }), "5");
    await user.click(screen.getByRole("button", { name: "Make a challenge link" }));

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(api.createChallenge).toHaveBeenCalledWith({ gameId: "rps", options: { bestOf: 5 } });
    expect(await screen.findByText("Opening the challenge…")).toBeInTheDocument();
    expect(url()).toBe("/challenge/c0000000000000000001");
  });

  it("shows the game's banner with its art and accent", () => {
    renderApp({ path: "/games/tic-tac-toe" });

    const banner = screen.getByRole("heading", { level: 1, name: "Tic Tac Toe" }).parentElement.parentElement;
    expect(banner).toHaveClass("tictactoe");
    expect(banner.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("offers chess time controls", async () => {
    await openLobby({ path: "/games/chess" });

    expect(screen.getByRole("combobox", { name: /clock for each player/i })).toHaveDisplayValue(
      "Blitz: 5 min each",
    );
  });

  it("creates a chess room with the chosen time control", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.request.mockImplementation(async (event) =>
      event === "room:create" ? { code: "AB2CD3" } : new Promise(() => {}),
    );
    await openLobby({ path: "/games/chess", socket });

    await user.selectOptions(
      screen.getByRole("combobox", { name: /clock for each player/i }),
      "Rapid: 15 min each, +10 s a move",
    );
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
    await openLobby({ path: "/games/tic-tac-toe", socket });

    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Slow down");
  });

  it("says what is missing when Join room is pressed before the code is complete (CC-164)", async () => {
    const user = userEvent.setup();
    const { url } = await openLobby({ path: "/games/rock-paper-scissors" });
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
    const { url } = await openLobby({ path: "/games/rock-paper-scissors" });

    await user.type(screen.getByRole("textbox", { name: "Room code" }), "ab2{Enter}");

    expect(url()).toBe("/games/rock-paper-scissors");
  });

  it("joins by code (normalised) once the code is complete", async () => {
    const user = userEvent.setup();
    await openLobby({ path: "/games/rock-paper-scissors" });
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
      const { api } = await openLobby({ path: "/games/rock-paper-scissors", socket });
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

    it("says before the game that the character is a computer and how its games count", async () => {
      await openLobby({ path: "/games/chess" });

      expect(screen.getByRole("heading", { name: "Play Queen Vee" })).toBeInTheDocument();
      expect(screen.getByText("Computer")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Wins here earn XP \(points that level you up\), up to 100 a day, and count for daily quests/,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/never count on leaderboards/)).toBeInTheDocument();
    });

    it("plays at the level picked with one tap", async () => {
      const user = userEvent.setup();
      const socket = fakeSocket();
      socket.request.mockImplementation(async () => ({ code: "AB2CD3" }));
      await openLobby({ path: "/games/tic-tac-toe", socket });
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
      await openLobby({ path: "/games/rock-paper-scissors" });
      const line = () => screen.getByText(/Throws at random/).closest("p");
      const before = line();

      await user.click(
        within(screen.getByRole("group", { name: "Level" })).getByRole("button", { name: "Easy" }),
      );

      expect(line()).toHaveTextContent("Easy: Throws at random, so there is no habit to read.");
      expect(line()).not.toBe(before);
    });

    it("keeps inviting a friend as the second way to play", async () => {
      await openLobby({ path: "/games/rock-paper-scissors" });

      expect(screen.getByRole("heading", { name: "Play a friend" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create room" })).toHaveClass("secondary");
      expect(screen.getByRole("button", { name: "Play Rocky" })).toHaveClass("primary");
    });

    it("explains a failure under the button", async () => {
      const user = userEvent.setup();
      const socket = fakeSocket();
      socket.request.mockRejectedValue(new Error("Slow down"));
      await openLobby({ path: "/games/rock-paper-scissors", socket });

      await user.click(screen.getByRole("button", { name: "Play Rocky" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Slow down");
    });
  });

  it("says under the title what the game is and the two ways to start (CC-349)", async () => {
    await openLobby({ path: "/games/chess" });

    expect(
      screen.getByText("Checkmate the other king to win. Play the computer now, or invite a friend."),
    ).toBeInTheDocument();
  });

  it("says what each way to play a friend does and where a code comes from (CC-349)", async () => {
    await openLobby({ path: "/games/tic-tac-toe" });

    expect(
      screen.getByText("Friend online now? You get a link to send. The game starts when they open it."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your friend sees a 6-character code on their invite. Type it here."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Two players, one phone. Nothing is sent or saved, and it gives no XP."),
    ).toBeInTheDocument();
  });

  it("names the rounds and the chess clocks in plain words (CC-349)", async () => {
    await openLobby({ path: "/games/rock-paper-scissors" });

    const rounds = screen.getByRole("combobox", { name: /match length/i });
    expect(
      within(rounds)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["1 round", "Best of 3 (first to 2)", "Best of 5 (first to 3)", "Best of 7 (first to 4)"]);
  });

  flagPaths("how_to_play", (on) => {
    it(
      on
        ? "shows How to play as one line between the title and the cards"
        : "keeps the steps under the cards",
      async () => {
        const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ how_to_play: on }) });
        const { container } = renderApp({ path: "/games/chess", api });

        // The cards come with the flag's answer, so everything below is checked after the answer.
        const panels = await screen.findByRole("heading", { level: 2, name: "Play a friend" });
        expect(api.getFlags).toHaveBeenCalledOnce();
        if (on) {
          const line = screen.getByText("How to play: 3 steps");
          // Before the cards in the page's order, so it is the first thing under the title.
          expect(line.compareDocumentPosition(panels) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
          expect(container.querySelector("details")).not.toHaveAttribute("open");
          expect(screen.queryByRole("region", { name: "How to play" })).not.toBeInTheDocument();
        } else {
          expect(await screen.findByRole("region", { name: "How to play" })).toBeInTheDocument();
          expect(screen.queryByText("How to play: 3 steps")).not.toBeInTheDocument();
        }
      },
    );

    it("draws the cards only with the flag's answer, so How to play never pushes them down", async () => {
      let answer;
      const api = fakeApi({ getFlags: vi.fn(() => new Promise((resolve) => (answer = resolve))) });
      renderApp({ path: "/games/rock-paper-scissors", api });

      await screen.findByRole("heading", { level: 1, name: "Rock Paper Scissors" });
      await vi.waitFor(() => expect(api.getFlags).toHaveBeenCalled());
      expect(screen.queryByRole("heading", { level: 2, name: "Play a friend" })).not.toBeInTheDocument();
      expect(screen.queryByText("How to play: 3 steps")).not.toBeInTheDocument();
      answer({ how_to_play: on });

      await screen.findByRole("heading", { level: 2, name: "Play a friend" });
      expect(screen.queryAllByText("How to play: 3 steps")).toHaveLength(on ? 1 : 0);
    });
  });

  it("shows not-found for an unknown game", () => {
    renderApp({ path: "/games/ludo" });

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
