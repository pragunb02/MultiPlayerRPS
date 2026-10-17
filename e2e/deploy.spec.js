import { expect, joinAsGuest, test } from "./fixtures.js";

// A player whose tab was opened before a deploy (CC-181). Rooms outlive a deploy (CC-101), but the tab still asks
// for the board file of the version it started with, and the new version no longer has it. The tab reloads once
// into the new version and the player is back in the room, instead of an error page in place of the whole app.
//
// The deploy is simulated in this tab only, by answering its first request for the board file the way the server
// answers any file it no longer has. Renaming the file in the shared build would break every other test running
// at the same time.

const BOARD_FILE = "**/assets/RpsBoard-*.js";
const choices = (player) => player.page.getByRole("group", { name: "Your choice" });

/** From now on the first request for the board file fails as it does after a deploy. Answers what was asked. */
async function deployRemovesBoardFile(player) {
  const removed = [];
  await player.page.route(BOARD_FILE, async (route) => {
    const url = new URL(route.request().url());
    if (removed.length > 0) {
      await route.continue();
      return;
    }
    removed.push(url.pathname);
    player.expect(404, url.pathname);
    const response = await route.fetch({ url: `${url.origin}/assets/RpsBoard-from-the-previous-deploy.js` });
    await route.fulfill({ response });
  });
  return removed;
}

test.describe("a tab from before a deploy", () => {
  test("reloads once into the room when the board's file is gone, never showing the error page", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    await alice.page.goto("/games/rock-paper-scissors");
    await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await alice.page.getByRole("button", { name: "Create room" }).click();
    const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    const room = new URL(invite).pathname;
    const answers = [];
    const pageLoads = [];
    alice.page.on("response", (response) => {
      if (/\/assets\/RpsBoard-[^/]*\.js$/.test(response.url())) answers.push(response);
    });
    alice.page.on("request", (request) => {
      if (request.isNavigationRequest()) pageLoads.push(new URL(request.url()));
    });
    const removed = await deployRemovesBoardFile(alice);

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
    expect(removed).toHaveLength(1);
    expect(answers.map((response) => response.status())).toEqual([404, 200]);
    expect(answers[0].headers()["content-type"]).toMatch(/^text\/javascript/);
    expect(pageLoads.map((url) => `${url.pathname}${url.search}`)).toEqual([`${room}?reloaded=1`]);

    // The game goes on from the reloaded tab.
    await choices(alice).getByRole("button", { name: /Rock/ }).click();
    await choices(bob)
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(alice.page.getByRole("heading", { name: "You won!" })).toBeVisible();
    await expect(bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();

    // Back still leaves the room for the lobby Alice came from, as it would without the reload.
    await alice.page.goBack();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
  });
});
