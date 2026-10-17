import { act, fireEvent, render as renderPlain, screen, within } from "@testing-library/react";
import { Chess } from "chess.js";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { fakeSound } from "../../testing/fakes.js";
import { installMatchMedia } from "../../testing/matchMedia.js";
import { ChessBoard } from "./ChessBoard.jsx";
import { formatClock, useChessClocks } from "./useChessClocks.js";

// The board plays sounds (the low time tick, CC-103), so it gets a fake sound player.
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

describe("ChessBoard", () => {
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

  it("offers a draw, and leaves answering the opponent's offer to the room's request popup (CC-104)", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    const { rerender } = render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    await user.click(screen.getByRole("button", { name: "Offer draw" }));
    expect(onMove).toHaveBeenLastCalledWith({ type: "offer-draw" });

    rerender(<ChessBoard room={room(chessView({ drawOfferBy: THEM }))} onMove={onMove} />);
    expect(screen.queryByText("Riya offers a draw.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept draw" })).toBeNull();
    expect(screen.getByRole("button", { name: "Offer draw" })).toHaveAccessibleDescription(
      "Riya offered a draw. Answer it above the board",
    );
  });

  it("deselects a piece when it is clicked again or an unreachable square is clicked", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    const pawn = screen.getByRole("gridcell", { name: "e2, white pawn" });

    await user.click(pawn);
    expect(pawn).toHaveAttribute("aria-selected", "true");
    await user.click(pawn);
    expect(pawn).toHaveAttribute("aria-selected", "false");

    await user.click(pawn);
    await user.click(screen.getByRole("gridcell", { name: "a5" }));
    expect(pawn).toHaveAttribute("aria-selected", "false");
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
    // 1. f3 e5 2. g4 Qh4+ puts White in check.
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

    expect(screen.getByRole("button", { name: "Draw offered" })).toHaveAccessibleDescription(
      "Waiting for Riya to answer",
    );
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

  it("calls a player it can't find among the seats 'Opponent'", () => {
    const view = chessView({ colors: { [ME]: "w", guest_gone: "b" } });
    render(<ChessBoard room={room(view, { seats: [seats[0]] })} onMove={vi.fn()} />);

    expect(screen.getByText("Opponent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offer draw" })).toBeEnabled();
  });

  it("shows the move list in pairs", () => {
    render(<ChessBoard room={room(chessView({ moves: ["e4", "e5", "Nf3"] }))} onMove={vi.fn()} />);

    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1.e4e5", "2.Nf3"]);
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

/** The view after playing `sans` from the start, as the server would send it. */
function viewAfter(sans, overrides = {}) {
  const chess = new Chess();
  sans.forEach((san) => chess.move(san));
  const last = chess.history({ verbose: true }).at(-1);
  return chessView({
    fen: chess.fen(),
    moves: sans,
    lastMove: last ? { from: last.from, to: last.to } : {},
    toMove: chess.turn() === "w" ? ME : THEM,
    inCheck: chess.inCheck(),
    ...overrides,
  });
}

const cell = (name) => screen.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) });
const SIZE = 400;

/**
 * jsdom draws nothing, so the board gets a size here: 400 by 400 pixels at the top left of the page, 50 pixels
 * a square. Pointer capture is recorded instead of done.
 */
function sizeBoard() {
  const board = screen.getByRole("grid", { name: "Chess board" });
  board.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    right: SIZE,
    bottom: SIZE,
  });
  Object.defineProperty(board, "clientWidth", { value: SIZE });
  Object.defineProperty(board, "clientHeight", { value: SIZE });
  board.setPointerCapture = vi.fn();
  return board;
}

/** The centre of a square on screen, from White's side unless told otherwise. */
function point(square, orientation = "w") {
  const files = "abcdefgh";
  const column = orientation === "w" ? files.indexOf(square[0]) : 7 - files.indexOf(square[0]);
  const row = orientation === "w" ? 8 - Number(square[1]) : Number(square[1]) - 1;
  return { clientX: column * 50 + 25, clientY: row * 50 + 25 };
}

/** Presses on `from`, moves in steps to `to` and lets go there, like a mouse or a finger would. */
function dragPiece(from, to, { orientation = "w", pointerId = 1, release = true } = {}) {
  const board = screen.getByRole("grid", { name: "Chess board" });
  const start = point(from, orientation);
  const end = typeof to === "string" ? point(to, orientation) : to;
  fireEvent.pointerDown(cell(from), { pointerId, button: 0, ...start });
  fireEvent.pointerMove(board, { pointerId, clientX: start.clientX + 10, clientY: start.clientY });
  fireEvent.pointerMove(board, { pointerId, ...end });
  if (release) {
    fireEvent.pointerUp(board, { pointerId, ...end });
  }
}

describe("ChessBoard by drag and drop", () => {
  it("plays a piece dropped on a square it can reach, without sliding it again", () => {
    const onMove = vi.fn(() => new Promise(() => {}));
    const { container } = render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    const board = sizeBoard();

    dragPiece("e2", "e4");

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4" });
    expect(board.setPointerCapture).toHaveBeenCalledWith(1);
    // Shown at once, before the server answers, and not animated: the hand already put it there.
    expect(cell("e4")).toHaveAccessibleName("e4, white pawn");
    expect(container.querySelector(".sliding")).toBeNull();
  });

  it("lifts the piece while it is dragged: a copy follows the pointer and the drop square is marked", () => {
    const { container } = render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    const board = sizeBoard();

    dragPiece("e2", "e4", { release: false });

    expect(board).toHaveClass("dragging");
    expect(cell("e2")).toHaveClass("selected");
    expect(cell("e2").querySelector("img")).toHaveClass("lifted");
    expect(cell("e4")).toHaveClass("over");
    const ghost = container.querySelector(".ghost");
    expect(ghost.style.transform).toBe("translate(200px, 200px)");

    fireEvent.pointerMove(board, { pointerId: 1, clientX: 230, clientY: 180 });
    expect(ghost.style.transform).toBe("translate(205px, 155px)");
    expect(cell("e4")).not.toHaveClass("over");
  });

  it("sends a piece dropped where it cannot go back, still picked up, so a click can finish the move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    sizeBoard();

    dragPiece("e2", "e5");

    expect(onMove).not.toHaveBeenCalled();
    expect(cell("e2")).toHaveAccessibleName("e2, white pawn");
    expect(cell("e2")).toHaveAttribute("aria-selected", "true");
    expect(cell("e4")).toHaveAccessibleName("e4, legal move");

    await user.click(cell("e4"));
    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4" });
  });

  it.each([
    ["off the board", { clientX: 450, clientY: 100 }],
    ["back on its own square", "e2"],
  ])("plays nothing for a piece dropped %s", (_where, to) => {
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    sizeBoard();

    dragPiece("e2", to);

    expect(onMove).not.toHaveBeenCalled();
    expect(cell("e2")).toHaveAttribute("aria-selected", "true");
  });

  it("ignores the click some browsers send after a drop, but not the next real click", () => {
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    sizeBoard();
    dragPiece("e2", "e5");

    fireEvent.click(cell("e5"), { detail: 1 });
    expect(cell("e2")).toHaveAttribute("aria-selected", "true");

    fireEvent.pointerDown(cell("e4"), { pointerId: 2, button: 0, ...point("e4") });
    fireEvent.click(cell("e4"), { detail: 1 });
    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4" });
  });

  it("still takes a keyboard press right after a drop", () => {
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    sizeBoard();
    dragPiece("e2", "e5");

    fireEvent.click(cell("e4"), { detail: 0 });

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4" });
  });

  it("picks nothing up by clicking while it is not your turn", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView({ toMove: THEM }))} onMove={vi.fn()} />);

    await user.click(cell("e2"));

    expect(cell("e2")).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("gridcell", { name: /legal move/ })).toBeNull();
  });

  it("treats a press that barely moves as a click", async () => {
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    const board = sizeBoard();
    const start = point("e2");

    fireEvent.pointerDown(cell("e2"), { pointerId: 1, button: 0, ...start });
    fireEvent.pointerMove(board, { pointerId: 1, clientX: start.clientX + 2, clientY: start.clientY + 1 });
    fireEvent.pointerUp(board, { pointerId: 1, ...start });
    fireEvent.click(cell("e2"), { detail: 1 });

    expect(board.setPointerCapture).not.toHaveBeenCalled();
    expect(board).not.toHaveClass("dragging");
    expect(cell("e2")).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    ["the opponent's piece", "e7", 0],
    ["an empty square", "e4", 0],
    ["the right mouse button", "e2", 2],
  ])("starts no drag from %s", (_what, from, button) => {
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    const board = sizeBoard();

    fireEvent.pointerDown(cell(from), { pointerId: 1, button, ...point(from) });
    fireEvent.pointerMove(board, { pointerId: 1, ...point("e5") });

    expect(board).not.toHaveClass("dragging");
  });

  it("starts no drag from the board's edge, outside every square", () => {
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    const board = sizeBoard();

    fireEvent.pointerDown(board, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(board, { pointerId: 1, ...point("e4") });

    expect(board).not.toHaveClass("dragging");
  });

  it("does nothing for a click on an empty square with nothing picked up", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    await user.click(cell("e4"));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByRole("gridcell", { name: /legal move/ })).toBeNull();
  });

  it("starts no drag while it is not your turn", () => {
    render(<ChessBoard room={room(chessView({ toMove: THEM }))} onMove={vi.fn()} />);
    const board = sizeBoard();

    fireEvent.pointerDown(cell("e2"), { pointerId: 1, button: 0, ...point("e2") });
    fireEvent.pointerMove(board, { pointerId: 1, ...point("e4") });

    expect(board).not.toHaveClass("dragging");
    expect(board).not.toHaveClass("interactive");
  });

  it("follows only the pointer that picked the piece up (a second finger changes nothing)", () => {
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    const board = sizeBoard();
    dragPiece("e2", "e4", { release: false });

    fireEvent.pointerMove(board, { pointerId: 9, ...point("e3") });
    fireEvent.pointerUp(board, { pointerId: 9, ...point("e3") });

    expect(cell("e4")).toHaveClass("over");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("drops the piece back when the browser cancels the drag (a scroll, a call coming in)", () => {
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    const board = sizeBoard();
    dragPiece("e2", "e4", { release: false });

    fireEvent.pointerCancel(board, { pointerId: 1 });

    expect(board).not.toHaveClass("dragging");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("ignores pointer moves and releases when nothing was picked up", () => {
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    const board = sizeBoard();

    fireEvent.pointerMove(board, { pointerId: 1, ...point("e4") });
    fireEvent.pointerUp(board, { pointerId: 1, ...point("e4") });

    expect(board).not.toHaveClass("dragging");
  });

  it("works from Black's side too", () => {
    const onMove = vi.fn(() => new Promise(() => {}));
    const view = viewAfter(["e4"], { colors: { [ME]: "b", [THEM]: "w" }, toMove: ME });
    render(<ChessBoard room={room(view)} onMove={onMove} />);
    sizeBoard();

    dragPiece("e7", "e5", { orientation: "b" });

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "e7", to: "e5" });
  });

  it("asks for the promotion piece when a pawn is dropped on the last rank", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(chessView({ fen: "7k/1P6/8/8/8/8/8/K7 w - - 0 1" }))} onMove={onMove} />);
    sizeBoard();

    dragPiece("b7", "b8");
    const picker = screen.getByRole("dialog", { name: "Promote to" });
    expect(within(picker).getByRole("button", { name: "queen" })).toHaveFocus();
    // No legal-move marks under the picker.
    expect(screen.queryByRole("gridcell", { name: /legal move/ })).toBeNull();
    await user.click(within(picker).getByRole("button", { name: "rook" }));

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "b7", to: "b8", promotion: "r" });
  });
});

describe("ChessBoard by keyboard", () => {
  it("walks the squares with the arrow keys and plays with Enter", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    // One stop in the Tab order: a1 for White, until another square has had the focus.
    expect(cell("a1")).toHaveAttribute("tabindex", "0");
    expect(cell("e2")).toHaveAttribute("tabindex", "-1");
    cell("a1").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowUp}");
    expect(cell("e2")).toHaveFocus();
    expect(cell("e2")).toHaveAttribute("tabindex", "0");
    await user.keyboard("{Enter}");
    expect(cell("e2")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4" });
  });

  it("starts Black's walk at h8, the bottom left square on Black's side", () => {
    render(
      <ChessBoard
        room={room(chessView({ colors: { [ME]: "b", [THEM]: "w" }, toMove: THEM }))}
        onMove={vi.fn()}
      />,
    );

    expect(cell("h8")).toHaveAttribute("tabindex", "0");
  });

  it("puts the piece down again with Escape", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);

    await user.click(cell("e2"));
    await user.keyboard("{Escape}");

    expect(cell("e2")).toHaveAttribute("aria-selected", "false");
  });

  it("jumps to the ends of the row with Home and End, and to the corners with Ctrl", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    cell("a1").focus();

    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{End}");
    expect(cell("h4")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(cell("a4")).toHaveFocus();
    await user.keyboard("{Control>}{End}{/Control}");
    expect(cell("h1")).toHaveFocus();
    await user.keyboard("{Meta>}{Home}{/Meta}");
    expect(cell("a8")).toHaveFocus();
    expect(cell("a8")).toHaveAttribute("tabindex", "0");
  });

  it("keeps the page from scrolling on the board's own keys, and only on those", () => {
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    cell("a1").focus();

    // fireEvent answers false when the page's own handling of the key was cancelled.
    expect(fireEvent.keyDown(cell("a1"), { key: "End" })).toBe(false);
    expect(fireEvent.keyDown(cell("h1"), { key: "PageDown" })).toBe(true);
  });

  it("picks up and puts down with Space as well as Enter", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    cell("a1").focus();

    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowUp}");
    await user.keyboard(" ");
    expect(cell("e2")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp} ");

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e3" });
  });

  it("marks the picked square as the grid's selected cell, never as a pressed button", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);

    await user.click(cell("g1"));

    const squares = screen.getAllByRole("gridcell");
    expect(squares).toHaveLength(64);
    expect(squares.filter((square) => square.hasAttribute("aria-pressed"))).toEqual([]);
    expect(squares.filter((square) => square.getAttribute("aria-selected") === "true")).toEqual([cell("g1")]);
  });

  it("leaves other keys alone", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    cell("a1").focus();

    await user.keyboard("x");

    expect(cell("a1")).toHaveFocus();
  });
});

describe("ChessBoard moves on show", () => {
  it("slides the opponent's move into place", () => {
    const { container, rerender } = render(<ChessBoard room={room(viewAfter(["e4"]))} onMove={vi.fn()} />);
    expect(container.querySelector(".sliding")).toBeNull();

    rerender(<ChessBoard room={room(viewAfter(["e4", "e5"]))} onMove={vi.fn()} />);

    const sliding = [...container.querySelectorAll(".sliding")];
    expect(sliding).toHaveLength(1);
    expect(sliding[0].closest("[data-square]")).toBe(cell("e5"));
  });

  it("slides nothing for a player who asked for less motion", () => {
    installMatchMedia({ reducedMotion: true });
    const { container, rerender } = render(<ChessBoard room={room(viewAfter(["e4"]))} onMove={vi.fn()} />);

    rerender(<ChessBoard room={room(viewAfter(["e4", "e5"]))} onMove={vi.fn()} />);

    expect(container.querySelector(".sliding")).toBeNull();
    expect(cell("e5")).toHaveAccessibleName("e5, black pawn");
  });

  it("slides the rook too when a king castles, forwards and back", async () => {
    const user = userEvent.setup();
    const castled = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"];
    const { container, rerender } = render(
      <ChessBoard room={room(viewAfter(castled.slice(0, -1)))} onMove={vi.fn()} />,
    );

    rerender(<ChessBoard room={room(viewAfter(castled))} onMove={vi.fn()} />);
    const squares = () =>
      [...container.querySelectorAll(".sliding")].map((img) => img.closest("[data-square]").dataset.square);
    expect(squares().sort()).toEqual(["f1", "g1"]);

    await user.click(screen.getByRole("button", { name: "Previous move" }));
    expect(squares().sort()).toEqual(["e1", "h1"]);
  });

  it("slides nothing when jumping more than one move", async () => {
    const user = userEvent.setup();
    const { container } = render(<ChessBoard room={room(viewAfter(["e4", "e5", "Nf3"]))} onMove={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "First position" }));

    expect(container.querySelector(".sliding")).toBeNull();
    expect(cell("e2")).toHaveAccessibleName("e2, white pawn");
  });

  it("slides a piece played by clicking, and takes it back if the server refuses the move", async () => {
    const user = userEvent.setup();
    let refuse;
    const onMove = vi.fn(() => new Promise((_resolve, reject) => (refuse = reject)));
    const { container } = render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    await user.click(cell("e2"));
    await user.click(cell("e4"));
    expect(cell("e4")).toHaveAccessibleName("e4, white pawn");
    expect(container.querySelector(".sliding").closest("[data-square]")).toBe(cell("e4"));
    expect(cell("e7")).toHaveAttribute("aria-disabled", "true");

    await act(async () => refuse(new Error("Not your turn")));

    expect(cell("e2")).toHaveAccessibleName("e2, white pawn");
    expect(cell("e4")).toHaveAccessibleName("e4");
    expect(screen.getByRole("alert")).toHaveTextContent("Not your turn");
  });

  it("keeps the move on show when the server's view arrives before its answer", async () => {
    let confirm;
    const onMove = vi.fn(() => new Promise((resolve) => (confirm = resolve)));
    const user = userEvent.setup();
    const { rerender } = render(<ChessBoard room={room(chessView())} onMove={onMove} />);
    await user.click(cell("e2"));
    await user.click(cell("e4"));

    rerender(<ChessBoard room={room(viewAfter(["e4"]))} onMove={onMove} />);
    expect(cell("e4")).toHaveAccessibleName("e4, white pawn");
    await act(async () => confirm({}));

    expect(cell("e4")).toHaveAccessibleName("e4, white pawn");
    expect(screen.getAllByRole("button", { name: "e4" })).toHaveLength(1);
  });

  it("announces the last move to screen readers", () => {
    render(<ChessBoard room={room(viewAfter(["e4", "e5"]))} onMove={vi.fn()} />);

    expect(screen.getByText("Riya played e5")).toBeInTheDocument();
  });

  it("announces your own move as yours", () => {
    render(<ChessBoard room={room(viewAfter(["e4"]))} onMove={vi.fn()} />);

    expect(screen.getByText("You played e4")).toBeInTheDocument();
  });
});

describe("ChessBoard history", () => {
  const view = () => viewAfter(["e4", "e5", "Nf3"]);

  it("steps back and forward through the game without playing on it", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(viewAfter(["e4", "e5", "Nf3", "Nc6"]))} onMove={vi.fn()} />);
    const nav = within(screen.getByRole("group", { name: "Move navigation" }));
    expect(nav.getByRole("button", { name: "Next move" })).toHaveAttribute("aria-disabled", "true");
    expect(nav.getByRole("button", { name: "Latest move" })).toHaveAttribute("aria-disabled", "true");

    await user.click(nav.getByRole("button", { name: "Previous move" }));

    expect(screen.getByText("Looking at move 3 of 4.")).toBeInTheDocument();
    expect(cell("c6")).toHaveAccessibleName("c6");
    expect(screen.getByRole("button", { name: "Nf3" })).toHaveAttribute("aria-current", "step");
    // Even on your turn the old position cannot be played on.
    expect(cell("e2")).toHaveAttribute("aria-disabled", "true");

    await user.click(nav.getByRole("button", { name: "Next move" }));
    expect(screen.queryByText(/Looking at move/)).toBeNull();
    expect(cell("e2")).toHaveAttribute("aria-disabled", "false");
  });

  it("jumps to a move from the list, to the start and back to the latest", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(view())} onMove={vi.fn()} />);
    const nav = within(screen.getByRole("group", { name: "Move navigation" }));

    await user.click(screen.getByRole("button", { name: "e4" }));
    expect(screen.getByText("Looking at move 1 of 3.")).toBeInTheDocument();

    await user.click(nav.getByRole("button", { name: "First position" }));
    expect(screen.getByText("Looking at move 0 of 3.")).toBeInTheDocument();
    expect(nav.getByRole("button", { name: "Previous move" })).toHaveAttribute("aria-disabled", "true");
    expect(nav.getByRole("button", { name: "First position" })).toHaveAttribute("aria-disabled", "true");

    await user.click(nav.getByRole("button", { name: "Latest move" }));
    expect(screen.queryByText(/Looking at move/)).toBeNull();
    expect(cell("f3")).toHaveAccessibleName("f3, white knight");
  });

  it("stays on the move you are looking at while new moves arrive", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ChessBoard room={room(view())} onMove={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "e4" }));

    rerender(<ChessBoard room={room(viewAfter(["e4", "e5", "Nf3", "Nc6"]))} onMove={vi.fn()} />);

    expect(screen.getByText("Looking at move 1 of 4.")).toBeInTheDocument();
  });

  it("steps with the left and right arrow keys anywhere on the page but the board and form fields", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ChessBoard room={room(view())} onMove={vi.fn()} />
        <input aria-label="Chat" />
      </>,
    );

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByText("Looking at move 1 of 3.")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Looking at move 2 of 3.")).toBeInTheDocument();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByText("Looking at move 2 of 3.")).toBeInTheDocument();

    await user.click(screen.getByRole("textbox", { name: "Chat" }));
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Looking at move 2 of 3.")).toBeInTheDocument();

    cell("a1").focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Looking at move 2 of 3.")).toBeInTheDocument();
  });

  it("goes no further than the start or the latest move with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(viewAfter(["e4"]))} onMove={vi.fn()} />);

    await user.keyboard("{ArrowRight}");
    expect(screen.queryByText(/Looking at move/)).toBeNull();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByText("Looking at move 0 of 1.")).toBeInTheDocument();
  });

  it("keeps the newest move in sight in a long list", () => {
    const { rerender } = render(<ChessBoard room={room(view())} onMove={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Move list" });
    Object.defineProperty(list, "scrollHeight", { value: 900 });

    rerender(<ChessBoard room={room(viewAfter(["e4", "e5", "Nf3", "Nc6"]))} onMove={vi.fn()} />);

    expect(list.scrollTop).toBe(900);
  });
});

describe("ChessBoard around the board", () => {
  it("flips the board, and back", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Flip board" }));
    expect(screen.getAllByRole("gridcell")[0]).toHaveAccessibleName("h1, white rook");
    // Your own strip moves to the top with your side of the board.
    const strips = screen.getAllByRole("timer").map((timer) => timer.getAttribute("aria-label"));
    expect(strips).toEqual(["white clock", "black clock"]);

    await user.click(screen.getByRole("button", { name: "Flip board" }));
    expect(screen.getAllByRole("gridcell")[0]).toHaveAccessibleName("a8, black rook");
  });

  it("draws rank and file letters along the edges, hidden from screen readers and outside every square", () => {
    const { container } = render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);

    const layer = container.querySelector(".coords");
    const texts = (selector) =>
      [...layer.querySelectorAll(`${selector} .coord`)].map((node) => node.textContent);
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(texts(".rankCoords")).toEqual(["8", "7", "6", "5", "4", "3", "2", "1"]);
    expect(texts(".fileCoords")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    // Each one takes the colour of the other kind of square, so it reads on the square it sits on: a8 is light.
    expect(layer.querySelector(".rankCoords .coord")).toHaveClass("onLight");
    expect(layer.querySelector(".fileCoords .coord")).toHaveClass("onDark");
    // A square shows no text of its own, so what voice control users see on it is never a second label.
    expect(screen.getAllByRole("gridcell").filter((square) => square.textContent !== "")).toEqual([]);
  });

  it("draws the coordinates from Black's side for the Black player", () => {
    const { container } = render(
      <ChessBoard
        room={room(chessView({ colors: { [ME]: "b", [THEM]: "w" }, toMove: THEM }))}
        onMove={vi.fn()}
      />,
    );

    const texts = (selector) =>
      [...container.querySelectorAll(`${selector} .coord`)].map((node) => node.textContent).join("");
    expect(texts(".rankCoords")).toBe("12345678");
    expect(texts(".fileCoords")).toBe("hgfedcba");
  });

  it("shows the pieces each side took and who is ahead", () => {
    // 1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5: one pawn each.
    const level = viewAfter(["e4", "d5", "exd5", "Qxd5"]);
    const { rerender } = render(<ChessBoard room={room(level)} onMove={vi.fn()} />);
    expect(screen.getAllByRole("img", { name: "Captured 1 pawn" })).toHaveLength(2);
    expect(screen.queryByText(/in material/)).toBeNull();

    // A knight taken for nothing: 1. e4 Nf6 2. Nc3 Nxe4 3. Nxe4.
    rerender(<ChessBoard room={room(viewAfter(["e4", "Nf6", "Nc3", "Nxe4", "Nxe4"]))} onMove={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Captured 1 knight" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured 1 pawn" })).toBeInTheDocument();
    expect(screen.getByText("+2")).toHaveTextContent("+2 in material");
  });

  it("turns your clock red under 20 seconds and says so once to screen readers", () => {
    const low = chessView({ clocks: { w: 19_000, b: 25_000 } });
    render(<ChessBoard room={room(low)} onMove={vi.fn()} />);

    expect(screen.getByRole("timer", { name: "white clock" }).parentElement).toHaveClass("low");
    expect(screen.getByRole("timer", { name: "black clock" }).parentElement).not.toHaveClass("low");
    expect(screen.getByText("Less than 20 seconds left on your clock")).toBeInTheDocument();
  });

  it("marks the opponent's low clock red without announcing it", () => {
    render(<ChessBoard room={room(chessView({ clocks: { w: 60_000, b: 5_000 } }))} onMove={vi.fn()} />);

    expect(screen.getByRole("timer", { name: "black clock" }).parentElement).toHaveClass("low");
    expect(screen.queryByText("Less than 20 seconds left on your clock")).toBeNull();
  });

  it("stops warning about low time once the game is over", () => {
    const view = chessView({ clocks: { w: 0, b: 25_000 }, toMove: "" });
    const finished = room(view, {
      status: "finished",
      game: {
        view,
        activePlayers: [],
        outcome: { status: "finished", result: "win", winners: [THEM], reason: "timeout" },
      },
    });
    render(<ChessBoard room={finished} onMove={vi.fn()} />);

    expect(screen.getByRole("timer", { name: "white clock" }).parentElement).not.toHaveClass("low");
    expect(screen.queryByText("Less than 20 seconds left on your clock")).toBeNull();
  });

  it("only lets your own pieces look movable, and only on your turn", () => {
    const { rerender } = render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);
    expect(cell("e2")).toHaveClass("movable");
    expect(cell("e7")).not.toHaveClass("movable");

    rerender(<ChessBoard room={room(chessView({ toMove: THEM }))} onMove={vi.fn()} />);
    expect(cell("e2")).not.toHaveClass("movable");
  });
});

describe("ChessBoard promotion picker", () => {
  const promotable = (colour) =>
    colour === "w"
      ? chessView({ fen: "7k/1P6/8/8/8/8/8/K7 w - - 0 1" })
      : chessView({ fen: "k7/8/8/8/8/8/1p6/7K b - - 0 1", colors: { [ME]: "b", [THEM]: "w" } });

  it("stands on the promotion square's file, from the top edge of the board", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(promotable("w"))} onMove={vi.fn()} />);

    await user.click(cell("b7"));
    await user.click(cell("b8"));

    const picker = screen.getByRole("dialog", { name: "Promote to" });
    expect(picker).toHaveClass("column1", "fromTop");
    expect(
      within(picker)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["queen", "knight", "rook", "bishop"]);
  });

  it("grows up from the bottom edge when the board is flipped", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(promotable("w"))} onMove={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Flip board" }));

    await user.click(cell("b7"));
    await user.click(cell("b8"));

    expect(screen.getByRole("dialog", { name: "Promote to" })).toHaveClass("column6", "fromBottom");
  });

  it("shows Black's pieces to Black, at Black's top edge", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(promotable("b"))} onMove={onMove} />);

    await user.click(cell("b2"));
    await user.click(cell("b1"));
    const picker = screen.getByRole("dialog", { name: "Promote to" });
    expect(picker).toHaveClass("column6", "fromTop");
    expect(within(picker).getByRole("button", { name: "queen" }).querySelector("img")).toHaveAttribute(
      "src",
      "/pieces/bQ.png",
    );
    await user.click(within(picker).getByRole("button", { name: "bishop" }));

    expect(onMove).toHaveBeenCalledWith({ type: "move", from: "b2", to: "b1", promotion: "b" });
  });

  it("takes the move back when the dimmed board is clicked, but not when the picker itself is", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard room={room(promotable("w"))} onMove={onMove} />);
    await user.click(cell("b7"));
    await user.click(cell("b8"));
    const picker = screen.getByRole("dialog", { name: "Promote to" });

    await user.click(picker);
    expect(picker).toBeInTheDocument();
    await user.click(picker.parentElement);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("ignores keys other than Escape", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(promotable("w"))} onMove={vi.fn()} />);
    await user.click(cell("b7"));
    await user.click(cell("b8"));

    await user.keyboard("a");

    expect(screen.getByRole("dialog", { name: "Promote to" })).toBeInTheDocument();
  });
});

describe("ChessBoard game over", () => {
  const finished = (sans, outcome, overrides = {}) => {
    const view = viewAfter(sans, { toMove: "" });
    return room(view, {
      status: "finished",
      serverTime: Date.UTC(2026, 9, 16, 12),
      game: { view, activePlayers: [], outcome: { status: "finished", ...outcome } },
      ...overrides,
    });
  };

  it("says how the game ended and who won, with the score", () => {
    render(
      <ChessBoard
        room={finished(["f3", "e5", "g4", "Qh4#"], { result: "win", winners: [THEM], reason: "checkmate" })}
        onMove={vi.fn()}
      />,
    );

    const panel = screen.getByRole("region", { name: "Checkmate" });
    expect(panel).toHaveTextContent("Riya won with Black");
    expect(panel).toHaveTextContent("0–1");
    expect(screen.queryByRole("button", { name: "Resign" })).toBeNull();
  });

  it("says when you won", () => {
    render(
      <ChessBoard
        room={finished(["e4"], { result: "win", winners: [ME], reason: "resignation" })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: "Resignation" })).toHaveTextContent("You won with White1–0");
  });

  it("shows a draw as a draw", () => {
    render(
      <ChessBoard
        room={finished(["d4"], { result: "draw", winners: [], reason: "agreement" })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: "Draw by agreement" })).toHaveTextContent("Draw½–½");
  });

  it("offers the game as a PGN file built from the moves, with the players' names", () => {
    render(
      <ChessBoard
        room={finished(["f3", "e5", "g4", "Qh4#"], { result: "win", winners: [THEM], reason: "checkmate" })}
        onMove={vi.fn()}
        site="https://classicade.example"
      />,
    );

    const link = screen.getByRole("link", { name: "Download PGN" });
    expect(link).toHaveAttribute("download", "classicade-AB2CD3-2026-10-16.pgn");
    const pgn = decodeURIComponent(
      link.getAttribute("href").replace("data:application/x-chess-pgn;charset=utf-8,", ""),
    );
    expect(pgn).toContain('[White "Me"]');
    expect(pgn).toContain('[Black "Riya"]');
    expect(pgn).toContain('[Site "https://classicade.example"]');
    expect(pgn).toContain("1. f3 e5 2. g4 Qh4# 0-1");
  });

  it("names the site after the page by default", () => {
    render(
      <ChessBoard
        room={finished(["e4"], { result: "win", winners: [ME], reason: "resignation" })}
        onMove={vi.fn()}
      />,
    );

    const pgn = decodeURIComponent(screen.getByRole("link", { name: "Download PGN" }).getAttribute("href"));
    expect(pgn).toContain(`[Site "${window.location.origin}"]`);
  });

  it("shows a spectator who won by name", () => {
    const view = viewAfter(["e4"], { colors: { [THEM]: "w", guest_x: "b" }, toMove: "" });
    const watched = room(view, {
      you: "",
      status: "finished",
      seats: [seats[1], { playerId: "guest_x", displayName: "Xu", connected: true }],
      game: {
        view,
        activePlayers: [],
        outcome: { status: "finished", result: "win", winners: ["guest_x"], reason: "timeout" },
      },
    });
    render(<ChessBoard room={watched} onMove={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Time out" })).toHaveTextContent("Xu won with Black");
  });
});

describe("ChessBoard says why a press did nothing (CC-164)", () => {
  const reason = () =>
    screen
      .getAllByRole("status")
      .map((status) => status.textContent)
      .join(" ");

  it("says it is not your turn, and picks nothing up", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView({ toMove: THEM }))} onMove={vi.fn()} />);

    await user.click(cell("e2"));

    expect(reason()).toContain("Not your turn");
  });

  it("asks for one of your own pieces when an empty square or the opponent's piece is pressed first", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={vi.fn()} />);

    await user.click(cell("e7"));

    expect(reason()).toContain("Pick one of your own pieces");
  });

  it("says a move is not allowed when the picked piece cannot go there", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} />);

    await user.click(cell("e2"));
    await user.click(cell("e5"));

    expect(onMove).not.toHaveBeenCalled();
    expect(reason()).toContain("That move is not allowed");
  });

  it("sends you to the latest move when an old position is pressed", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(viewAfter(["e4", "e5"]))} onMove={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Previous move" }));
    await user.click(cell("d2"));

    expect(reason()).toContain("Go to the latest move to play");
  });

  it("says the move is on its way when the board is pressed again before the server answers", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(chessView())} onMove={() => new Promise(() => {})} />);

    await user.click(cell("e2"));
    await user.click(cell("e4"));
    await user.click(cell("d2"));

    expect(reason()).toContain("Sending your move");
  });

  it("passes the room's own reason on, such as reconnecting, and closes the draw offer for it", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard room={room(chessView())} onMove={onMove} reason="Reconnecting" />);

    await user.click(cell("e2"));
    await user.click(screen.getByRole("button", { name: "Offer draw" }));

    expect(onMove).not.toHaveBeenCalled();
    expect(reason()).toContain("Reconnecting");
    expect(screen.getByRole("button", { name: "Offer draw" })).toHaveAccessibleDescription("Reconnecting");
  });

  it("lets you offer a draw and resign on the opponent's turn", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({});
    render(<ChessBoard room={room(chessView({ toMove: THEM }))} onMove={onMove} />);

    await user.click(screen.getByRole("button", { name: "Offer draw" }));

    expect(onMove).toHaveBeenCalledWith({ type: "offer-draw" });
    expect(screen.getByRole("button", { name: "Resign" })).not.toHaveAttribute("aria-disabled");
  });

  it("says the move is already on the board when its button in the list is pressed", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(viewAfter(["e4"]))} onMove={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "e4" }));

    expect(reason()).toContain("This move is on the board now");
  });

  it("says when the history cannot step any further", async () => {
    const user = userEvent.setup();
    render(<ChessBoard room={room(viewAfter(["e4"]))} onMove={vi.fn()} />);
    const nav = within(screen.getByRole("group", { name: "Move navigation" }));

    await user.click(nav.getByRole("button", { name: "Latest move" }));
    expect(reason()).toContain("This is the latest move");
    await user.click(nav.getByRole("button", { name: "First position" }));
    await user.click(nav.getByRole("button", { name: "Previous move" }));
    expect(reason()).toContain("This is the first position");
  });
});
