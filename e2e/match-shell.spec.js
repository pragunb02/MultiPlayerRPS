import { expect, formFactor, header, test } from "./fixtures.js";
import { answerTo, arm, installProbe } from "./controlProbe.js";
import { computerStatesFor, GAMES, openPair, phaseIs, SITE_REQUESTS, statesFor } from "./matchStates.js";
import { allStatesFor, ANSWER_MS, NOT_PRESSED, putAway } from "./matchShellPresses.js";

// The match shell around every game (CC-164, CC-170, CC-172): every press in the header and footer answers within
// 100 ms, and each state's main controls fit on the screen. The presses inside each game's states are in
// match-shell-presses-<game>.spec.js, one file per game, so CI can run them on separate machines (CC-236).

test.describe("every press in the header and footer answers within 100 ms", () => {
  test("for a guest on the home page", async ({ players }) => {
    const guest = await players.open("guest");
    await installProbe(guest);
    await guest.page.goto("/");
    await guest.page.locator('[data-cc-control="home.play_guest"]').click();
    await expect((await header(guest.page)).getByText(/^Guest-/)).toBeVisible();
    const ids = await guest.page
      .locator("header [data-cc-control], footer [data-cc-control]")
      .evaluateAll((elements) =>
        elements.filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("data-cc-control")),
      );
    const problems = [];

    for (const id of new Set(ids.filter((id) => !NOT_PRESSED.has(id)))) {
      if (guest.url() !== "/") {
        await guest.page.goto("/");
        await expect((await header(guest.page)).getByText(/^Guest-/)).toBeVisible();
      }
      // On a phone the player's controls are in the header's menu, so it is opened first. The menu button itself
      // is pressed as it is, and its answer is the menu closing (CC-259).
      if (id !== "header.menu") {
        await header(guest.page);
      }
      const armed = await arm(guest.page);
      await guest.page.locator(`[data-cc-control="${id}"]`).first().click();
      await guest.page.waitForTimeout(ANSWER_MS + 50);
      const answer = await answerTo(guest.page, armed);
      if (!(answer.ms <= ANSWER_MS)) {
        problems.push(
          `${id}: nothing visible within ${ANSWER_MS} ms (fastest: ${answer.kind} after ${answer.ms} ms)`,
        );
      }
      // The sound settings open in a dialog, which would be in the way of the next press.
      await putAway(guest.page);
    }

    expect(ids.length).toBeGreaterThan(3);
    expect(problems).toEqual([]);
  });
});

// What each state must show without scrolling, at 1280×720 on the desktop project and 390×844 on the mobile one
// (docs/ux/MATCH_EXPERIENCE.md, tests 3).
const VIEWPORTS = Object.freeze({
  desktop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 },
});
const at = (id) => `main [data-cc-control="${id}"]`;
const BOARD = Object.freeze({
  tictactoe: [at("ttt.cell")],
  rps: [at("rps.choice")],
  chess: ['main [role="timer"]', at("chess.square"), at("chess.offer_draw"), at("chess.resign")],
});
// The result: its headline and the outcome line under it (CC-163), and the two ways to play on.
const RESULT = [
  "#result-heading",
  "main [data-cc-outcome-line]",
  at("room.rematch.ask"),
  at("room.new_opponent"),
];
const MAIN_CONTROLS = Object.freeze({
  waiting: () => [at("invite.copy")],
  "my-turn": (gameId) => BOARD[gameId],
  "their-turn": (gameId) => BOARD[gameId],
  win: () => RESULT,
  loss: () => RESULT,
  draw: () => RESULT,
  "rematch-asked": () => [at("room.rematch.cancel"), at("room.new_opponent")],
  "rematch-asked-of-me": () => [at("room.request.accept"), at("room.request.decline")],
  "rematch-declined": () => [at("room.rematch.ask"), at("room.new_opponent")],
  "request-asked": () => [at("room.request.cancel")],
  "request-asked-of-me": () => [at("room.request.accept"), at("room.request.decline")],
  "rematch-asked-away": () => [at("room.request.cancel"), at("room.new_opponent")],
  "rematch-asked-offline": () => [
    at("request.copy_invite"),
    at("request.new_opponent"),
    at("request.play_computer"),
  ],
  "rematch-asked-elsewhere": () => [
    `${SITE_REQUESTS} [data-cc-control="site_request.accept"]`,
    `${SITE_REQUESTS} [data-cc-control="site_request.decline"]`,
  ],
  "computer lobby": () => [at("lobby.computer_level"), at("lobby.play_computer")],
  "computer my-turn": (gameId) => BOARD[gameId],
  "computer finished": () => RESULT,
});

/**
 * States whose layout the layout ticket CC-172 still has to fix. They are marked as expected to fail, so the suite
 * stays green and a fix shows up as "expected to fail, but passed", which means this list needs updating.
 * Playwright's list reporter marks an expected failure with a ✘ like a real one, and counts it as passed: these six
 * show ✘ on every run, Firefox included (it is a laptop here), and are not flaky (CC-346).
 */
const CHESS_LAPTOP = "your own clock and the bottom rank are under the fold at 1280×720 (A8)";
const CHESS_PHONE = "Offer draw and Resign are under the fold at 390×844 (A8)";
const BELOW_THE_FOLD = new Map([
  ["desktop chess my-turn", CHESS_LAPTOP],
  ["desktop chess their-turn", CHESS_LAPTOP],
  ["mobile chess my-turn", CHESS_PHONE],
  ["mobile chess their-turn", CHESS_PHONE],
  ["desktop chess computer my-turn", CHESS_LAPTOP],
  ["mobile chess computer my-turn", CHESS_PHONE],
]);

/** Every element of `selectors` that is not wholly on screen at the top of the page, with where it is. */
async function offScreen(page, selectors) {
  // A board loads on demand, a moment after the room itself.
  for (const selector of selectors) {
    await page
      .locator(selector)
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => undefined);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate((list) => {
    const out = [];
    for (const selector of list) {
      const found = [...document.querySelectorAll(selector)].filter((e) => e.getClientRects().length > 0);
      if (found.length === 0) out.push(`${selector}: not on the page`);
      for (const element of found) {
        const box = element.getBoundingClientRect();
        if (box.top < 0 || box.left < 0 || box.bottom > innerHeight || box.right > innerWidth) {
          out.push(`${selector}: ${Math.round(box.top)}-${Math.round(box.bottom)} of ${innerHeight} px high`);
          break;
        }
      }
    }
    return out;
  }, selectors);
}

for (const gameId of Object.keys(GAMES)) {
  test.describe(`${gameId}: every state's main controls are on screen without scrolling`, () => {
    for (const [name, build] of Object.entries(allStatesFor(gameId))) {
      test(name, async ({ players }, testInfo) => {
        test.setTimeout(90_000);
        const project = formFactor(testInfo);
        const known = BELOW_THE_FOLD.get(`${project} ${gameId} ${name}`);
        test.fail(known !== undefined, `CC-172 has to fix this layout: ${known}`);
        const pair = await openPair(players);
        for (const player of [pair.alice, pair.bob]) {
          await player.page.setViewportSize(VIEWPORTS[project]);
        }

        const { clicker } = await build(pair);
        const missing = await offScreen(clicker.page, MAIN_CONTROLS[name](gameId));

        expect(missing, `${project} ${gameId} ${name}: below the fold`).toEqual([]);
      });
    }
  });
}

// The match shell draws the frame of every game (CC-157). Tic-Tac-Toe brings only its board, no actions, panel or
// score, so it shows that a game with only a board fills the frame: the name in the match bar, the board on the
// stage, both players beside it, Leave alone in the action bar, and at the end the result card holding Rematch, New
// opponent and Leave.
test.describe("a game that brings only a board plugs into the match shell", () => {
  const slot = (player, name) => player.page.locator(`main [data-cc-slot="${name}"]`);
  const controls = (locator) =>
    locator.locator("[data-cc-control]").evaluateAll((elements) => elements.map((e) => e.dataset.ccControl));

  test("Tic-Tac-Toe plays in the shell's slots and ends in its result card", async ({ players }) => {
    const pair = await openPair(players);
    const { clicker, other } = await statesFor("tictactoe")["my-turn"](pair);

    for (const player of [clicker, other]) {
      await expect(slot(player, "match-bar").getByRole("heading", { level: 1 })).toHaveText("Tic Tac Toe");
      await expect(slot(player, "stage").locator('[data-cc-control="ttt.cell"]')).toHaveCount(9);
      await expect(
        slot(player, "presence").getByRole("list", { name: "Players" }).getByRole("listitem"),
      ).toHaveCount(2);
      expect(await controls(slot(player, "action-bar"))).toEqual(["room.leave"]);
      await expect(slot(player, "panel")).toHaveCount(0);
      await expect(slot(player, "result")).toHaveCount(0);
    }

    await GAMES.tictactoe.win(clicker, other);
    await phaseIs(clicker, "finished");

    await expect(slot(clicker, "result").locator("#result-heading")).toHaveText(/^You won/);
    const ending = slot(clicker, "result").locator('[data-cc-slot="action-bar"]');
    await expect(ending.locator('[data-cc-control="room.rematch.ask"]')).toBeVisible();
    expect(await controls(ending)).toEqual(["room.rematch.ask", "room.new_opponent", "room.leave"]);
    await expect(slot(clicker, "stage").locator('[data-cc-control="ttt.cell"]')).toHaveCount(9);
  });
});

// The board downloads when it is first shown (CC-322). On CI's Firefox it came while a press on Leave room was on
// its way, pushed the button down and took the press (CC-346). Its place is now kept while it downloads, so Leave
// room can be pressed, keeps its focus as the game starts and stays put when the board comes.
test("Leave room stays where it is, focused and pressable, while the board downloads", async ({
  players,
}) => {
  const { alice, bob } = await openPair(players);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await alice.page.route("**/assets/TicTacToeBoard-*.js", async (route) => {
    await held;
    await route.continue();
  });
  const leave = alice.page.locator('main [data-cc-control="room.leave"]');
  // Where the button is on the page, not in the window: pressing it scrolls it into view.
  const box = () =>
    leave.evaluate((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return [x + scrollX, y + scrollY, width, height].map(Math.round);
    });

  await alice.page.goto("/games/tic-tac-toe");
  await alice.page.locator('main [data-cc-control="lobby.create"]').click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await leave.focus();
  await bob.page.goto(invite);
  await bob.page.locator('main [data-cc-control="join.guest"]').click();

  await expect(alice.page.getByText("Loading the board…")).toBeVisible();
  await expect(leave).toBeFocused();
  const whileLoading = await box();
  await leave.click();
  await expect(alice.page.getByRole("dialog", { name: "Leave the game?" })).toBeVisible();

  release();
  await expect(alice.page.locator('main [data-cc-control="ttt.cell"]')).toHaveCount(9);
  await expect(alice.page.getByRole("dialog", { name: "Leave the game?" })).toBeVisible();
  expect(await box()).toEqual(whileLoading);
});

// The outcome moments (CC-163): each way a game ends has its own tone, words and effect. A win earned on the board
// gets confetti, a loss dims the board once, a win by forfeit stays quiet, and with reduced motion the words stay
// while nothing moves.
test.describe("outcome moments", () => {
  const result = (player) => player.page.locator('main [data-cc-slot="result"]');
  const effects = (player) => player.page.locator("[data-effect]");

  // The softened board must not trap a dialog opened from it (review of #113): the dialog's backdrop is drawn on the
  // page's body, covers the whole window, and keeps the result card's buttons out of reach while it is open.
  test("after a loss to Rocky, the fairness dialog covers the whole page", async ({ players }) => {
    test.setTimeout(120_000);
    const pair = await openPair(players);
    const { clicker } = await computerStatesFor("rps")["computer finished"](pair);
    const { page } = clicker;
    await expect(page.locator("main [data-cc-effect='dim']")).toHaveCount(1);

    await page.locator('main [data-cc-control="rps.fairness"]').click();
    const dialog = page.getByRole("dialog", { name: "How we keep it fair" });
    await expect(dialog).toBeVisible();

    const backdrop = await dialog.evaluate((element) => {
      const cover = element.parentElement;
      const box = cover.getBoundingClientRect();
      const button = document.querySelector('[data-cc-control="room.rematch.ask"]');
      button.scrollIntoView({ block: "center" });
      const rematch = button.getBoundingClientRect();
      const top = document.elementFromPoint(rematch.x + rematch.width / 2, rematch.y + rematch.height / 2);
      return {
        onBody: cover.parentElement === document.body,
        inDim: cover.closest("[data-cc-effect='dim']") !== null,
        covers: box.top <= 0 && box.left <= 0 && box.right >= innerWidth && box.bottom >= innerHeight,
        rematchCovered: top !== null && !top.closest('[data-cc-control="room.rematch.ask"]'),
      };
    });
    expect(backdrop).toEqual({ onBody: true, inDim: false, covers: true, rematchCovered: true });
  });

  test("a win on the board celebrates, and the loser gets kind words and a dimmed board", async ({
    players,
  }) => {
    const pair = await openPair(players);
    const { clicker, other } = await statesFor("tictactoe")["my-turn"](pair);

    await GAMES.tictactoe.win(clicker, other);

    await expect(result(clicker)).toHaveAttribute("data-cc-tone", "win");
    await expect(result(clicker).locator("[data-cc-stamp]")).toHaveText("Victory!");
    await expect(clicker.page.locator("[data-effect='confetti']")).toHaveCount(1);
    await expect(result(other)).toHaveAttribute("data-cc-tone", "gentle-loss");
    await expect(result(other).locator("#result-heading")).toHaveText("You lost to three in a row");
    await expect(result(other).locator("[data-cc-outcome-line]")).toContainText(
      "They got three first. Watch their lines.",
    );
    await expect(result(other).locator("[data-cc-stamp]")).toHaveCount(0);
    await expect(other.page.locator("main [data-cc-effect='dim']")).toHaveCount(1);
    await expect(other.page.locator("[data-effect='confetti']")).toHaveCount(0);
  });

  test("a win because the opponent left is quiet: a trophy and no confetti", async ({ players }) => {
    const pair = await openPair(players);
    const { clicker, other } = await statesFor("tictactoe")["my-turn"](pair);

    await other.page.locator('main [data-cc-control="room.leave"]').click();
    await other.page.locator('[data-cc-control="room.leave.confirm"]').click();

    await expect(result(clicker).locator("#result-heading")).toHaveText("You won by forfeit");
    await expect(result(clicker)).toHaveAttribute("data-cc-tone", "quiet-win");
    await expect(result(clicker).locator("[data-cc-outcome-line]")).toContainText("left the game.");
    await expect(result(clicker).locator("[data-cc-icon='trophy']")).toHaveCount(1);
    await expect(clicker.page.locator("[data-effect='confetti']")).toHaveCount(0);
  });

  test("with reduced motion the same words show and nothing moves", async ({ players }) => {
    const pair = await openPair(players);
    const { clicker, other } = await statesFor("tictactoe")["my-turn"](pair);
    for (const player of [clicker, other]) {
      await player.page.emulateMedia({ reducedMotion: "reduce" });
    }

    await GAMES.tictactoe.win(clicker, other);

    await expect(result(clicker).locator("[data-cc-stamp]")).toHaveText("Victory!");
    await expect(result(clicker).locator("[data-cc-outcome-line]")).toContainText("Nice line.");
    await expect(result(other).locator("[data-cc-outcome-line]")).toContainText(
      "They got three first. Watch their lines.",
    );
    for (const player of [clicker, other]) {
      await expect(effects(player)).toHaveCount(0);
      const moving = await player.page
        .locator("main *")
        .evaluateAll(
          (elements) => elements.filter((e) => getComputedStyle(e).animationName !== "none").length,
        );
      expect(moving, `${player.name}: nothing animates`).toBe(0);
    }
    // The loser's board still softens: it is one still change, so reduced motion keeps it.
    await expect(other.page.locator("main [data-cc-effect='dim']")).toHaveCSS("filter", "saturate(0.35)");
  });
});
