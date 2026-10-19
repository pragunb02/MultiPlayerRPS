import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chessEngine } from "@classicade/games/chess";
import { tictactoeEngine } from "@classicade/games/tictactoe";
import { AppRequestError } from "../lib/errors.js";
import { useLocalMatch } from "./useLocalMatch.js";

const NAMES = Object.freeze(["Asha", "Ben"]);

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useLocalMatch", () => {
  it("rejects a refused move in the engine's words and keeps the game as it was", async () => {
    const { result } = renderHook(() =>
      useLocalMatch({ engine: tictactoeEngine, names: NAMES, options: {} }),
    );
    await act(() => result.current.move({ cell: 0 }));

    await expect(result.current.move({ cell: 0 })).rejects.toThrow(AppRequestError);
    await expect(result.current.move({ cell: 0 })).rejects.toThrow("That cell is taken");
    expect(result.current.holder).toBe("player-2");
  });

  it("ends a chess game on time when the clock of the side to move runs out", async () => {
    const { result } = renderHook(() =>
      useLocalMatch({ engine: chessEngine, names: NAMES, options: { timeControl: "bullet-1+0" } }),
    );
    await act(() => result.current.move({ type: "move", from: "e2", to: "e4" }));

    act(() => vi.advanceTimersByTime(59_000));
    expect(result.current.room.status).toBe("playing");
    act(() => vi.advanceTimersByTime(1_001));

    expect(result.current.room.status).toBe("finished");
    expect(result.current.room.game.outcome).toMatchObject({ reason: "timeout", winners: ["player-1"] });
  });

  it("plays a move for a named player, and rejects one the engine refuses for them", async () => {
    const { result } = renderHook(() => useLocalMatch({ engine: chessEngine, names: NAMES, options: {} }));

    await expect(result.current.moveAs("player-2", { type: "move", from: "e7", to: "e5" })).rejects.toThrow(
      "Wait for your turn",
    );
    await act(() => result.current.moveAs("player-2", { type: "resign" }));

    expect(result.current.room.game.outcome).toMatchObject({ winners: ["player-1"] });
  });

  it("sets no timer for a game without a clock", () => {
    renderHook(() => useLocalMatch({ engine: tictactoeEngine, names: NAMES, options: {} }));

    expect(vi.getTimerCount()).toBe(0);
  });
});
