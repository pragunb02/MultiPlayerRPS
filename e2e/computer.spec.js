import { expect, test } from "./fixtures.js";

// A visitor plays a computer character from a game's page (CC-138, CC-221, CC-225): one tap on "Play Rocky" opens
// a room with Rocky seated and the game on, labelled as a computer player everywhere. Rocky's throw is locked
// before the visitor chooses and checked in the browser after each round. The server pauses like a person before
// each computer move, as in production.

const RPS = "/games/rock-paper-scissors";
const phase = (player) => player.page.locator("[data-cc-phase]");
const control = (player, id) => player.page.locator(`main [data-cc-control="${id}"]`);
const hands = (player) => player.page.getByRole("group", { name: "Your choice" });
const seats = (player) => player.page.getByRole("list", { name: "Players" });
const roomPath = /^\/games\/[a-z-]+\/rooms\/[A-Z0-9]{6}$/;

/** Opens a game's page, picks a level and presses the main button. Answers how long the first move took to open. */
async function playComputer(player, { slug, character, level }) {
  await player.page.goto(`/games/${slug}`);
  await expect(player.page).toHaveTitle(/ClassiCade/);
  if (level !== undefined) {
    await player.page.getByRole("group", { name: "Level" }).getByRole("button", { name: level }).click();
  }
  const pressed = Date.now();
  await player.page.getByRole("button", { name: `Play ${character}` }).click();
  await expect(phase(player)).toHaveAttribute("data-cc-phase", "my-turn", { timeout: 15_000 });
  const ms = Date.now() - pressed;
  expect(player.url()).toMatch(roomPath);
  return ms;
}

const roundsPlayed = (player) =>
  player.page.getByRole("list", { name: "Rounds" }).getByRole("listitem").count();

/**
 * Throws Rock until the match is over. Rocky's throw for each round is locked before it. Rocky may have thrown
 * already, then the round is over as soon as the visitor throws, so each round waits for the list of rounds to grow.
 */
async function playRpsOut(player) {
  for (let round = 0; round < 30; round++) {
    await expect(phase(player)).toHaveAttribute("data-cc-phase", /my-turn|finished/, { timeout: 10_000 });
    if ((await phase(player).getAttribute("data-cc-phase")) === "finished") return;
    await expect(player.page.getByText(/Rocky has locked in a throw/)).toBeVisible();
    const before = await roundsPlayed(player);
    await hands(player).getByRole("button", { name: /Rock/ }).click();
    await expect.poll(() => roundsPlayed(player), { timeout: 10_000 }).toBeGreaterThan(before);
  }
  throw new Error("the match did not end");
}

const ttt = (player) => player.page.getByRole("grid", { name: "Tic-Tac-Toe board" });

/** Plays the first empty cell on every turn until the game ends. */
async function playTicTacToeOut(player) {
  for (let turn = 0; turn < 12; turn++) {
    await expect(phase(player)).toHaveAttribute("data-cc-phase", /my-turn|finished/, { timeout: 10_000 });
    if ((await phase(player).getAttribute("data-cc-phase")) === "finished") return;
    await ttt(player)
      .getByRole("gridcell", { name: /: empty$/ })
      .first()
      .click();
    await expect(phase(player)).not.toHaveAttribute("data-cc-phase", "my-turn");
  }
  throw new Error("the game did not end");
}

test.describe("a visitor plays a computer character", () => {
  test("Play Rocky: the game starts at once, the lock is checked, and the result says what XP is left today", async ({
    players,
  }, testInfo) => {
    const visitor = await players.open("visitor");

    const ms = await playComputer(visitor, { slug: "rock-paper-scissors", character: "Rocky" });
    testInfo.annotations.push({ type: "time to first move", description: `${ms} ms from the lobby` });
    process.stdout.write(`time to first move (${testInfo.project.name}): ${ms} ms\n`);
    // The ticket's budget is 2 seconds locally (CC-221).
    expect(ms).toBeLessThan(2_000);

    await expect(seats(visitor)).toContainText("Rockycomputer · Easy");
    await expect(visitor.page.getByText(/Rocky is a computer player\. This game counts/)).toBeVisible();
    await expect(visitor.page.getByText("Rocky has locked in", { exact: true })).toBeVisible();
    // Before the first round is over nothing about Rocky's throw reached this browser, only its lock.
    expect(visitor.record.socketFrames.join("\n")).not.toMatch(/"salt"/);
    await playRpsOut(visitor);

    await expect(visitor.page.locator("#result-heading")).toHaveText(/^You (won|lost)/);
    await expect(visitor.page.getByText("Lock checked ✓")).toBeVisible();
    await expect(
      visitor.page.getByRole("status").filter({ hasText: /XP left today from computer games/ }),
    ).toBeVisible();
    await control(visitor, "rps.fairness").click();
    const dialog = visitor.page.getByRole("dialog", { name: "How we keep it fair" });
    await expect(dialog).toContainText("Rocky is a computer player and chooses before you do");
    await expect(dialog).toContainText("Lock checked ✓");
    await visitor.page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Rocky accepts a rematch at once, and the series goes on in the same room", async ({ players }) => {
    const visitor = await players.open("visitor");
    await playComputer(visitor, { slug: "rock-paper-scissors", character: "Rocky", level: "Hard" });
    const room = visitor.url();
    await playRpsOut(visitor);

    await control(visitor, "room.rematch.ask").click();

    await expect(phase(visitor)).toHaveAttribute("data-cc-phase", "my-turn");
    expect(visitor.url()).toBe(room);
    await expect(seats(visitor)).toContainText("Rockycomputer · Hard");
    await expect(visitor.page.getByText(/Rocky has locked in a throw/)).toBeVisible();
  });

  test("Tic-Tac-Toe against Unbeatable Pip ends in a draw or a loss", async ({ players }) => {
    const visitor = await players.open("visitor");
    await visitor.page.goto("/games/tic-tac-toe");
    await visitor.page
      .getByRole("group", { name: "Level" })
      .getByRole("button", { name: "Unbeatable" })
      .click();
    await visitor.page.getByRole("button", { name: "Play Pip" }).click();
    await expect(seats(visitor)).toContainText("Pipcomputer · Unbeatable");

    await playTicTacToeOut(visitor);

    await expect(visitor.page.locator("#result-heading")).toHaveText(/^(You lost|Draw|It's a draw)/);
  });

  test("chess against Queen Vee the beginner: a move, then resigning ends it", async ({ players }) => {
    const visitor = await players.open("visitor");
    await playComputer(visitor, { slug: "chess", character: "Queen Vee", level: "Beginner" });
    const board = visitor.page.getByRole("grid", { name: "Chess board" });
    await expect(board).toBeVisible();
    await expect(seats(visitor)).toContainText("Queen Veecomputer · Beginner");

    // Colours are drawn at random. White sees a8 in the top left corner.
    const square = (name) => board.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) });
    const white = (await square("a8").boundingBox()).y < (await square("a1").boundingBox()).y;
    await square(white ? "e2" : "e7").click();
    await square(white ? "e4" : "e5").click();
    await expect(phase(visitor)).toHaveAttribute("data-cc-phase", "my-turn", { timeout: 10_000 });
    await control(visitor, "chess.resign").click();
    await control(visitor, "chess.resign.confirm").click();

    await expect(visitor.page.locator("#result-heading")).toHaveText(/^You lost/);
  });

  test("Back leaves the game for the lobby, Forward and reload come back to the same game", async ({
    players,
  }) => {
    const visitor = await players.open("visitor");
    await playComputer(visitor, { slug: "rock-paper-scissors", character: "Rocky" });
    const room = visitor.url();

    await visitor.page.goBack();
    await expect(visitor.page.getByRole("button", { name: "Play Rocky" })).toBeVisible();
    expect(visitor.url()).toBe(RPS);
    await visitor.page.goForward();
    await expect(phase(visitor)).toHaveAttribute("data-cc-phase", /my-turn|their-turn/);
    expect(visitor.url()).toBe(room);
    await visitor.page.reload();
    await expect(phase(visitor)).toHaveAttribute("data-cc-phase", /my-turn|their-turn/);
    await expect(seats(visitor)).toContainText("Rockycomputer");
    expect(visitor.url()).toBe(room);
  });

  test("New opponent after a game against the computer closes the room and opens the lobby", async ({
    players,
  }) => {
    const visitor = await players.open("visitor");
    await playComputer(visitor, { slug: "rock-paper-scissors", character: "Rocky" });
    const room = visitor.url();
    await playRpsOut(visitor);

    await control(visitor, "room.new_opponent").click();

    await expect(visitor.page.getByRole("button", { name: "Play Rocky" })).toBeVisible();
    expect(visitor.url()).toBe(RPS);
    await visitor.page.goto(room);
    await expect(visitor.page.getByRole("heading", { name: "Room closed" })).toBeVisible();
  });
});
