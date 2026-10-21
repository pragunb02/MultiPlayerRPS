import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tictactoeEngine } from "@classicade/games/tictactoe";
import { renderApp } from "../../testing/render.jsx";

/** How the Tic-Tac-Toe engine loads in each test: the test sets it before rendering. */
const engineLoad = vi.hoisted(() => ({ next: vi.fn() }));

// Only the engine loader of Tic-Tac-Toe changes. Everything else in the registry is the real one.
vi.mock("../../games/registry.js", async (importOriginal) => {
  const actual = await importOriginal();
  const ttt = actual.GAME_VIEWS.tictactoe;
  const views = Object.freeze({
    ...actual.GAME_VIEWS,
    tictactoe: Object.freeze({
      ...ttt,
      passAndPlay: Object.freeze({ ...ttt.passAndPlay, loadEngine: () => engineLoad.next() }),
    }),
  });
  return { ...actual, GAME_VIEWS: views, gameView: (gameId) => views[gameId] ?? Object.freeze({}) };
});

beforeEach(() => {
  engineLoad.next.mockReset();
});

describe("PassAndPlayPage when the game's engine does not load", () => {
  it("says so, with Retry, and starts once a retry loads it", async () => {
    const user = userEvent.setup();
    engineLoad.next
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce(tictactoeEngine);
    renderApp({ path: "/games/tic-tac-toe/pass-and-play" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The game could not load.Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Start game" })).toHaveAttribute("aria-disabled", "true");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toHaveAttribute("data-cc-control", "pass.retry");
    await user.click(retry);

    const start = screen.getByRole("button", { name: "Start game" });
    await vi.waitFor(() => expect(start).not.toHaveAttribute("aria-disabled"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(engineLoad.next).toHaveBeenCalledTimes(2);
  });

  it("keeps saying it is loading while the page reloads for a newer version", async () => {
    engineLoad.next.mockReturnValue(new Promise(() => {}));
    renderApp({ path: "/games/tic-tac-toe/pass-and-play" });

    const start = await screen.findByRole("button", { name: "Start game" });

    expect(start).toHaveAccessibleDescription("Loading the game");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
