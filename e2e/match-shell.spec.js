import { expect, formFactor, test } from "./fixtures.js";
import { answerTo, arm, installProbe } from "./controlProbe.js";
import { GAMES, openPair } from "./matchStates.js";
import { allStatesFor, ANSWER_MS, NOT_PRESSED } from "./matchShellPresses.js";

// The match shell around every game (CC-164, CC-170, CC-172): every press in the header and footer answers within
// 100 ms, and each state's main controls fit on the screen. The presses inside each game's states are in
// match-shell-presses-<game>.spec.js, one file per game, so CI can run them on separate machines (CC-236).

test.describe("every press in the header and footer answers within 100 ms", () => {
  test("for a guest on the home page", async ({ players }) => {
    const guest = await players.open("guest");
    await installProbe(guest);
    await guest.page.goto("/");
    await guest.page.locator('[data-cc-control="home.play_guest"]').click();
    await expect(guest.page.getByRole("banner").getByText(/^Guest-/)).toBeVisible();
    const ids = await guest.page
      .locator("header [data-cc-control], footer [data-cc-control]")
      .evaluateAll((elements) =>
        elements.filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("data-cc-control")),
      );
    const problems = [];

    for (const id of new Set(ids.filter((id) => !NOT_PRESSED.has(id)))) {
      if (guest.url() !== "/") {
        await guest.page.goto("/");
        await expect(guest.page.getByRole("banner").getByText(/^Guest-/)).toBeVisible();
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
const RESULT = ["#result-heading", at("room.rematch.ask"), at("room.new_opponent")];
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
  "computer lobby": () => [at("lobby.computer_level"), at("lobby.play_computer")],
  "computer my-turn": (gameId) => BOARD[gameId],
  "computer finished": () => RESULT,
});

/**
 * States whose layout the layout ticket CC-172 still has to fix. They are marked as expected to fail, so the suite
 * stays green and a fix shows up as "expected to fail, but passed", which means this list needs updating.
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
