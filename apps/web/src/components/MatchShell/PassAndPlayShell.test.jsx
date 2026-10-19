import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tictactoeEngine } from "@classicade/games/tictactoe";
import { PassAndPlayShell } from "./PassAndPlayShell.jsx";

/**
 * A board that only says whose view it was given, so the test can see what the shell hands it. Its one button asks
 * the other player something, as a board could in a room.
 */
const ViewerBoard = ({ room, onAsk }) => (
  <>
    <p>Board for {room.you}</p>
    <button type="button" onClick={() => onAsk("draw")}>
      Ask
    </button>
  </>
);

/** A game entry with one action that plays the centre cell without asking first, and no button style of its own. */
const GAME = Object.freeze({
  Board: ViewerBoard,
  actions: () => [
    {
      control: "fake.centre",
      label: "Play the centre",
      reason: "",
      intent: { type: "move", move: { cell: 4 } },
    },
  ],
  passAndPlay: Object.freeze({ loadEngine: async () => tictactoeEngine, handOver: false }),
});

beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0));
afterEach(() => vi.restoreAllMocks());

const renderShell = () =>
  render(
    <MemoryRouter>
      <PassAndPlayShell
        gameId="tictactoe"
        gameName="Tic Tac Toe"
        game={GAME}
        engine={tictactoeEngine}
        names={["Asha", "Ben"]}
        options={{}}
        onLeave={() => {}}
      />
    </MemoryRouter>,
  );

describe("PassAndPlayShell", () => {
  it("gives the board the view of the player holding the phone", async () => {
    renderShell();

    expect(await screen.findByText("Board for player-1")).toBeInTheDocument();
  });

  it("sends nothing anywhere when a board asks for something, because on one phone it is asked in person", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole("button", { name: "Ask" }));

    expect(screen.getByText("Board for player-1")).toBeInTheDocument();
  });

  it("runs a game action that does not ask first at once, and passes the phone on", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Play the centre" }));

    expect(await screen.findByText("Board for player-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play the centre" })).toHaveClass("secondary");
  });
});
