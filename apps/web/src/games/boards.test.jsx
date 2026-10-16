import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChessBoard } from "./chess/ChessBoard.jsx";
import { formatClock, useChessClocks } from "./chess/useChessClocks.js";
import { gameView } from "./registry.js";
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

  it("deselects a piece when it is clicked again or an unreachable square is clicked", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    const pawn = screen.getByRole("gridcell", { name: "e2, white pawn" });

    await user.click(pawn);
    expect(pawn).toHaveAttribute("aria-pressed", "true");
    await user.click(pawn);
    expect(pawn).toHaveAttribute("aria-pressed", "false");

    await user.click(pawn);
    await user.click(screen.getByRole("gridcell", { name: "a5" }));
    expect(pawn).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("gridcell", { name: /legal move/ })).toBeNull();
  });

  it("switches the selection to another of your pieces", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);

    await user.click(screen.getByRole("gridcell", { name: "e2, white pawn" }));
    await user.click(screen.getByRole("gridcell", { name: "g1, white knight" }));

    expect(screen.getByRole("gridcell", { name: "f3, legal move" })).toBeInTheDocument();
    expect(screen.queryByRole("gridcell", { name: "e4, legal move" })).toBeNull();
  });

  it("marks captures differently from quiet moves", async () => {
    const user = userEvent.setup();
    // 1. e4 d5: the e4 pawn can take on d5 or advance to e5.
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2";
    render(<ChessBoard room={room(chessView({ fen }))} onMove={vi.fn()} />);

    await user.click(screen.getByRole("gridcell", { name: "e4, white pawn" }));

    expect(screen.getByRole("gridcell", { name: "d5, black pawn, legal move" })).toHaveClass("capture");
    expect(screen.getByRole("gridcell", { name: "e5, legal move" })).toHaveClass("target");
  });

  it("highlights the last move and a king in check", () => {
    // 1. f3 e5 2. g4 Qh4+ — White is in check.
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    render(
      <ChessBoard
        room={room(chessView({ fen, inCheck: true, lastMove: { from: "d8", to: "h4" } }))}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByRole("gridcell", { name: "e1, white king" })).toHaveClass("check");
    expect(screen.getByRole("gridcell", { name: "d8" })).toHaveClass("last");
    expect(screen.getByRole("gridcell", { name: "h4, black queen" })).toHaveClass("last");
  });

  it("runs the clock of the side to move once the first move is made", () => {
    render(<ChessBoard room={room(chessView({ lastMoveAt: 999_000 }))} onMove={vi.fn()} />);

    const white = screen.getByRole("timer", { name: "white clock" }).parentElement;
    const black = screen.getByRole("timer", { name: "black clock" }).parentElement;
    expect(white).toHaveClass("running");
    expect(black).not.toHaveClass("running");
  });

  it("keeps both clocks still before the first move", () => {
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);

    expect(screen.getByRole("timer", { name: "white clock" }).parentElement).not.toHaveClass("running");
  });

  it("shows the server's reason when a move is refused", async () => {
    const user = userEvent.setup();
    render(
      <ChessBoard room={room(chessView())} onMove={vi.fn().mockRejectedValue(new Error("Not your turn"))} />,
    );

    await user.click(screen.getByRole("gridcell", { name: "e2, white pawn" }));
    await user.click(screen.getByRole("gridcell", { name: "e4, legal move" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not your turn");
  });

  it("shows your own draw offer as pending", () => {
    render(<ChessBoard room={room(chessView({ drawOfferBy: ME }))} onMove={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Draw offered" })).toBeDisabled();
  });

  it("closing the promotion dialog cancels the move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(chessView({ fen: "7k/1P6/8/8/8/8/8/K7 w - - 0 1" }))} onMove={onMove} />);

    await user.click(screen.getByRole("gridcell", { name: "b7, white pawn" }));
    await user.click(screen.getByRole("gridcell", { name: "b8, legal move" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it.each([
    ["Keep playing", async (user) => user.click(screen.getByRole("button", { name: "Keep playing" }))],
    ["Escape", async (user) => user.keyboard("{Escape}")],
  ])("resigning can be called off (%s)", async (_how, callOff) => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    await user.click(screen.getByRole("button", { name: "Resign" }));
    await callOff(user);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("shows a spectator the board from White's side, names both players, and offers no actions", () => {
    const view = chessView({ colors: { [THEM]: "w", guest_x: "b" }, toMove: THEM });
    render(
      <ChessBoard
        room={room(view, {
          you: "",
          seats: [seats[1], { playerId: "guest_x", displayName: "Xu", connected: true }],
          status: "finished",
        })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("gridcell")[0]).toHaveAccessibleName("a8, black rook");
    expect(screen.getByText("Riya")).toBeInTheDocument();
    expect(screen.getByText("Xu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resign" })).toBeNull();
  });

  it("calls a player it can't find among the seats 'Opponent', and offers no draw to accept", () => {
    const view = chessView({ colors: { [ME]: "w", guest_gone: "b" }, drawOfferBy: "guest_gone" });
    render(<ChessBoard room={room(view, { seats: [seats[0]] })} onMove={vi.fn()} />);

    expect(screen.getByText("Opponent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept draw" })).toBeNull();
    expect(screen.getByRole("button", { name: "Offer draw" })).toBeEnabled();
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

    expect(await screen.findByRole(role, { name })).toBeInTheDocument();
  });

  it("has nothing for a game this build doesn't know", () => {
    expect(gameView("ludo")).toEqual({});
  });
});
