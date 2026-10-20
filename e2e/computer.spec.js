import { expect, test } from "./fixtures.js";

// A visitor plays a computer character from a game's page (CC-138, CC-221, CC-225): one tap on "Play Rocky" opens
// a room with Rocky seated and the game on, labelled as a computer player everywhere. Rocky's throw is locked
// before the visitor chooses and checked in the browser after each round. The board says so in plain words, and the
// proof is folded away in the explanation (CC-254). The server pauses like a person before each computer move, as in
// production.

const RPS = "/games/rock-paper-scissors";
const phase = (player) => player.page.locator("[data-cc-phase]");
// Dialogs are drawn on the page's body, outside main (Modal.jsx), so their buttons are looked for there too.
const control = (player, id) => player.page.locator(`:is(main, [role="dialog"]) [data-cc-control="${id}"]`);
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

const LOCKED = "Rocky has chosen. It's locked, so Rocky can't change it after you pick.";
const FAIR = "✓ Fair: Rocky's choice didn't change";
const PROOF = "Show the proof (for the curious)";
/** A whole lock or key, and the short lock code the board showed before CC-254. */
const HEX_64 = /[0-9a-f]{64}/;
const SHORT_LOCK = /[0-9a-f]{4}…[0-9a-f]{3}/;

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
    await expect(player.page.getByText(LOCKED)).toBeVisible();
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
    await expect(visitor.page.getByText("Rocky has chosen", { exact: true })).toBeVisible();
    // Before the first round is over nothing about Rocky's throw reached this browser, only its lock.
    expect(visitor.record.socketFrames.join("\n")).not.toMatch(/"salt"/);
    await playRpsOut(visitor);

    await expect(visitor.page.locator("#result-heading")).toHaveText(/^You (won|lost)/);
    await expect(visitor.page.getByText(FAIR)).toBeVisible();
    await expect(
      visitor.page.getByRole("status").filter({ hasText: /XP left today from computer games/ }),
    ).toBeVisible();
    await control(visitor, "rps.fairness").click();
    const dialog = visitor.page.getByRole("dialog", { name: "How we keep it fair" });
    await expect(dialog).toContainText("Rocky is a computer player and picks first, in secret");
    await expect(dialog).toContainText(FAIR);
    await visitor.page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("the board says it in plain words with no codes, and the proof is one press away in the explanation (CC-254)", async ({
    players,
  }) => {
    const visitor = await players.open("visitor");
    await playComputer(visitor, { slug: "rock-paper-scissors", character: "Rocky" });
    const main = visitor.page.locator("main");
    await expect(main).toContainText("Best of 3 · You 0 – Rocky 0 · first to 2 wins");
    await expect(visitor.page.getByText(LOCKED)).toBeVisible();
    expect(await main.innerText()).not.toMatch(HEX_64);
    expect(await main.innerText()).not.toMatch(SHORT_LOCK);

    await hands(visitor).getByRole("button", { name: /Rock/ }).click();
    await expect.poll(() => roundsPlayed(visitor), { timeout: 10_000 }).toBe(1);

    await expect(visitor.page.getByText(FAIR)).toBeVisible();
    await expect(main).toContainText(/Best of 3 · You [01] – Rocky [01] · first to 2 wins/);
    const shown = await main.innerText();
    expect(shown).not.toMatch(HEX_64);
    expect(shown).not.toMatch(SHORT_LOCK);
    expect(shown).not.toContain('{"choice"');
    await control(visitor, "rps.fairness").click();
    const dialog = visitor.page.getByRole("dialog", { name: "How we keep it fair" });
    await expect(dialog.getByRole("listitem")).toHaveCount(3);
    await expect(dialog.getByText("Lock shown before you picked", { exact: true })).toBeHidden();
    // One press opens the proof. Here it is the keyboard: Shift and Tab from "Got it" reach it, Enter opens it.
    await visitor.page.keyboard.press("Shift+Tab");
    await expect(dialog.getByText(PROOF)).toBeFocused();
    await visitor.page.keyboard.press("Enter");
    await expect(dialog.getByText("Lock shown before you picked", { exact: true })).toBeVisible();
    expect(await dialog.innerText()).toMatch(HEX_64);
    await expect(dialog).toContainText("Anyone can check it with any SHA-256 tool");
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
    await expect(visitor.page.getByText(LOCKED)).toBeVisible();
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
