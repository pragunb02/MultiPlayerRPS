import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHowToPlay } from "./useHowToPlay.js";

// Every page gets a game's How to play through the registry (CC-349), so a new game brings its steps in one entry.
// The registry here is a stand-in, so a load can fail or wait.
const STEPS = Object.freeze([{ Glyph: () => null, text: "Do the thing.", hinglish: "Woh karo." }]);
let finishSlow;
const LOADERS = {
  fine: vi.fn(async () => STEPS),
  broken: vi.fn(async () => {
    throw new Error("offline");
  }),
  slow: vi.fn(
    () =>
      new Promise((resolve) => {
        finishSlow = resolve;
      }),
  ),
};
vi.mock("../../games/registry.js", () => ({
  gameView: (gameId) => (LOADERS[gameId] ? { loadHowToPlay: LOADERS[gameId] } : {}),
}));

describe("useHowToPlay (CC-349)", () => {
  it("loads the game's steps through its registry entry, and has them at once the next time", async () => {
    const first = renderHook(() => useHowToPlay("fine"));

    expect(first.result.current).toBeUndefined();
    await waitFor(() => expect(first.result.current).toBe(STEPS));
    const again = renderHook(() => useHowToPlay("fine"));

    expect(again.result.current).toBe(STEPS);
    expect(LOADERS.fine).toHaveBeenCalledOnce();
  });

  it("has no steps for a game the registry has none for", () => {
    const { result } = renderHook(() => useHowToPlay("ludo"));

    expect(result.current).toEqual([]);
  });

  it("has no steps when they could not load", async () => {
    const { result } = renderHook(() => useHowToPlay("broken"));

    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("never shows one game's steps for another, nor sets anything after the page left", async () => {
    const { result, rerender, unmount } = renderHook(({ gameId }) => useHowToPlay(gameId), {
      initialProps: { gameId: "slow" },
    });

    rerender({ gameId: "broken" });
    await waitFor(() => expect(result.current).toEqual([]));
    unmount();
    finishSlow(STEPS);

    expect(result.current).toEqual([]);
  });
});
