import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tictactoeEngine } from "@classicade/games/tictactoe";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { useServices } from "../../app/servicesContext.js";
import { fakeApi, fakeSocket } from "../../testing/fakes.js";
import { PassAndPlayShell } from "./PassAndPlayShell.jsx";

/**
 * A board that only says whose view it was given, so the test can see what the shell hands it. Ask asks the other
 * player something, as a board could in a room. "Send on purpose" goes to the server through the socket client, to
 * prove that the test notices a request when one is made.
 */
function ViewerBoard({ room, onAsk }) {
  const { socket } = useServices();
  return (
    <>
      <p>Board for {room.you}</p>
      <button type="button" onClick={() => onAsk("draw")}>
        Ask
      </button>
      <button type="button" onClick={() => socket.request("room:ask", { type: "draw" })}>
        Send on purpose
      </button>
    </>
  );
}

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

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in a pass and play test"));
});
afterEach(() => vi.restoreAllMocks());

/** Every call to the server the app could make: the API client, the socket client and `fetch`. */
const networkCalls = ({ api, socket }) =>
  [...Object.values(api), socket.connect, socket.request, socket.on, socket.onEndedByServer].reduce(
    (total, spy) => total + spy.mock.calls.length,
    globalThis.fetch.mock.calls.length,
  );

function renderShell({ howToPlay = false } = {}) {
  const services = { api: fakeApi(), socket: fakeSocket() };
  render(
    <ServicesProvider services={services}>
      <MemoryRouter>
        <PassAndPlayShell
          gameId="tictactoe"
          gameName="Tic Tac Toe"
          game={GAME}
          engine={tictactoeEngine}
          names={["Asha", "Ben"]}
          options={{}}
          onLeave={() => {}}
          howToPlay={howToPlay}
        />
      </MemoryRouter>
    </ServicesProvider>,
  );
  return services;
}

describe("PassAndPlayShell", () => {
  it("gives the board the view of the player holding the phone", async () => {
    renderShell();

    expect(await screen.findByText("Board for player-1")).toBeInTheDocument();
  });

  it("sends nothing anywhere when a board asks for something, because on one phone it is asked in person", async () => {
    const user = userEvent.setup();
    const services = renderShell();

    await user.click(await screen.findByRole("button", { name: "Ask" }));

    expect(networkCalls(services)).toBe(0);
    expect(screen.getByText("Board for player-1")).toBeInTheDocument();
  });

  it("shows How to play in the match bar when it is on, and opening it sends nothing (CC-349)", async () => {
    const user = userEvent.setup();
    const services = renderShell({ howToPlay: true });

    await user.click(await screen.findByRole("button", { name: "How to play" }));

    expect(screen.getByRole("dialog", { name: "How to play Tic Tac Toe" })).toBeInTheDocument();
    expect(networkCalls(services)).toBe(0);
  });

  it("shows no How to play when it is off", async () => {
    renderShell();

    expect(await screen.findByText("Board for player-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "How to play" })).toBeNull();
  });

  it("notices a request to the server when one is made on purpose, so the test above can fail", async () => {
    const user = userEvent.setup();
    const services = renderShell();

    await user.click(await screen.findByRole("button", { name: "Send on purpose" }));

    expect(networkCalls(services)).toBe(1);
  });

  it("runs a game action that does not ask first at once, and passes the phone on", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Play the centre" }));

    expect(await screen.findByText("Board for player-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play the centre" })).toHaveClass("secondary");
  });
});
