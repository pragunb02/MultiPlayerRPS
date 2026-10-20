import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-144: the daily chess puzzle page. Lichess puzzle 0000D (CC0): after White's Qd6, Black finds Rd8, White takes
// Qxd8+, Black finds Bxd8.
const START = Object.freeze({
  fen: "5rk1/1p3ppp/pq1Q1b2/8/8/1P3N2/P4PPP/3R2K1 b - - 3 27",
  toMove: "b",
  player: "b",
  lastMove: { from: "d3", to: "d6", san: "Qd6" },
  line: [],
});
const AFTER_FIRST = Object.freeze({
  fen: "3Q2k1/1p3ppp/pq3b2/8/8/1P3N2/P4PPP/3R2K1 b - - 0 28",
  toMove: "b",
  player: "b",
  lastMove: { from: "d6", to: "d8", san: "Qxd8+" },
  line: ["Rd8", "Qxd8+"],
});

/** The server's view of today's puzzle, as GET /api/daily/chess answers it. */
const view = (fields = {}) => ({
  kind: "chess",
  day: "2026-10-20",
  number: 2,
  nextAt: Date.parse("2026-10-20T18:30:00.000Z"),
  rating: 1529,
  steps: 2,
  maxMistakes: 3,
  maxHints: 2,
  position: START,
  status: "new",
  mistakes: 0,
  hints: [],
  hintsTaken: 0,
  hintsLeft: 2,
  grid: ["notReached", "notReached"],
  streak: { current: 0, best: 0, playedToday: false, atRisk: false },
  ...fields,
});
const SOLVED = view({
  status: "solved",
  position: { ...AFTER_FIRST, fen: "3b2k1/1p3ppp/pq6/8/8/1P3N2/P4PPP/3R2K1 w - - 0 29", toMove: "w" },
  grid: ["firstTry", "afterMistakes"],
  mistakes: 1,
  hintsTaken: 1,
  hintsLeft: 1,
  solution: ["Rd8", "Qxd8+", "Bxd8"],
  sourceUrl: "https://lichess.org/training/0000D",
  streak: { current: 3, best: 4, playedToday: true, atRisk: false },
});

const square = (name) => screen.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) });

async function open(api = fakeApi({ getDailyPuzzle: vi.fn().mockResolvedValue(view()) })) {
  const app = renderApp({ path: "/daily/chess", api });
  await screen.findByRole("grid", { name: "Chess board" });
  return app;
}

// The board loads on demand. Loading it once first keeps its first download out of each test's wait.
beforeAll(() => import("../../games/daily/ChessPuzzle.jsx"));

describe("the daily chess puzzle page (CC-144)", () => {
  it("shows a visitor today's puzzle: its number, the side to move, the rating and the board, no solution", async () => {
    const { api } = await open();

    expect(screen.getByRole("heading", { level: 1, name: "Daily chess puzzle #2" })).toBeVisible();
    expect(screen.getByText("Black to move. Find 2 moves.", { exact: false })).toBeVisible();
    expect(screen.getByText("Rated 1529")).toBeVisible();
    expect(screen.getByText("Tuesday 20 October")).toBeVisible();
    expect(screen.getByText("3 tries left")).toBeVisible();
    expect(square("d6")).toHaveAccessibleName("d6, white queen");
    expect(screen.queryByText(/Solution/)).toBeNull();
    expect(screen.getByText("Solve a puzzle each day to build a streak.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Lichess puzzle database" })).toHaveAttribute(
      "href",
      "https://database.lichess.org/#puzzles",
    );
    expect(api.getDailyPuzzle).toHaveBeenCalledWith("chess");
    expect(document.title).toBe("Daily chess puzzle · ClassiCade");
  });

  it("starts a guest on the first move, sends it for today's day and reads out the reply", async () => {
    const api = fakeApi({
      getDailyPuzzle: vi.fn().mockResolvedValue(view()),
      playDailyMove: vi.fn().mockResolvedValue({
        outcome: "correct",
        played: { san: "Rd8" },
        reply: { from: "d6", to: "d8", san: "Qxd8+" },
        puzzle: view({ status: "playing", position: AFTER_FIRST, grid: ["firstTry", "notReached"] }),
      }),
    });
    await open(api);
    const user = userEvent.setup();

    await user.click(square("f8"));
    await user.click(square("d8"));

    expect(
      await screen.findByText("Rd8 is correct. White played Qxd8+. Find the next move."),
    ).toHaveAttribute("aria-live", "polite");
    expect(api.startGuest).toHaveBeenCalledTimes(1);
    expect(api.playDailyMove).toHaveBeenCalledWith("chess", { day: "2026-10-20", from: "f8", to: "d8" });
    expect(square("d8")).toHaveAccessibleName("d8, white queen");
    // The answer already holds the attempt: the new guest does not load the puzzle again.
    expect(api.getDailyPuzzle).toHaveBeenCalledTimes(1);
  });

  it("plays a move with the keyboard alone", async () => {
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue(GUEST),
      getDailyPuzzle: vi.fn().mockResolvedValue(view()),
      playDailyMove: vi.fn().mockResolvedValue({
        outcome: "wrong",
        played: { san: "Kh8" },
        puzzle: view({ status: "playing", mistakes: 1, grid: ["notReached", "notReached"] }),
      }),
    });
    await open(api);
    const user = userEvent.setup();

    // Black plays from the bottom of the board, so h8 is to the left of g8.
    square("g8").focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Kh8 is not the move. 2 tries left.")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(api.playDailyMove).toHaveBeenCalledWith("chess", { day: "2026-10-20", from: "g8", to: "h8" });
    expect(screen.getByText("2 tries left")).toBeVisible();
    expect(api.startGuest).not.toHaveBeenCalled();
  });

  it("says why a press does nothing: the other side's piece, an illegal square, a move on its way", async () => {
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue(GUEST),
      getDailyPuzzle: vi.fn().mockResolvedValue(view()),
      playDailyMove: vi.fn(() => new Promise(() => {})),
    });
    await open(api);
    const user = userEvent.setup();

    await user.click(square("d6"));
    expect(await screen.findByText("Pick one of the black pieces")).toBeVisible();
    await user.click(square("f8"));
    await user.click(square("a1"));
    expect(await screen.findByText("That move is not allowed")).toBeVisible();
    await user.click(square("f8"));
    await user.click(square("d8"));
    await user.click(square("g8"));
    expect(await screen.findByText("Sending your move")).toBeVisible();
  });

  it("gives a hint on request and says how many are left", async () => {
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue(GUEST),
      getDailyPuzzle: vi.fn().mockResolvedValue(view()),
      takeDailyHint: vi.fn().mockResolvedValue({
        hint: "Look for a way to win material.",
        puzzle: view({
          status: "playing",
          hints: ["Look for a way to win material."],
          hintsTaken: 1,
          hintsLeft: 1,
        }),
      }),
    });
    await open(api);

    await userEvent.setup().click(screen.getByRole("button", { name: "Get a hint (2 left)" }));

    const hints = await screen.findByRole("list", { name: "Hints" });
    expect(within(hints).getByText("Look for a way to win material.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Get a hint (1 left)" })).toBeVisible();
    expect(api.takeDailyHint).toHaveBeenCalledWith("chess", { day: "2026-10-20" });
  });

  it("explains instead of asking when no hint is left", async () => {
    await open(
      fakeApi({ getDailyPuzzle: vi.fn().mockResolvedValue(view({ status: "playing", hintsLeft: 0 })) }),
    );

    expect(screen.getByRole("button", { name: "Get a hint (0 left)" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("shows the solution, the streak and a share with only the grid once solved", async () => {
    await open(
      fakeApi({
        getSession: vi.fn().mockResolvedValue(GUEST),
        getDailyPuzzle: vi.fn().mockResolvedValue(SOLVED),
      }),
    );

    expect(screen.getByRole("heading", { name: "Solved!" })).toBeVisible();
    expect(screen.getByText("Rd8 Qxd8+ Bxd8")).toBeVisible();
    expect(screen.getByText(/Puzzle streak: 3 days/)).toBeVisible();
    const share = screen.getByText(/ClassiCade Daily chess puzzle #2/);
    expect(share).toHaveTextContent("🟩🟨 💡1 🔥3");
    expect(share.textContent).not.toContain(GUEST.displayName);
    const whatsapp = screen.getByRole("link", { name: "Send on WhatsApp" });
    expect(decodeURIComponent(whatsapp.getAttribute("href"))).toContain("/daily/chess");
    expect(decodeURIComponent(whatsapp.getAttribute("href"))).not.toMatch(/Rd8|Bxd8|Guest/);
    expect(screen.getByRole("link", { name: "See this puzzle on Lichess" })).toHaveAttribute(
      "href",
      "https://lichess.org/training/0000D",
    );
    expect(screen.queryByRole("button", { name: /Get a hint/ })).toBeNull();
  });

  it("closes the board once the day's attempt has ended, and says why on a press", async () => {
    await open(
      fakeApi({
        getSession: vi.fn().mockResolvedValue(GUEST),
        getDailyPuzzle: vi.fn().mockResolvedValue(
          view({
            status: "failed",
            mistakes: 3,
            grid: ["failed", "notReached"],
            solution: ["Rd8"],
            sourceUrl: "x",
          }),
        ),
      }),
    );

    await userEvent.setup().click(square("f8"));

    expect(screen.getByRole("heading", { name: "Not this time" })).toBeVisible();
    expect(await screen.findByText("Today's puzzle is over. Come back tomorrow")).toBeVisible();
  });

  it("warns when the streak is at risk", async () => {
    await open(
      fakeApi({
        getDailyPuzzle: vi
          .fn()
          .mockResolvedValue(view({ streak: { current: 4, best: 4, playedToday: false, atRisk: true } })),
      }),
    );

    expect(screen.getByText("Solve today's puzzle to keep it going.")).toBeVisible();
  });

  it("loads the new day's puzzle when the day turned while the page was open", async () => {
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue(GUEST),
      getDailyPuzzle: vi
        .fn()
        .mockResolvedValueOnce(view())
        .mockResolvedValueOnce(view({ day: "2026-10-21", number: 3 })),
      playDailyMove: vi.fn().mockRejectedValue(
        new AppRequestError({
          code: "CONFLICT",
          message: "A new puzzle is out",
          details: { reason: "dayOver" },
        }),
      ),
    });
    await open(api);
    const user = userEvent.setup();

    await user.click(square("f8"));
    await user.click(square("d8"));

    expect(await screen.findByRole("heading", { level: 1, name: "Daily chess puzzle #3" })).toBeVisible();
    expect(api.getDailyPuzzle).toHaveBeenCalledTimes(2);
  });

  it("says what went wrong with a refused move and keeps the page as it was", async () => {
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue(GUEST),
      getDailyPuzzle: vi.fn().mockResolvedValue(view()),
      playDailyMove: vi
        .fn()
        .mockRejectedValue(
          new AppRequestError({ code: "RATE_LIMITED", message: "Too many puzzle moves, wait a minute" }),
        ),
    });
    await open(api);
    const user = userEvent.setup();

    await user.click(square("f8"));
    await user.click(square("d8"));

    expect(await screen.findByText("Too many puzzle moves, wait a minute")).toBeVisible();
    expect(api.getDailyPuzzle).toHaveBeenCalledTimes(1);
  });

  it("offers to try again when the puzzle does not load", async () => {
    const api = fakeApi({
      getDailyPuzzle: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(view()),
    });
    renderApp({ path: "/daily/chess", api });

    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("grid", { name: "Chess board" })).toBeVisible();
  });

  it("is the not found page for a kind of puzzle there is none of", async () => {
    renderApp({ path: "/daily/sudoku" });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});
