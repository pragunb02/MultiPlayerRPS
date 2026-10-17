import AxeBuilder from "@axe-core/playwright";
import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";
import { openPair, phaseIs, statesFor } from "./matchStates.js";
import { newAccount } from "./personas.js";

// Every screen the browser tests reach is scanned with axe in light and dark (CC-183). A serious or critical
// violation fails the test. Nothing is allowed through: a rule that has to be skipped one day is skipped here, in
// the open, with its reason. The rules are the 2026-10-17 audit's: WCAG 2.0, 2.1 and 2.2 at levels A and AA, and
// axe's best practices.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const FAILING = new Set(["serious", "critical"]);

/** One line per broken rule: what it is and where, so a failure reads without opening the report. */
const describe = (violation) =>
  `${violation.id} (${violation.impact}): ${violation.help}. On ${violation.nodes
    .slice(0, 5)
    .map((node) => node.target.join(" "))
    .join(", ")}${violation.nodes.length > 5 ? ` and ${violation.nodes.length - 5} more` : ""}`;

/**
 * Scans what `player` sees now, once in each colour scheme. Motion is reduced for the scan, so a toast or a piece
 * caught half way through fading in is never judged on its half-faded colours.
 */
async function scan(player, screen) {
  for (const colorScheme of ["light", "dark"]) {
    await player.page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const { violations } = await new AxeBuilder({ page: player.page }).withTags(TAGS).analyze();
    expect(
      violations.filter((violation) => FAILING.has(violation.impact)).map(describe),
      `${player.name} on ${screen}, ${colorScheme}`,
    ).toEqual([]);
  }
  await player.page.emulateMedia({ colorScheme: null, reducedMotion: null });
}

const control = (page, id) => page.locator(`main [data-cc-control="${id}"]`);

test.describe("pages", () => {
  test("pages a visitor can open", async ({ players }) => {
    test.setTimeout(120_000);
    const visitor = await players.open("visitor");
    visitor.expect(404, "/no-such-page");
    const pages = [
      "/",
      "/games/rock-paper-scissors",
      "/games/tic-tac-toe",
      "/games/chess",
      "/login",
      "/signup",
      "/leaderboards/overall",
      "/leaderboards/chess",
      "/privacy",
      "/terms",
      "/no-such-page",
    ];
    for (const path of pages) {
      await visitor.page.goto(path);
      await expect(visitor.page.getByRole("heading", { level: 1 })).toBeVisible();
      await scan(visitor, path);
    }
  });

  test("a wrong password and a form sent with mistakes", async ({ players }) => {
    const visitor = await players.open("visitor", { secrets: ["not my password"] });
    visitor.expect(401, "/api/auth/login");
    await visitor.page.goto("/login");
    await visitor.page.getByLabel("Email").fill("nobody.here@example.com");
    await visitor.page.getByLabel("Password").fill("not my password");
    await visitor.page.getByRole("button", { name: "Log in" }).click();
    await expect(visitor.page.getByRole("alert")).toHaveText("Invalid email or password");
    await scan(visitor, "login with a wrong password");

    await visitor.page.goto("/signup");
    await visitor.page.getByLabel("Username").fill("x");
    await visitor.page.getByLabel("Email").fill("not an email");
    await visitor.page.getByLabel("Password").fill("short");
    await visitor.page.getByRole("button", { name: "Create account" }).click();
    await expect(visitor.page).toHaveURL("/signup");
    await scan(visitor, "signup with mistakes");
  });

  test("a guest's home and profile, and an account's profile", async ({ players }) => {
    const guest = await players.open("guest");
    await guest.page.goto("/");
    await guest.page.getByRole("button", { name: "Play as a guest" }).click();
    await expect(guest.page.getByText(/You're playing as Guest-/)).toBeVisible();
    await scan(guest, "home as a guest");
    await guest.page.goto("/profile");
    await expect(guest.page.getByRole("heading", { level: 1 })).toBeVisible();
    await scan(guest, "profile as a guest");

    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    await riya.page.goto("/signup");
    await riya.page.getByLabel("Username").fill(account.username);
    await riya.page.getByLabel("Email").fill(account.email);
    await riya.page.getByLabel("Password").fill(account.password);
    await riya.page.getByRole("button", { name: "Create account" }).click();
    await expect(riya.page).toHaveURL("/");
    await riya.page.goto("/profile");
    await expect(riya.page.getByRole("heading", { level: 1, name: account.username })).toBeVisible();
    await scan(riya, "profile as an account");
  });
});

test.describe("joining a room", () => {
  test("the invite chooser, a room that does not exist and a full room", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    await scan(host, "a room waiting for an opponent");

    const friend = await players.open("friend");
    await friend.page.goto(room.path);
    await expect(friend.page.getByRole("heading", { name: /You're invited/ })).toBeVisible();
    await scan(friend, "the invite chooser");
    await friend.page.getByRole("button", { name: "Play as guest" }).click();
    await expect(host.page.locator("[data-cc-phase]")).toHaveAttribute("data-cc-phase", /my-turn|their-turn/);

    const late = await players.open("late");
    await joinAsGuest(late, room.path);
    await expect(late.page.getByRole("heading", { level: 1 })).toBeVisible();
    await scan(late, "a full room, watched as a spectator");

    await late.page.goto("/games/chess/rooms/ZZZZZZ");
    await expect(late.page.getByRole("heading", { name: "Room not found" })).toBeVisible();
    await scan(late, "a room that does not exist");
  });
});

/**
 * The match states of a game that show something new, each built from the start. Both players are scanned, so one
 * state covers both sides: my turn and their turn, a win and a loss, a request asked and asked of me.
 */
const MATCH_STATES = Object.freeze({
  rps: ["waiting", "their-turn", "loss", "rematch-asked", "rematch-declined"],
  tictactoe: ["their-turn", "loss", "draw", "rematch-asked", "rematch-declined"],
  chess: ["their-turn", "loss", "draw", "request-asked", "rematch-asked", "rematch-declined"],
});

for (const [gameId, names] of Object.entries(MATCH_STATES)) {
  test.describe(`${gameId} match`, () => {
    for (const name of names) {
      test(name, async ({ players }) => {
        test.setTimeout(90_000);
        const pair = await openPair(players);
        const { clicker, other } = await statesFor(gameId)[name](pair);
        await scan(clicker, `${gameId} ${name}`);
        if (other !== undefined) {
          await scan(other, `${gameId} ${name}, the other player`);
        }
      });
    }
  });
}

test.describe("dialogs and the chess board in use", () => {
  test("a picked up piece, the resign dialog and the leave dialog", async ({ players }) => {
    test.setTimeout(90_000);
    const pair = await openPair(players);
    const { clicker } = await statesFor("chess")["my-turn"](pair);
    const page = clicker.page;

    await page.getByRole("gridcell", { name: /^e2,/ }).click();
    await expect(page.getByRole("gridcell", { name: /^e2,/ })).toHaveAttribute("aria-selected", "true");
    await scan(clicker, "chess with a piece picked up");

    await control(page, "chess.resign").click();
    await expect(page.getByRole("dialog", { name: "Resign this game?" })).toBeVisible();
    await scan(clicker, "the resign dialog");
    await control(page, "chess.resign.keep").click();

    await control(page, "room.leave").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(clicker, "the leave room dialog");
  });
});

test.describe("page changes", () => {
  const announcer = (page) => page.locator("[aria-live='polite'][aria-atomic='true']").last();

  test("focus moves to the new page's heading and its title is read out, but not on the first page", async ({
    players,
  }) => {
    const visitor = await players.open("visitor");
    await visitor.page.goto("/");
    await expect(visitor.page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await visitor.page.evaluate(() => document.activeElement.tagName)).toBe("BODY");

    await visitor.page.getByRole("link", { name: "Chess", exact: true }).click();

    await expect(visitor.page).toHaveURL("/games/chess");
    await expect(visitor.page.getByRole("heading", { level: 1, name: "Chess" })).toBeFocused();
    await expect(announcer(visitor.page)).toHaveText("Chess · ClassiCade");
    await scan(visitor, "the chess lobby with its heading focused");

    await visitor.page.goBack();
    await expect(visitor.page).toHaveURL("/");
    await expect(visitor.page.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("a move by the opponent never takes the focus off the board", async ({ players }) => {
    test.setTimeout(90_000);
    const pair = await openPair(players);
    const { clicker: white, other: black } = await statesFor("chess")["my-turn"](pair);
    const square = (player, name) => player.page.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) });
    await square(black, "e7").focus();

    await square(white, "e2").click();
    await square(white, "e4").click();

    await phaseIs(black, "my-turn");
    await expect(square(black, "e4")).toHaveAccessibleName("e4, white pawn");
    await expect(square(black, "e7")).toBeFocused();
  });
});
