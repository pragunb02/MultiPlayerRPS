import AxeBuilder from "@axe-core/playwright";
import { Chess } from "chess.js";
import { chessSolution } from "@classicade/games";
import { loadChessPuzzles } from "@classicade/server/src/persistence/puzzleCatalog.js";
import { scheduleOn } from "@classicade/server/src/domain/dailyPuzzles/schedule.js";
import { expect, formFactor, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// The daily chess puzzle (CC-144, ADR-061), for a visitor who becomes a guest by playing and then signs up. The
// test works out today's puzzle from the server's day and the set in the repository, the way the server does, so it
// knows the solution the page must never show before the end.

const PAGE = "/daily/chess";
const MOVES_API = "/api/daily/chess/moves";
// A journey takes seconds. One that starts this close to midnight in India could see the puzzle change under it.
const NEAR_MIDNIGHT_MS = 5 * 60 * 1000;

/**
 * Today's puzzle as the server says, and its solution: the player's moves in UCI, and the same moves in SAN as the
 * page would write them. The opponent's replies are left out: the page shows each one once it is played. The day
 * comes from the server's own answer, and a run within a few minutes of the next puzzle is skipped.
 *
 * @param {import("@playwright/test").Page} page
 */
async function todaysPuzzle(page) {
  const { puzzle: today } = await (await page.request.get("/api/daily/chess")).json();
  test.skip(today.nextAt - Date.now() < NEAR_MIDNIGHT_MS, "the next daily puzzle is a few minutes away");
  const puzzles = loadChessPuzzles();
  const { index, number } = scheduleOn({ day: today.day, count: puzzles.length });
  const puzzle = puzzles[index];
  const players = (moves) => moves.filter((_, at) => at % 2 === 0);
  return {
    puzzle,
    number,
    solution: puzzle.moves.filter((_, at) => at % 2 === 1),
    sans: players(chessSolution(puzzle)),
  };
}

/** A legal move in the starting position that is not the solution and does not give checkmate. */
function wrongMove(puzzle) {
  const chess = new Chess(puzzle.fen);
  chess.move({
    from: puzzle.moves[0].slice(0, 2),
    to: puzzle.moves[0].slice(2, 4),
    promotion: puzzle.moves[0][4],
  });
  const move = chess.moves({ verbose: true }).find((candidate) => {
    const after = new Chess(chess.fen());
    after.move(candidate);
    return candidate.lan !== puzzle.moves[1] && !after.isCheckmate();
  });
  return move.lan;
}

/**
 * Scans the page with axe in light and dark, as accessibility.spec.js does for every screen (CC-183): the ended
 * puzzle, with its result, share and solution, is a screen only this journey reaches.
 */
async function scanWithAxe(page) {
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.filter(({ impact }) => impact === "serious" || impact === "critical").map(({ id }) => id),
      colorScheme,
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: null, reducedMotion: null });
}

const square = (page, name) => page.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) });

/** Plays a move by clicking its two squares, and picks the piece when a pawn promotes. */
async function play(page, uci) {
  await square(page, uci.slice(0, 2)).click();
  await square(page, uci.slice(2, 4)).click();
  if (uci.length === 5) {
    const names = { q: "queen", r: "rook", b: "bishop", n: "knight" };
    await page
      .getByRole("group", { name: "Promote to" })
      .getByRole("button", { name: names[uci[4]] })
      .click();
  }
}

/** Whether a text holds any of the given moves. */
const holdsAny = (text, moves) => moves.some((move) => text.includes(move));

test.describe("the daily chess puzzle", () => {
  test("a visitor sees it, plays as a guest, solves it, shares a grid with no name, and keeps it on sign-up", async ({
    players,
  }, testInfo) => {
    const account = newAccount();
    const player = await players.open("puzzler", { secrets: [account.email, account.password] });
    const { page } = player;
    const { puzzle, number, solution, sans } = await todaysPuzzle(page);
    const answers = [];
    page.on("response", async (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/daily/")) answers.push(await response.text());
    });

    await page.goto(PAGE);
    await expect(page).toHaveTitle("Daily chess puzzle · ClassiCade");
    await expect(
      page.getByRole("heading", { level: 1, name: `Daily chess puzzle #${number}` }),
    ).toBeVisible();
    await expect(page.getByRole("grid", { name: "Chess board" })).toBeVisible();
    await expect(page.getByText("3 tries left")).toBeVisible();

    await play(page, wrongMove(puzzle));
    await expect(page.getByText("2 tries left", { exact: true })).toBeVisible();

    for (const [step, uci] of solution.entries()) {
      // Nothing the page shows or received may name a move still to find, in UCI or in SAN.
      const ahead = [...solution.slice(step), ...sans.slice(step)];
      expect(holdsAny(await page.locator("main").innerText(), ahead)).toBe(false);
      expect(answers.some((answer) => holdsAny(answer, ahead))).toBe(false);
      await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === MOVES_API),
        play(page, uci),
      ]);
    }

    await expect(page.getByRole("heading", { name: "Solved!" })).toBeVisible();
    await expect(page.getByText(/Puzzle streak: 1 day/)).toBeVisible();
    if (formFactor(testInfo) === "desktop") await scanWithAxe(page);
    const href = await page.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href");
    const message = new URL(href).searchParams.get("text");
    const { identity } = await (await page.request.get("/api/session")).json();
    expect(message).toContain(`ClassiCade Daily chess puzzle #${number}`);
    expect(message).toMatch(/🟨/);
    expect(message).not.toContain(identity.displayName);
    expect(message).not.toContain(identity.id);
    expect(holdsAny(message, [...solution, ...sans])).toBe(false);
    expect(message).toContain(PAGE);

    await page.goto("/signup");
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/");
    await page.getByRole("link", { name: "Daily chess puzzle" }).click();

    await expect(page).toHaveURL(PAGE);
    await expect(page.getByRole("heading", { name: "Solved!" })).toBeVisible();
    await expect(page.getByText(/Puzzle streak: 1 day/)).toBeVisible();
  });

  test("the first move can be made with the keyboard alone, and is read out", async ({ players }) => {
    const { page } = await players.open("keyboard");
    const { puzzle } = await todaysPuzzle(page);
    const wrong = wrongMove(puzzle);

    await page.goto(PAGE);
    await square(page, wrong.slice(0, 2)).focus();
    await page.keyboard.press("Enter");
    await square(page, wrong.slice(2, 4)).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText("is not the move. 2 tries left.")).toBeAttached();
    await expect(page.getByText("2 tries left", { exact: true })).toBeVisible();
  });
});
