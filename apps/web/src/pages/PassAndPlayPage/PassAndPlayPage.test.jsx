import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";

/**
 * Every call the app could make to the server, counted, so a test can say that a game on one phone made none
 * (CC-223). The socket client and the API client are the only ways out (ENGINEERING.md, frontend), and `fetch` is
 * watched too in case anything went around them.
 */
function networkCalls({ api, socket }) {
  const spies = [...Object.values(api), socket.connect, socket.request, socket.on, socket.onEndedByServer];
  return spies.reduce((total, spy) => total + spy.mock.calls.length, 0) + globalThis.fetch.mock.calls.length;
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in a pass and play test"));
});
afterEach(() => vi.restoreAllMocks());

/** Opens the setup, types the names and starts. Returns the app and how many calls it had made by then. */
async function startGame(user, { slug, names = ["Asha", "Ben"], api = fakeApi() }) {
  const app = renderApp({ path: `/games/${slug}/pass-and-play`, api });
  const start = await screen.findByRole("button", { name: "Start game" });
  if (names[0] !== "") await user.type(screen.getByRole("textbox", { name: "Player 1" }), names[0]);
  if (names[1] !== "") await user.type(screen.getByRole("textbox", { name: "Player 2" }), names[1]);
  await vi.waitFor(() => expect(start).not.toHaveAttribute("aria-disabled"));
  await user.click(start);
  // The board loads on demand, as in a room.
  await vi.waitFor(() => expect(screen.queryByText("Loading the board…")).not.toBeInTheDocument(), {
    timeout: 5_000,
  });
  // The usage counts host loads once the page is idle and asks its flag then (CC-322): that is the page's start.
  await vi.waitFor(() => expect(app.api.getFlags).toHaveBeenCalledWith(["telemetry_client"]), {
    timeout: 5_000,
  });
  return { app, before: networkCalls(app) };
}

const matchBar = () => document.querySelector("[data-cc-slot='match-bar']");
const phase = () => document.querySelector("[data-cc-phase]").dataset.ccPhase;

async function choose(user, name, choice) {
  await user.click(screen.getByRole("button", { name: `I'm ${name}, show my turn` }));
  await user.click(await screen.findByRole("button", { name: choice }));
}

describe("the lobby's way in", () => {
  it.each([
    ["rock-paper-scissors", "Rock Paper Scissors"],
    ["tic-tac-toe", "Tic Tac Toe"],
    ["chess", "Chess"],
  ])("offers pass and play in the %s lobby", async (slug, name) => {
    const user = userEvent.setup();
    const { url } = renderApp({ path: `/games/${slug}` });

    await user.click(screen.getByRole("link", { name: "Play on this phone" }));

    expect(url()).toBe(`/games/${slug}/pass-and-play`);
    expect(screen.getByRole("heading", { level: 1, name: `${name}: pass and play` })).toBeInTheDocument();
  });
});

describe("PassAndPlayPage setup", () => {
  it("is not found for a game it does not know", () => {
    renderApp({ path: "/games/ludo/pass-and-play" });

    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent("pass and play");
  });

  it("replaces another spelling of the address with the canonical one", () => {
    const { url } = renderApp({ path: "/games/rps/pass-and-play" });

    expect(url()).toBe("/games/rock-paper-scissors/pass-and-play");
  });

  it("says why it cannot start while the two names read the same", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/games/tic-tac-toe/pass-and-play" });
    const start = await screen.findByRole("button", { name: "Start game" });
    await vi.waitFor(() => expect(start).not.toHaveAttribute("aria-disabled"));

    await user.type(screen.getByRole("textbox", { name: "Player 1" }), "Asha");
    await user.type(screen.getByRole("textbox", { name: "Player 2" }), "asha");

    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(start).toHaveAccessibleDescription("Choose two different names");
  });

  it("plays as Player 1 and Player 2 when no names are typed", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { before, app } = await startGame(user, { slug: "tic-tac-toe", names: ["", ""] });

    expect(within(matchBar()).getByText("Player 1's turn")).toBeInTheDocument();
    expect(networkCalls(app)).toBe(before);
  });

  it("starts with the game's own options, such as the match length", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/games/rock-paper-scissors/pass-and-play" });
    await user.selectOptions(screen.getByRole("combobox", { name: /match length/i }), "1");
    const start = screen.getByRole("button", { name: "Start game" });
    await vi.waitFor(() => expect(start).not.toHaveAttribute("aria-disabled"));

    await user.click(start);
    await choose(user, "Player 1", "Paper");
    await choose(user, "Player 2", "Rock");

    expect(await screen.findByRole("heading", { level: 2, name: /Player 1 won/ })).toBeInTheDocument();
  });

  it("never keeps the names: nothing in the address and nothing in web storage", async () => {
    const user = userEvent.setup();
    const { app } = await startGame(user, { slug: "chess" });

    expect(app.url()).toBe("/games/chess/pass-and-play");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/Asha|Ben/);
  });
});

describe("Rock Paper Scissors on one phone", () => {
  it("covers each choice with a pass the phone screen and plays a whole match without the network", async () => {
    const user = userEvent.setup();
    const { app, before } = await startGame(user, { slug: "rock-paper-scissors" });

    expect(phase()).toBe("hand-over");
    expect(screen.getByRole("heading", { name: "Pass the phone to Asha" })).toBeInTheDocument();
    await choose(user, "Asha", "Rock");

    expect(screen.getByRole("heading", { name: "Pass the phone to Ben" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Your choice" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-cc-slot='stage']")).not.toHaveTextContent(/rock/i);
    await choose(user, "Ben", "Scissors");

    expect(
      screen.getByText(/Round 1: Asha played Rock, Ben played Scissors\. Asha won the round\./),
    ).toBeVisible();
    await choose(user, "Asha", "Paper");
    await choose(user, "Ben", "Rock");

    expect(phase()).toBe("finished");
    expect(screen.getByRole("heading", { level: 2, name: "Asha won the best of 3" })).toBeInTheDocument();
    expect(screen.getByText(/Not counted: games on one phone give no XP/)).toBeInTheDocument();
    expect(networkCalls(app)).toBe(before);
  });

  it("moves focus to each new screen and reads it out politely", async () => {
    const user = userEvent.setup();
    await startGame(user, { slug: "rock-paper-scissors" });
    const polite = () => document.querySelector("[data-cc-slot='announcer'] [aria-live='polite']");

    expect(screen.getByRole("heading", { name: "Pass the phone to Asha" })).toHaveFocus();
    expect(polite()).toHaveTextContent("Pass the phone to Asha");
    await user.click(screen.getByRole("button", { name: "I'm Asha, show my turn" }));

    expect(await screen.findByRole("region", { name: "Asha's turn" })).toHaveFocus();
    expect(polite()).toHaveTextContent("Asha's turn");
    await user.click(await screen.findByRole("button", { name: "Rock" }));

    expect(screen.getByRole("heading", { name: "Pass the phone to Ben" })).toHaveFocus();
    expect(polite()).toHaveTextContent("Pass the phone to Ben");
  });

  it("plays again with the same names, covered again from the start", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/games/rock-paper-scissors/pass-and-play" });
    await user.selectOptions(screen.getByRole("combobox", { name: /match length/i }), "1");
    const start = screen.getByRole("button", { name: "Start game" });
    await vi.waitFor(() => expect(start).not.toHaveAttribute("aria-disabled"));
    await user.click(start);
    await choose(user, "Player 1", "Rock");
    await choose(user, "Player 2", "Paper");

    await user.click(screen.getByRole("button", { name: "Play again" }));

    expect(phase()).toBe("hand-over");
    expect(screen.getByRole("heading", { name: "Pass the phone to Player 1" })).toBeInTheDocument();
  });
});

describe("Tic-Tac-Toe on one phone", () => {
  it("names whose turn it is and plays a whole game without the network", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { app, before } = await startGame(user, { slug: "tic-tac-toe" });
    const cell = (name) => screen.getByRole("gridcell", { name: new RegExp(`^${name}:`) });

    expect(within(matchBar()).getByText("Asha's turn")).toBeInTheDocument();
    await user.click(cell("top left"));
    expect(within(matchBar()).getByText("Ben's turn")).toBeInTheDocument();
    await user.click(cell("middle left"));
    await user.click(cell("top centre"));
    await user.click(cell("middle centre"));
    await user.click(cell("top right"));

    expect(
      screen.getByRole("heading", { level: 2, name: "Asha won with three in a row" }),
    ).toBeInTheDocument();
    expect(within(matchBar()).getByText("Not counted")).toBeInTheDocument();
    expect(networkCalls(app)).toBe(before);
  });

  it("says why a taken cell cannot be played, in the engine's words", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    await startGame(user, { slug: "tic-tac-toe" });
    const topLeft = () => screen.getByRole("gridcell", { name: /^top left:/ });
    await user.click(topLeft());

    await user.click(topLeft());

    expect(screen.getAllByText("Cell taken").length).toBeGreaterThan(0);
  });

  it("asks before leaving a game that is on, and leaves for the lobby", async () => {
    const user = userEvent.setup();
    const { app } = await startGame(user, { slug: "tic-tac-toe" });

    await user.click(screen.getByRole("button", { name: "Leave game" }));
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(app.url()).toBe("/games/tic-tac-toe/pass-and-play");

    await user.click(screen.getByRole("button", { name: "Leave game" }));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(app.url()).toBe("/games/tic-tac-toe");
  });

  it("goes back to the lobby from the result without asking", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { app } = await startGame(user, { slug: "tic-tac-toe" });
    for (const name of ["top left", "middle left", "top centre", "middle centre", "top right"]) {
      await user.click(screen.getByRole("gridcell", { name: new RegExp(`^${name}:`) }));
    }

    await user.click(screen.getByRole("button", { name: "Back to the lobby" }));

    expect(app.url()).toBe("/games/tic-tac-toe");
  });
});

describe("Chess on one phone", () => {
  /** Moves a piece by clicking it and then its target. */
  async function move(user, from, to) {
    await user.click(screen.getByRole("gridcell", { name: new RegExp(`^${from}, `) }));
    await user.click(screen.getByRole("gridcell", { name: new RegExp(`^${to}, legal move`) }));
  }

  it("keeps the board still, White at the bottom, and plays a whole game without the network", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { app, before } = await startGame(user, { slug: "chess" });
    const board = await screen.findByRole("grid", { name: "Chess board" });
    const firstSquare = () => within(board).getAllByRole("gridcell")[0];

    expect(firstSquare()).toHaveAccessibleName(/^a8/);
    await move(user, "f2", "f3");
    expect(firstSquare()).toHaveAccessibleName(/^a8/);
    expect(within(matchBar()).getByText("Ben (Black) to move")).toBeInTheDocument();
    await move(user, "e7", "e5");
    await move(user, "g2", "g4");
    await move(user, "d8", "h4");

    expect(screen.getByRole("heading", { level: 2, name: "Ben won by checkmate" })).toBeInTheDocument();
    expect(networkCalls(app)).toBe(before);
  });

  it("asks who resigns, names who then wins, and lets the side to move resign", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    await startGame(user, { slug: "chess" });

    await user.click(await screen.findByRole("button", { name: "Resign" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Resign for Asha: Ben wins.");
    expect(dialog).toHaveTextContent("Resign for Ben: Asha wins.");
    await user.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(phase()).toBe("playing");
    await user.click(screen.getByRole("button", { name: "Resign" }));
    await user.click(screen.getByRole("button", { name: "Resign for Asha" }));

    expect(screen.getByRole("heading", { level: 2, name: "Ben won by resignation" })).toBeInTheDocument();
  });

  it("lets the player who is not to move resign as well", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    await startGame(user, { slug: "chess" });

    await user.click(await screen.findByRole("button", { name: "Resign" }));
    await user.click(screen.getByRole("button", { name: "Resign for Ben" }));

    expect(screen.getByRole("heading", { level: 2, name: "Asha won by resignation" })).toBeInTheDocument();
  });

  it("names both players on the board, never You, and says who moves with which colour", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    await startGame(user, { slug: "chess" });
    const stage = document.querySelector("[data-cc-slot='stage']");

    expect(within(matchBar()).getByText("Asha (White) to move")).toBeInTheDocument();
    expect(within(stage).queryByText("You")).not.toBeInTheDocument();
    expect(within(stage).queryByText("Your turn")).not.toBeInTheDocument();
    expect(within(stage).getByText("Asha")).toBeInTheDocument();
    expect(within(stage).getByText("Ben")).toBeInTheDocument();
    await move(user, "e2", "e4");

    expect(within(matchBar()).getByText("Ben (Black) to move")).toBeInTheDocument();
    expect(within(stage).queryByText("You")).not.toBeInTheDocument();
  });

  it("ends in a draw only when the other player accepts in person", async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    await startGame(user, { slug: "chess" });

    await user.click(await screen.findByRole("button", { name: "Offer draw" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Asha offers a draw. Ben, do you accept?");
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(phase()).toBe("playing");

    await user.click(screen.getByRole("button", { name: "Offer draw" }));
    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(document.getElementById("result-heading")).toHaveTextContent("Draw by agreement");
  });
});

describe("How to play in a game on one phone (CC-349)", () => {
  flagPaths("how_to_play", (on) => {
    it(on ? "is one press away, and opening it sends nothing" : "is not in the match bar", async () => {
      const user = userEvent.setup();
      const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ how_to_play: on }) });
      const { app, before } = await startGame(user, { slug: "chess", api });

      const button = screen.queryByRole("button", { name: "How to play" });
      if (on) {
        await user.click(button);
        expect(screen.getByRole("dialog", { name: "How to play Chess" })).toBeInTheDocument();
      } else {
        expect(button).toBeNull();
      }
      expect(networkCalls(app)).toBe(before);
    });
  });
});
