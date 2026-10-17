import { act, fireEvent, render as renderPlain, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../lib/errors.js";
import { gameView } from "./registry.js";
import { RpsBoard } from "./rps/RpsBoard.jsx";
import { TicTacToeBoard } from "./tictactoe/TicTacToeBoard.jsx";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { fakeSound } from "../testing/fakes.js";

// Boards may play sounds (the chess clock ticks), so they get a fake sound player.
const Services = ({ children }) => (
  <ServicesProvider services={{ sound: fakeSound() }}>{children}</ServicesProvider>
);
const render = (ui, options) => renderPlain(ui, { wrapper: Services, ...options });

const ME = "guest_me";
const THEM = "guest_them";
const seats = [
  { playerId: ME, displayName: "Me", connected: true },
  { playerId: THEM, displayName: "Riya", connected: true },
];
const room = (view, overrides = {}) => ({
  code: "AB2CD3",
  status: "playing",
  you: ME,
  hostId: ME,
  seats,
  players: { min: 2, max: 2 },
  serverTime: 1_000_000,
  game: { view, activePlayers: [ME], outcome: { status: "ongoing" } },
  ...overrides,
});

describe("RpsBoard", () => {
  const rpsView = (overrides = {}) => ({
    bestOf: 3,
    score: { [ME]: 1, [THEM]: 0 },
    round: 2,
    rounds: [{ choices: { [ME]: "rock", [THEM]: "scissors" }, winner: ME }],
    hasChosen: { [ME]: false, [THEM]: true },
    yourChoice: "",
    ...overrides,
  });

  it("sends the chosen move and shows score, round and history", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<RpsBoard room={room(rpsView())} onMove={onMove} />);

    await user.click(screen.getByRole("button", { name: /paper/i }));

    expect(onMove).toHaveBeenCalledWith({ choice: "paper" });
    expect(screen.getByLabelText("Score")).toHaveTextContent("You 1 — Riya 0");
    expect(screen.getByRole("heading", { name: "Round 2" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Rounds" })).getByText("You won")).toBeInTheDocument();
  });

  it("shows only that the opponent has chosen", () => {
    render(<RpsBoard room={room(rpsView())} onMove={vi.fn()} />);

    expect(screen.getByText("Riya has chosen")).toBeInTheDocument();
  });

  it("marks your pending choice and locks the buttons until the round resolves", () => {
    const view = rpsView({ yourChoice: "rock", hasChosen: { [ME]: true, [THEM]: false } });
    render(
      <RpsBoard
        room={room(view, { game: { view, activePlayers: [THEM], outcome: { status: "ongoing" } } })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /rock/i })).toHaveAttribute("aria-pressed", "true");
    screen
      .getAllByRole("button")
      .forEach((button) => expect(button).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByText("Waiting for Riya")).toBeInTheDocument();
  });

  it("says who you are waiting for when a hand is pressed after choosing, and sends nothing (CC-164)", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const view = rpsView({ yourChoice: "rock", hasChosen: { [ME]: true, [THEM]: false } });
    render(
      <RpsBoard
        room={room(view, { game: { view, activePlayers: [THEM], outcome: { status: "ongoing" } } })}
        onMove={onMove}
      />,
    );

    await user.click(screen.getByRole("button", { name: /paper/i }));

    expect(onMove).not.toHaveBeenCalled();
    expect(within(screen.getAllByRole("status").at(-1)).getByText("Waiting for Riya")).toBeInTheDocument();
  });

  it("lights up the pressed hand at once and says it is sending while the server is slow", async () => {
    const user = userEvent.setup();
    render(<RpsBoard room={room(rpsView())} onMove={() => new Promise(() => {})} />);

    await user.click(screen.getByRole("button", { name: /paper/i }));
    await user.click(screen.getByRole("button", { name: /rock/i }));

    expect(screen.getByRole("button", { name: /paper/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Sending your choice")).toBeInTheDocument();
  });

  it("marks the pressed hand busy once the answer is slow", async () => {
    vi.useFakeTimers();
    try {
      render(<RpsBoard room={room(rpsView())} onMove={() => new Promise(() => {})} />);

      await act(async () => fireEvent.click(screen.getByRole("button", { name: /paper/i })));
      await act(async () => vi.advanceTimersByTime(200));

      expect(screen.getByRole("button", { name: /paper/i })).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: /rock/i })).not.toHaveAttribute("aria-busy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the board's own reason, such as reconnecting", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<RpsBoard room={room(rpsView())} onMove={onMove} reason="Reconnecting" />);

    await user.click(screen.getByRole("button", { name: /rock/i }));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
  });

  it("shows a drawn round, a missing score as 0, and someone no longer seated as 'Opponent'", () => {
    const view = rpsView({
      score: { [ME]: 1 },
      rounds: [
        { choices: { [ME]: "rock", [THEM]: "rock" }, winner: "" },
        { choices: { [ME]: "rock", [THEM]: "paper" }, winner: "guest_gone" },
      ],
    });
    render(<RpsBoard room={room(view)} onMove={vi.fn()} />);

    expect(screen.getByLabelText("Score")).toHaveTextContent("You 1 — Riya 0");
    const rounds = within(screen.getByRole("list", { name: "Rounds" }));
    expect(rounds.getByText("Draw")).toBeInTheDocument();
    expect(rounds.getByText("Opponent won")).toBeInTheDocument();
  });

  it("shows '?' for a choice this version of the app doesn't know", () => {
    const view = rpsView({ rounds: [{ choices: { [ME]: "rock", [THEM]: "lizard" }, winner: THEM }] });
    render(<RpsBoard room={room(view)} onMove={vi.fn()} />);

    expect(screen.getByTitle("Riya: lizard")).toHaveTextContent("?");
  });

  it("plays the last round out as two hands, hidden from screen readers", () => {
    const { container } = render(<RpsBoard room={room(rpsView())} onMove={vi.fn()} />);

    const reveal = container.querySelector(".reveal");
    expect(reveal).toHaveAttribute("aria-hidden", "true");
    expect([...reveal.querySelectorAll(".who")].map((who) => who.textContent)).toEqual(["You", "Riya"]);
    expect(reveal.querySelectorAll(".shaker")).toHaveLength(2);
    expect(reveal.querySelectorAll(".shown")).toHaveLength(2);
    expect(reveal.children[1]).toHaveClass("mirrored");
  });

  it("shows no reveal before the first round, and '?' in it for an unknown choice", () => {
    const first = render(<RpsBoard room={room(rpsView({ rounds: [] }))} onMove={vi.fn()} />);
    expect(first.container.querySelector(".reveal")).toBeNull();
    first.unmount();

    const view = rpsView({ rounds: [{ choices: { [ME]: "rock", [THEM]: "lizard" }, winner: THEM }] });
    const { container } = render(<RpsBoard room={room(view)} onMove={vi.fn()} />);

    expect(container.querySelector(".reveal").children[1]).toHaveTextContent("?");
  });

  it("draws each move button with its hand, keeping the word as its name", () => {
    render(<RpsBoard room={room(rpsView())} onMove={vi.fn()} />);

    for (const name of ["Rock", "Paper", "Scissors"]) {
      const button = screen.getByRole("button", { name });
      expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("hides the choices once the match is over, keeping the history", () => {
    render(<RpsBoard room={room(rpsView(), { status: "finished" })} onMove={vi.fn()} />);

    expect(screen.queryByRole("group", { name: "Your choice" })).toBeNull();
    expect(screen.getByRole("list", { name: "Rounds" })).toBeInTheDocument();
  });

  it("shows the server's reason when a move is refused", async () => {
    const user = userEvent.setup();
    render(
      <RpsBoard room={room(rpsView())} onMove={vi.fn().mockRejectedValue(new Error("You already chose"))} />,
    );

    await user.click(screen.getByRole("button", { name: /rock/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You already chose");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("offers Retry when the connection lost the choice, and sends it again", async () => {
    const user = userEvent.setup();
    const onMove = vi
      .fn()
      .mockRejectedValueOnce(
        new AppRequestError({ code: "TIMEOUT", message: "The server took too long to answer" }),
      )
      .mockResolvedValue({});
    render(<RpsBoard room={room(rpsView())} onMove={onMove} />);

    await user.click(screen.getByRole("button", { name: /scissors/i }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(onMove).toHaveBeenNthCalledWith(2, { choice: "scissors" });
    expect(onMove).toHaveBeenCalledTimes(2);
  });
});

describe("TicTacToeBoard", () => {
  const tttView = (overrides = {}) => ({
    board: ["X", "", "", "", "O", "", "", "", ""],
    marks: { [ME]: "X", [THEM]: "O" },
    turn: ME,
    winningLine: [],
    ...overrides,
  });

  it("sends the clicked cell and labels every cell for screen readers", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<TicTacToeBoard room={room(tttView())} onMove={onMove} />);

    await user.click(screen.getByRole("gridcell", { name: "top right: empty" }));

    expect(onMove).toHaveBeenCalledWith({ cell: 2 });
    expect(screen.getByRole("gridcell", { name: "middle centre: O" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("You play X")).toBeInTheDocument();
  });

  it("shows your mark in the pressed cell at once, before the server answers (CC-164)", async () => {
    const user = userEvent.setup();
    render(<TicTacToeBoard room={room(tttView())} onMove={() => new Promise(() => {})} />);

    await user.click(screen.getByRole("gridcell", { name: "top right: empty" }));

    const cell = screen.getByRole("gridcell", { name: "top right: X, sending" });
    expect(cell).toHaveClass("sending");
    expect(cell.querySelector("svg")).not.toBeNull();
  });

  it("marks the sending cell busy once the answer is slow, and explains a second press", async () => {
    vi.useFakeTimers();
    try {
      render(<TicTacToeBoard room={room(tttView())} onMove={() => new Promise(() => {})} />);

      await act(async () => fireEvent.click(screen.getByRole("gridcell", { name: "top right: empty" })));
      await act(async () => vi.advanceTimersByTime(200));
      fireEvent.click(screen.getByRole("gridcell", { name: "bottom left: empty" }));

      expect(screen.getByRole("gridcell", { name: "top right: X, sending" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      expect(screen.getByText("Sending your move")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a used cell is taken when pressed, and sends nothing", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<TicTacToeBoard room={room(tttView())} onMove={onMove} />);

    await user.click(screen.getByRole("gridcell", { name: "middle centre: O" }));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText("Cell taken")).toBeInTheDocument();
  });

  it("shows the reason again on every press, even when the words are the same", async () => {
    const user = userEvent.setup();
    render(<TicTacToeBoard room={room(tttView())} onMove={vi.fn()} />);
    const taken = screen.getByRole("gridcell", { name: "middle centre: O" });

    await user.click(taken);
    const first = screen.getByText("Cell taken");
    await user.click(taken);

    expect(screen.getByText("Cell taken")).not.toBe(first);
  });

  it("disables the board when it is not your turn", () => {
    const view = tttView({ turn: THEM });
    render(
      <TicTacToeBoard
        room={room(view, { game: { view, activePlayers: [THEM], outcome: { status: "ongoing" } } })}
        onMove={vi.fn()}
      />,
    );

    screen.getAllByRole("gridcell").forEach((cell) => expect(cell).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByText("Waiting for Riya")).toBeInTheDocument();
  });

  it("says it is not your turn when a cell is pressed on the opponent's turn", async () => {
    const user = userEvent.setup();
    const view = tttView({ turn: THEM });
    render(
      <TicTacToeBoard
        room={room(view, { game: { view, activePlayers: [THEM], outcome: { status: "ongoing" } } })}
        onMove={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("gridcell", { name: "top right: empty" }));

    expect(screen.getByText("Not your turn")).toBeInTheDocument();
  });

  it("shows the server's reason when a move is refused", async () => {
    const user = userEvent.setup();
    render(
      <TicTacToeBoard
        room={room(tttView())}
        onMove={vi.fn().mockRejectedValue(new Error("That cell is taken"))}
      />,
    );

    await user.click(screen.getByRole("gridcell", { name: "top right: empty" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That cell is taken");
  });

  it("highlights the winning line", () => {
    const view = tttView({
      board: ["X", "X", "X", "O", "O", "", "", "", ""],
      turn: "",
      winningLine: [0, 1, 2],
    });
    const { container } = render(
      <TicTacToeBoard room={room(view, { status: "finished" })} onMove={vi.fn()} />,
    );

    expect(container.querySelectorAll(".win")).toHaveLength(3);
  });

  it("draws X and O as art that draws itself in, and a mark it doesn't know as its letter", () => {
    const view = tttView({ board: ["X", "O", "Z", "", "", "", "", "", ""] });
    render(<TicTacToeBoard room={room(view)} onMove={vi.fn()} />);

    const svgIn = (name) => screen.getByRole("gridcell", { name }).querySelector("svg");
    expect(svgIn("top left: X")).toHaveAttribute("aria-hidden", "true");
    expect(svgIn("top left: X").querySelectorAll(".draw")).toHaveLength(2);
    expect(svgIn("top centre: O").querySelector("circle")).toHaveClass("draw");
    expect(screen.getByRole("gridcell", { name: "top right: Z" })).toHaveTextContent("Z");
    expect(svgIn("middle left: empty")).toBeNull();
  });
});

describe("game registry", () => {
  it.each([
    [
      "rps",
      "group",
      "Your choice",
      { bestOf: 3, score: {}, round: 1, rounds: [], hasChosen: {}, yourChoice: "" },
    ],
    [
      "tictactoe",
      "grid",
      "Tic-Tac-Toe board",
      { board: Array(9).fill(""), marks: { [ME]: "X" }, turn: ME, winningLine: [] },
    ],
    [
      "chess",
      "grid",
      "Chess board",
      {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        moves: [],
        lastMove: {},
        colors: { [ME]: "w" },
        toMove: ME,
        inCheck: false,
        clocks: { w: 1, b: 1 },
        lastMoveAt: 0,
        drawOfferBy: "",
      },
    ],
  ])("loads the %s board on demand", async (gameId, role, name, view) => {
    const { Board } = gameView(gameId);
    render(
      <Suspense fallback={<p>Loading the board…</p>}>
        <Board room={room(view)} onMove={vi.fn()} />
      </Suspense>,
    );

    // The first load compiles the board and its libraries, which takes a while under coverage.
    expect(await screen.findByRole(role, { name }, { timeout: 10_000 })).toBeInTheDocument();
  });

  it("has nothing for a game this build doesn't know", () => {
    expect(gameView("ludo")).toEqual({});
  });
});
