import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const ME = { playerId: GUEST.id, displayName: GUEST.displayName, connected: true };
const BOB = { playerId: "guest_b", displayName: "Bob", connected: true };
const WIN = { status: "finished", result: "win", winners: [GUEST.id], reason: "reached-target" };

/** A finished game of a board-less game (generic room page), from the guest's seat. */
const finished = ({ rematch = { requestedBy: [], available: true }, ...overrides } = {}) => ({
  code: "AB2CD3",
  gameId: "ludo",
  status: "finished",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  game: { view: {}, activePlayers: [], outcome: WIN },
  ...(rematch && { rematch }),
  series: { games: 1, wins: { [GUEST.id]: 1 } },
  ...overrides,
});

/** Opens the room; the socket answers room:join with `joined` and room:rematch with `onRematch()`. */
function openRoom(joined, onRematch = vi.fn(async () => joined)) {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event) => {
    if (event === "room:join") return joined;
    if (event === "room:rematch") return onRematch();
    return { left: true };
  });
  const view = renderApp({
    path: "/games/ludo/rooms/AB2CD3",
    socket,
    api: fakeApi({ getSession: async () => GUEST }),
  });
  return { ...view, socket, onRematch };
}

describe("RoomPage rematch (CC-037)", () => {
  it("offers a rematch after the game, and waits for the opponent once asked", async () => {
    const user = userEvent.setup();
    const asked = finished({ rematch: { requestedBy: [GUEST.id], available: true } });
    const { socket, onRematch } = openRoom(
      finished(),
      vi.fn(async () => asked),
    );

    await user.click(await screen.findByRole("button", { name: "Rematch" }));

    expect(socket.request).toHaveBeenCalledWith("room:rematch", { code: "AB2CD3" });
    expect(onRematch).toHaveBeenCalledOnce();
    expect(await screen.findByText("Waiting for Bob…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel rematch" })).toBeInTheDocument();
  });

  it("withdraws the request on cancel", async () => {
    const user = userEvent.setup();
    const { onRematch } = openRoom(
      finished({ rematch: { requestedBy: [GUEST.id], available: true } }),
      vi.fn(async () => finished()),
    );

    await user.click(await screen.findByRole("button", { name: "Cancel rematch" }));

    expect(onRematch).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: "Rematch" })).toBeInTheDocument();
  });

  it("shows the opponent's request and starts the new game in place when accepted", async () => {
    const user = userEvent.setup();
    const playing = finished({
      status: "playing",
      rematch: undefined,
      seats: [BOB, ME],
      game: { view: {}, activePlayers: [GUEST.id], outcome: { status: "ongoing" } },
    });
    const view = openRoom(
      finished(),
      vi.fn(async () => playing),
    );
    await screen.findByRole("heading", { name: "You won!" });

    act(() =>
      view.socket.push(
        "room:updated",
        finished({ rematch: { requestedBy: [BOB.playerId], available: true } }),
      ),
    );
    expect(await screen.findByText("Bob wants a rematch!")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept rematch" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "You won!" })).not.toBeInTheDocument());
    expect(screen.getByText(/board is not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rematch/i })).not.toBeInTheDocument();
    expect(view.url()).toBe("/games/ludo/rooms/AB2CD3");
  });

  it("replaces the last game's board with a fresh one for the rematch", async () => {
    const user = userEvent.setup();
    const board = (cells, turn) => ({
      board: cells,
      marks: { [GUEST.id]: "X", [BOB.playerId]: "O" },
      turn,
      winningLine: [],
    });
    const won = finished({
      gameId: "tictactoe",
      game: { view: board(["X", "X", "X", "O", "O", "", "", "", ""], ""), activePlayers: [], outcome: WIN },
    });
    const rematch = finished({
      gameId: "tictactoe",
      status: "playing",
      rematch: undefined,
      seats: [BOB, ME],
      game: {
        view: board(Array(9).fill(""), BOB.playerId),
        activePlayers: [BOB.playerId],
        outcome: { status: "ongoing" },
      },
    });
    openRoom(
      won,
      vi.fn(async () => rematch),
    );
    // Marks are drawn (CC-087); each cell's name says what is in it.
    const marks = () =>
      screen.getAllByRole("gridcell").map((cell) => cell.getAttribute("aria-label").split(": ")[1]);
    await screen.findByRole("grid", { name: "Tic-Tac-Toe board" });
    expect(marks().join("")).toBe("XXXOOemptyemptyemptyempty");

    await user.click(screen.getByRole("button", { name: "Rematch" }));

    await waitFor(() => expect(marks().every((mark) => mark === "empty")).toBe(true));
  });

  it("says when the opponent left, and links to a new game instead", async () => {
    openRoom(finished({ rematch: { requestedBy: [], available: false }, seats: [ME] }));

    expect(await screen.findByText("Opponent left — no rematch this time.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New game" })).toHaveAttribute("href", "/games/ludo");
    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
  });

  it("mentions an opponent who is offline", async () => {
    openRoom(finished({ seats: [ME, { ...BOB, connected: false }] }));

    expect(await screen.findByText("Bob is offline right now.")).toBeInTheDocument();
  });

  it("shows the series score once there was a rematch", async () => {
    openRoom(finished({ series: { games: 3, wins: { [GUEST.id]: 2, [BOB.playerId]: 1 } } }));

    expect(await screen.findByText("You 2 – Bob 1")).toBeInTheDocument();
    expect(screen.getByText(/Series after 3 games/)).toBeInTheDocument();
  });

  it("counts a player without wins in the series as 0", async () => {
    openRoom(finished({ series: { games: 2, wins: { [GUEST.id]: 1 } } }));

    expect(await screen.findByText("You 1 – Bob 0")).toBeInTheDocument();
  });

  it("explains a refused request", async () => {
    const user = userEvent.setup();
    openRoom(
      finished(),
      vi.fn(async () => {
        throw new AppRequestError({
          code: "CONFLICT",
          message: "Your opponent left, so a rematch is no longer possible",
        });
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Rematch" }));

    expect(
      await screen.findByText("Your opponent left, so a rematch is no longer possible"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeEnabled();
  });

  it("offers spectators no rematch", async () => {
    openRoom(finished({ you: "" }));

    expect(await screen.findByRole("heading", { name: "Guest-T001 won" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
  });

  it("offers nothing when the server sent no rematch state", async () => {
    openRoom(finished({ rematch: null, series: undefined }));

    expect(await screen.findByRole("heading", { name: "You won!" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
  });
});
