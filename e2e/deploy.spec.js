import { expect, joinAsGuest, test } from "./fixtures.js";

// A player whose tab was opened before a deploy (CC-181). Rooms outlive a deploy (CC-101), but the tab still asks
// for the board file of the version it started with, and the new version no longer has it. The tab reloads once
// into the new version and the player is back in the room, instead of an error page in place of the whole app.
//
// The deploy is simulated in this tab only. Until the page loads again, every request for the board file gets what
// the server answers for any file it no longer has. Vite asks for the file twice (once to preload it, once to run
// it), so both must fail, as they would after a real deploy. The reloaded page counts as the new version, where the
// file is there. Renaming the file in the shared build would break every other test running at the same time.

const BOARD_FILE = "**/assets/RpsBoard-*.js";
const choices = (player) => player.page.getByRole("group", { name: "Your choice" });

/**
 * From now on, until the page loads again, the board file is gone as it is after a deploy. Answers the page loads
 * since then.
 */
async function deployRemovesBoardFile(player) {
  const pageLoads = [];
  player.page.on("request", (request) => {
    if (request.isNavigationRequest()) pageLoads.push(new URL(request.url()));
  });
  await player.page.route(BOARD_FILE, async (route) => {
    const url = new URL(route.request().url());
    if (pageLoads.length > 0) {
      await route.continue();
      return;
    }
    player.expect(404, url.pathname);
    const response = await route.fetch({ url: `${url.origin}/assets/RpsBoard-from-the-previous-deploy.js` });
    await route.fulfill({ response });
  });
  return pageLoads;
}

test.describe("a tab from before a deploy", () => {
  test("reloads once into the room when the board's file is gone, never showing the error page", async ({
    players,
    browserName,
  }) => {
    // On WebKit, Playwright's stand-in answer for the file stays in the tab after the reload, so the reloaded page
    // never asks the server again and the test would fail for a reason players never meet. A plain server that
    // answers 404 and then the file, with no Playwright in between, showed WebKit asking again after the reload
    // and loading the file (CC-184, finding F-3).
    test.skip(browserName === "webkit", "Playwright's routing on WebKit keeps the deploy's missing file");
    const alice = await players.open("alice");
    await alice.page.goto("/games/rock-paper-scissors");
    await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await alice.page.getByRole("button", { name: "Create room" }).click();
    const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    const room = new URL(invite).pathname;
    const answers = [];
    alice.page.on("response", (response) => {
      if (/\/assets\/RpsBoard-[^/]*\.js$/.test(response.url())) answers.push(response);
    });
    const pageLoads = await deployRemovesBoardFile(alice);

    // Bob joins, the game starts, and Alice's tab needs the board it has not downloaded yet.
    const bob = await players.open("bob");
    await joinAsGuest(bob, invite);

    await expect(choices(alice)).toBeVisible();
    await expect(choices(bob)).toBeVisible();
    await expect(alice.page.getByRole("alert")).toHaveCount(0);
    await expect(alice.page.getByText("Something went wrong")).toHaveCount(0);
    expect(alice.url()).toBe(room);
    await expect(alice.page).toHaveTitle(`Rock Paper Scissors · Room ${room.split("/").pop()} · ClassiCade`);
    // The missing file got a script's 404, not the app's HTML. Then the page reloaded once and the file loaded.
    expect(pageLoads.map((url) => `${url.pathname}${url.search}`)).toEqual([`${room}?reloaded=1`]);
    const statuses = answers.map((response) => response.status());
    expect(statuses.at(-1)).toBe(200);
    expect(statuses.slice(0, -1)).toEqual(expect.arrayContaining([404]));
    expect(statuses.slice(0, -1).every((status) => status === 404)).toBe(true);
    for (const missing of answers.filter((response) => response.status() === 404)) {
      expect(missing.headers()["content-type"]).toMatch(/^text\/javascript/);
    }

    // The game goes on from the reloaded tab.
    await choices(alice).getByRole("button", { name: /Rock/ }).click();
    await choices(bob)
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expect(bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();

    // Back still leaves the room for the lobby Alice came from, as it would without the reload.
    await alice.page.goBack();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
  });
});

// Pointing at a link only hints the browser to fetch the page's files (CC-322). When they are gone, as in a tab from
// before a deploy, or the connection drops, that hint fails quietly: the page must not reload under a player who has
// only moved the mouse. Opening the page is what reloads a stale tab, as above.
const LOBBY_FILE = "**/assets/PlayPage-*.js";

test.describe("pointing at a link", () => {
  for (const failure of ["file gone after a deploy", "connection dropped"]) {
    test(`does nothing when the page's files fail to arrive (${failure})`, async ({ players }) => {
      const visitor = await players.open("visitor");
      await visitor.page.goto("/");
      const chess = visitor.page.getByRole("region", { name: "Games" }).getByRole("link", { name: "Chess" });
      await expect(chess).toBeVisible();
      const pageLoads = [];
      visitor.page.on("request", (request) => {
        if (request.isNavigationRequest()) pageLoads.push(request.url());
      });
      const asked = [];
      await visitor.page.route(LOBBY_FILE, async (route) => {
        const url = new URL(route.request().url());
        asked.push(url.pathname);
        if (failure === "connection dropped") {
          // Aborted, which the check for failed requests every test makes leaves out, as a dropped connection.
          await route.abort("aborted");
          return;
        }
        visitor.expect(404, url.pathname);
        const response = await route.fetch({
          url: `${url.origin}/assets/PlayPage-from-the-previous-deploy.js`,
        });
        await route.fulfill({ response });
      });

      await chess.hover();
      await expect.poll(() => asked.length).toBeGreaterThan(0);
      // Long enough for a reload to have started, had the failure reached the stale tab's recovery.
      await visitor.page.waitForTimeout(1_000);

      expect(pageLoads).toEqual([]);
      expect(visitor.url()).toBe("/");
      await expect(visitor.page.getByText("Something went wrong")).toHaveCount(0);
      await expect(visitor.page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});
