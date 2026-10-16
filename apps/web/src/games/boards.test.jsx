import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChessBoard } from "./chess/ChessBoard.jsx";
import { formatClock, useChessClocks } from "./chess/useChessClocks.js";
import { RpsBoard } from "./rps/RpsBoard.jsx";
import { TicTacToeBoard } from "./tictactoe/TicTacToeBoard.jsx";

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
    screen.getAllByRole("button").forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByText("Waiting for Riya")).toBeInTheDocument();
  });

  it("shows the server's reason when a move is refused", async () => {
    const user = userEvent.setup();
    render(
      <RpsBoard room={room(rpsView())} onMove={vi.fn().mockRejectedValue(new Error("You already chose"))} />,
    );

    await user.click(screen.getByRole("button", { name: /rock/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You already chose");
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
    expect(screen.getByRole("gridcell", { name: "middle centre: O" })).toBeDisabled();
    expect(screen.getByText("You play X")).toBeInTheDocument();
  });

  it("disables the board when it is not your turn", () => {
    const view = tttView({ turn: THEM });
    render(
      <TicTacToeBoard
        room={room(view, { game: { view, activePlayers: [THEM], outcome: { status: "ongoing" } } })}
        onMove={vi.fn()}
      />,
    );

    screen.getAllByRole("gridcell").forEach((cell) => expect(cell).toBeDisabled());
    expect(screen.getByText("Waiting for Riya")).toBeInTheDocument();
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
});

describe("ChessBoard", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const chessView = (overrides = {}) => ({
    fen: START,
    moves: [],
    lastMove: {},
    colors: { [ME]: "w", [THEM]: "b" },
    toMove: ME,
    inCheck: false,
    timeControl: "blitz-5+0",
    clocks: { w: 300_000, b: 300_000 },
    lastMoveAt: 0,
    drawOfferBy: "",
    ...overrides,
  });

  it("highlights legal moves after selecting a piece, then sends the move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    await user.click(screen.getByRole("gridcell", { name: "e2, white pawn" }));
    expect(screen.getByRole("gridcell", { name: "e4, legal move" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "e3, legal move" })).toBeInTheDocument();
    await user.click(screen.getByRole("gridcell", { name: "e4, legal move" }));

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4" });
  });

  it("shows the board from Black's side for the Black player", () => {
    render(
      <ChessBoard
        room={room(chessView({ colors: { [ME]: "b", [THEM]: "w" }, toMove: THEM }))}
        onMove={vi.fn()}
      />,
    );

    const firstSquare = screen.getAllByRole("gridcell")[0];
    expect(firstSquare).toHaveAccessibleName("h1, white rook");
  });

  it("asks which piece to promote to", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    const promotable = chessView({ fen: "7k/1P6/8/8/8/8/8/K7 w - - 0 1" });
    render(<ChessBoard room={room(promotable)} onMove={onMove} />);

    await user.click(screen.getByRole("gridcell", { name: "b7, white pawn" }));
    await user.click(screen.getByRole("gridcell", { name: "b8, legal move" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Promote to" })).getByRole("button", { name: "knight" }),
    );

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "b7", to: "b8", promotion: "n" });
  });

  it("confirms before resigning", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    await user.click(screen.getByRole("button", { name: "Resign" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Resign this game?" })).getByRole("button", {
        name: "Resign",
      }),
    );

    expect(onMove).toHaveBeenCalledWith({ type: "resign" });
  });

  it("offers a draw, and lets you accept the opponent's offer", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    const { rerender } = render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    await user.click(screen.getByRole("button", { name: "Offer draw" }));
    expect(onMove).toHaveBeenLastCalledWith({ type: "offer-draw" });

    rerender(<ChessBoard room={room(chessView({ drawOfferBy: THEM }))} onMove={onMove} />);
    expect(screen.getByText("Riya offers a draw.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept draw" }));
    expect(onMove).toHaveBeenLastCalledWith({ type: "accept-draw" });
  });

  it("shows the move list in pairs", () => {
    render(<ChessBoard room={room(chessView({ moves: ["e4", "e5", "Nf3"] }))} onMove={vi.fn()} />);

    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["e4e5", "Nf3"]);
  });
});

describe("chess clocks", () => {
  function Clock(props) {
    const clocks = useChessClocks(props);
    return <p>{`${clocks.w}|${clocks.b}`}</p>;
  }

  it("counts down the running side in server time, ignoring the local clock's drift", () => {
    vi.useFakeTimers();
    let local = 5_000_000; // local clock is 4 000 s ahead of the server: it must not matter
    const now = () => local;
    render(
      <Clock
        clocks={{ w: 60_000, b: 60_000 }}
        lastMoveAt={1_000_000 - 2_000}
        running="b"
        serverTime={1_000_000}
        now={now}
      />,
    );
    expect(screen.getByText("60000|58000")).toBeInTheDocument(); // 2 s already used when the view arrived

    act(() => {
      local += 1_000;
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("60000|57000")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("never shows negative time, and freezes when no clock is running", () => {
    render(<Clock clocks={{ w: 1_000, b: 2_000 }} lastMoveAt={0} running="" serverTime={0} />);

    expect(screen.getByText("1000|2000")).toBeInTheDocument();
  });

  it.each([
    [300_000, "5:00"],
    [65_000, "1:05"],
    [9_400, "0:09.4"],
    [-5, "0:00.0"],
  ])("formats %i ms as %s", (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});
