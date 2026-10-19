import { expect, test } from "./fixtures.js";
import { answerTo, arm, otherSaw } from "./controlProbe.js";
import { computerStatesFor, openPair, snapshot, statesFor } from "./matchStates.js";

// Every click gives a visible answer (CC-164, CC-170, docs/ux/MATCH_EXPERIENCE.md "Button feedback standard").
// In each state of every game, two players are brought into the state and every control on the page
// (`data-cc-control`) is pressed in turn. The test fails when the player who pressed sees no change on the page,
// no message to the server, no sound and no new address within 100 ms, or when a press that concerns the other
// player shows them nothing within a second. A press that ended the state (a move, a rematch) is followed by a
// fresh room in the same state, so each control is pressed in the state it belongs to.

export const ANSWER_MS = 100;
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
  "request.new_opponent",
  "site_request.accept",
  "site_request.decline",
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
export const NOT_PRESSED = new Map([
  ["invite.share", "opens the system share sheet, which a test browser cannot close"],
  [
    "invite.whatsapp",
    "opens WhatsApp's site in a new tab, outside ClassiCade. share.spec.js checks its link",
  ],
  [
    "result.whatsapp",
    "opens WhatsApp's site in a new tab, outside ClassiCade. share.spec.js checks its link",
  ],
  [
    "result.share",
    "opens the system share sheet where the browser has one. share.spec.js presses it with and without one",
  ],
  ["header.skip", "shows only while it has the keyboard focus, and is checked by the keyboard tests"],
]);

/**
 * The distinct controls on screen: one of each name, and one blocked and one ready where both exist. `scope` is
 * where to look: the page's main part, or only the questions from other rooms on a page that is not a room.
 */
async function controlsOn(page, scope) {
  const found = await page.locator(`${scope} [data-cc-control]`).evaluateAll((elements) =>
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

const selector = ({ id, blocked }, scope) =>
  `${scope} [data-cc-control="${id}"]${blocked ? '[aria-disabled="true"]' : ':not([aria-disabled="true"])'}`;

/** Closes a dialog a press opened (Leave room, Resign), so the next press finds the page as it was. */
export async function putAway(page) {
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  }
}

/** A new pair of players brought into the state, and where both stand once it is reached. */
async function enter(players, build) {
  const state = await build(await openPair(players));
  const room = [state.clicker, ...(state.other ? [state.other] : [])];
  return { scope: "main", ...state, room, expected: await snapshot(room) };
}

/**
 * The control on the clicker's screen, or undefined when this state does not show it. Some controls come a moment
 * after the state itself, such as the save progress card once the win's XP has arrived, so it waits a little.
 */
async function find(state, entry) {
  const target = state.clicker.page.locator(selector(entry, state.scope)).first();
  return target.waitFor({ state: "visible", timeout: 3_000 }).then(
    () => target,
    () => undefined,
  );
}

/** Presses `target` and reads what the clicker's page showed in answer, and since when the other player watched. */
async function pressAndWatch(state, entry, target) {
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
  if (entry.blocked) {
    // A forced press skips the check that nothing covers the control, so the control is brought to the middle of
    // the screen first, clear of the request banner that stays at the top while the page scrolls (CC-160).
    await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  }
  await target.click({ force: entry.blocked });
  await page.waitForTimeout(ANSWER_MS + 50);
  const answer = await answerTo(page, armed);
  return { answer, otherArmed, answered: (await downloaded) || answer.ms <= ANSWER_MS };
}

/** Whether a control pressed while blocked is ready now, because what blocked it was only for a moment. */
const blockEnded = (state, entry) =>
  state.clicker.page
    .locator(selector({ ...entry, blocked: false }, state.scope))
    .first()
    .isVisible()
    .catch(() => false);

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
  const controls = await controlsOn(state.clicker.page, state.scope);
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
    let press = await pressAndWatch(state, entry, target);
    if (!press.answered && entry.blocked && (await blockEnded(state, entry))) {
      // A short wait, such as the pause before asking again (CC-159), ran out during the press, so the press met
      // a control that was no longer blocked. The state is built again and the blocked control pressed in time.
      state = await enter(players, build);
      target = await find(state, entry);
      if (target !== undefined) press = await pressAndWatch(state, entry, target);
    }
    const { page } = state.clicker;
    const { answer, otherArmed } = press;
    if (!press.answered) {
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
export const allStatesFor = (gameId) => ({ ...statesFor(gameId), ...computerStatesFor(gameId) });

/**
 * The press tests of one game, each state its own test. Each game calls this from its own spec file
 * (`match-shell-presses-<game>.spec.js`), so CI can give each game's presses its own machine (CC-236).
 *
 * @param {string} gameId
 */
export function pressEveryStateOf(gameId) {
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
