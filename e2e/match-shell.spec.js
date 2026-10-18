import { expect, formFactor, test } from "./fixtures.js";
import { answerTo, arm, installProbe, otherSaw } from "./controlProbe.js";
import { computerStatesFor, GAMES, openPair, snapshot, statesFor } from "./matchStates.js";

// Every click gives a visible answer (CC-164, CC-170, docs/ux/MATCH_EXPERIENCE.md "Button feedback standard").
// In each state of every game, two players are brought into the state and every control on the page
// (`data-cc-control`) is pressed in turn. The test fails when the player who pressed sees no change on the page,
// no message to the server, no sound and no new address within 100 ms, or when a press that concerns the other
// player shows them nothing within a second. A press that ended the state (a move, a rematch) is followed by a
// fresh room in the same state, so each control is pressed in the state it belongs to.

const ANSWER_MS = 100;
const OTHER_MS = 1_000;

/** Presses that change something on the other player's screen as well, when they can act. */
const REACHES_OTHER = new Set([
  "ttt.cell",
  "rps.choice",
  "chess.offer_draw",
  "room.rematch.ask",
  "room.rematch.accept",
  "room.rematch.cancel",
  "room.request.accept",
  "room.request.decline",
  "room.request.cancel",
  "room.new_opponent",
]);

/** Presses that end the state they are pressed in, besides links to other pages. */
const LEAVES_STATE = new Set([
  ...REACHES_OTHER,
  "room.leave",
  "room.leave.confirm",
  "chess.resign.confirm",
  "lobby.play_computer",
  "lobby.create",
]);

/** Controls not pressed here, with the reason. */
const NOT_PRESSED = new Map([
  ["invite.share", "opens the system share sheet, which a test browser cannot close"],
  ["header.skip", "shows only while it has the keyboard focus, and is checked by the keyboard tests"],
]);

/** The distinct controls on screen: one of each name, and one blocked and one ready where both exist. */
async function controlsOn(page) {
  const found = await page.locator("main [data-cc-control]").evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        id: element.getAttribute("data-cc-control"),
        blocked: element.getAttribute("aria-disabled") === "true",
        link: element.tagName === "A" && !element.hasAttribute("download"),
      })),
  );
  const seen = new Map(found.map((entry) => [`${entry.id}:${entry.blocked}`, entry]));
  // Presses that leave the state go last, so fewer states have to be built again.
  const leaves = (entry) => !entry.blocked && (entry.link || LEAVES_STATE.has(entry.id));
  return [...seen.values()]
    .filter((entry) => !NOT_PRESSED.has(entry.id))
    .sort((a, b) => Number(leaves(a)) - Number(leaves(b)));
}

const selector = ({ id, blocked }) =>
  `main [data-cc-control="${id}"]${blocked ? '[aria-disabled="true"]' : ':not([aria-disabled="true"])'}`;

/** Closes a dialog a press opened (Leave room, Resign), so the next press finds the page as it was. */
async function putAway(page) {
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  }
}

/** A new pair of players brought into the state, and where both stand once it is reached. */
async function enter(players, build) {
  const state = await build(await openPair(players));
  const room = [state.clicker, ...(state.other ? [state.other] : [])];
  return { ...state, room, expected: await snapshot(room) };
}

/**
 * The control on the clicker's screen, or undefined when this state does not show it. Some controls come a moment
 * after the state itself, such as the save progress card once the win's XP has arrived, so it waits a little.
 */
async function find(state, entry) {
  const target = state.clicker.page.locator(selector(entry)).first();
  return target.waitFor({ state: "visible", timeout: 3_000 }).then(
    () => target,
    () => undefined,
  );
}

/**
 * Presses every control the clicker sees in this state and lists every press nobody could see an answer to. When
 * a press left the state, or changed the control the next press needs (stepping back through the moves makes
 * "Latest move" ready), the state is built again with a new pair of players.
 *
 * @param {{ players: object, build: (pair: object) => Promise<{ clicker: object, other?: object }>, name: string }} input
 */
async function pressEverything({ players, build, name }) {
  let state = await enter(players, build);
  const problems = [];
  const controls = await controlsOn(state.clicker.page);
  expect(controls.length, `${name}: the page shows controls`).toBeGreaterThan(0);

  for (const entry of controls) {
    const now = await snapshot(state.room);
    let target =
      JSON.stringify(now) === JSON.stringify(state.expected) ? await find(state, entry) : undefined;
    if (target === undefined) {
      state = await enter(players, build);
      target = await find(state, entry);
    }
    const label = `${name}: ${entry.id}${entry.blocked ? " (blocked)" : ""}`;
    if (target === undefined) {
      problems.push(`${label}: on screen at first, but not when the state was built again`);
      continue;
    }
    const { page } = state.clicker;
    const armed = await arm(page);
    const otherArmed = state.other ? await arm(state.other.page) : undefined;
    // The browser's own download bar is the answer to Download PGN, and it can take a moment to start.
    const downloads = await target.evaluate((element) => element.hasAttribute("download"));
    const downloaded = downloads
      ? page.waitForEvent("download", { timeout: 5_000 }).then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);
    await target.click({ force: entry.blocked });
    await page.waitForTimeout(ANSWER_MS + 50);
    const answer = await answerTo(page, armed);
    if (!(await downloaded) && !(answer.ms <= ANSWER_MS)) {
      problems.push(
        `${label}: nothing visible within ${ANSWER_MS} ms (fastest answer: ${answer.kind} after ${answer.ms} ms)`,
      );
    }
    if (REACHES_OTHER.has(entry.id) && !entry.blocked && otherArmed !== undefined) {
      if (!(await otherSaw(state.other.page, otherArmed, OTHER_MS))) {
        problems.push(`${label}: the other player saw nothing within ${OTHER_MS} ms`);
      }
    }
    await putAway(page);
    if (answer.kind === "navigation") {
      // Back to the room is quicker than building the state again, and the check above says whether it worked.
      await page.goBack().catch(() => undefined);
      await page
        .locator("[data-cc-phase]")
        .waitFor({ timeout: 5_000 })
        .catch(() => undefined);
    }
  }
  return problems;
}

/** Every state of a game, between two people and against the game's computer character (CC-221). */
const allStatesFor = (gameId) => ({ ...statesFor(gameId), ...computerStatesFor(gameId) });

for (const gameId of Object.keys(GAMES)) {
  test.describe(`every press in ${gameId} answers within 100 ms`, () => {
    for (const [name, build] of Object.entries(allStatesFor(gameId))) {
      test(`${name}`, async ({ players }) => {
        test.setTimeout(360_000);

        const problems = await pressEverything({ players, build, name: `${gameId} ${name}` });

        expect(problems, "presses without a visible answer").toEqual([]);
      });
    }
  });
}

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
