import { expect, joinAsGuest, test } from "./fixtures.js";

// Requests and presence across the whole site (CC-207, CC-158), from the owner's report: two players finish a
// game, Alice goes to the home page without pressing Leave, Bob asks for a rematch, and Alice never heard of it
// while Bob waited for ever. Now Bob sees at once that Alice left the game screen, the question reaches Alice on
// whatever page she is, and an Accept there brings both into the next game.

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
const seats = (player) => player.page.getByRole("list", { name: "Players" });
const nameOf = async (player) =>
  player.page
    .getByRole("banner")
    .getByText(/^Guest-/)
    .textContent();
/** The question from another room, on any page but that room's (CC-207). */
const sitePopup = (player) => player.page.getByRole("region", { name: "Rematch?" });

/** Alice hosts best-of-1 Rock Paper Scissors, Bob joins by the link, and Alice wins the only round. */
async function finishedRps(players) {
  const alice = await players.open("alice");
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const roomPath = new URL(invite).pathname;
  const bob = await players.open("bob");
  await joinAsGuest(bob, roomPath);
  await choices(alice).getByRole("button", { name: /Rock/ }).click();
  await choices(bob)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  await expect(bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();
  return { alice, bob, roomPath, aliceName: await nameOf(alice), bobName: await nameOf(bob) };
}

/** Pretends the player switched to another tab (or back). Headless browsers always report a visible page. */
async function setTabHidden(player, hidden) {
  await player.page.evaluate((value) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (value ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

/** The ways a player leaves the room's page without pressing Leave. */
const WAYS_OUT = Object.freeze({
  "the logo": (player) => player.page.getByRole("link", { name: "ClassiCade home" }).click(),
  "Games in the menu": (player) =>
    player.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Games" }).click(),
  "the Back button": (player) => player.page.goBack(),
});

test.describe("the owner's report: a rematch asked of a player who went to another page", () => {
  for (const [way, leave] of Object.entries(WAYS_OUT)) {
    test(`Alice leaves by ${way}, Bob asks, Alice gets the question there, accepts, and both play again`, async ({
      players,
    }) => {
      const { alice, bob, roomPath, aliceName, bobName } = await finishedRps(players);

      await leave(alice);
      await expect(alice.page).not.toHaveURL(roomPath);
      // Bob sees at once that Alice left the game screen, not just "connected".
      await expect(seats(bob).getByRole("listitem").filter({ hasText: aliceName })).toContainText(
        "away from the game screen",
      );
      await bob.page.getByRole("button", { name: "Rematch", exact: true }).click();
      await expect(bob.page.getByText("is on another page. They have been told.")).toBeVisible();

      await setTabHidden(alice, true);
      await expect(sitePopup(alice)).toBeVisible();
      await expect(sitePopup(alice)).toHaveAccessibleDescription(
        `${bobName} wants a rematch at Rock Paper Scissors`,
      );
      await expect(alice.page).toHaveTitle("Rematch? · ClassiCade");
      await setTabHidden(alice, false);
      await sitePopup(alice).getByRole("button", { name: "Accept and go" }).click();

      await expect(alice.page).toHaveURL(roomPath);
      for (const player of [alice, bob]) {
        await expect(choices(player)).toBeVisible();
        await expect(player.page.getByRole("heading", { name: /You (won|lost)/ })).toHaveCount(0);
      }
      await expect(seats(bob)).not.toContainText("away from the game screen");
      await expect(sitePopup(alice)).toHaveCount(0);
    });
  }

  test("a Decline on another page is shown to Bob at once", async ({ players }) => {
    const { alice, bob, aliceName } = await finishedRps(players);
    await alice.page.getByRole("link", { name: "ClassiCade home" }).click();
    await bob.page.getByRole("button", { name: "Rematch", exact: true }).click();

    await sitePopup(alice).getByRole("button", { name: "Decline" }).click();

    await expect(sitePopup(alice)).toHaveCount(0);
    await expect(bob.page.getByText(`${aliceName} declined the rematch`, { exact: true })).toBeVisible();
    expect(alice.url()).toBe("/");
  });

  test("Bob going elsewhere hears how his request ended, with the way back to the game", async ({
    players,
  }) => {
    const { alice, bob, roomPath, aliceName } = await finishedRps(players);
    await bob.page.getByRole("button", { name: "Rematch", exact: true }).click();
    await bob.page.getByRole("link", { name: "ClassiCade home" }).click();

    await alice.page
      .getByRole("region", { name: "Rematch?" })
      .getByRole("button", { name: "Accept" })
      .click();

    await expect(bob.page.getByText(`${aliceName} accepted. Starting the next game`)).toBeVisible();
    await bob.page.getByRole("link", { name: "Go to the game" }).click();
    await expect(bob.page).toHaveURL(roomPath);
    await expect(choices(bob)).toBeVisible();
  });
});

test.describe("a rematch asked of a player who is offline", () => {
  test("Bob is told at once, and can send the link, find a new opponent, or play the computer", async ({
    players,
  }) => {
    const { alice, bob, aliceName } = await finishedRps(players);

    await alice.leave();
    await expect(seats(bob).getByRole("listitem").filter({ hasText: aliceName })).toContainText("offline");
    await bob.page.getByRole("button", { name: "Rematch", exact: true }).click();

    await expect(bob.page.getByText("is offline right now, so they cannot answer yet.")).toBeVisible();
    await expect(bob.page.getByRole("button", { name: "Copy invite link" })).toBeVisible();
    await expect(bob.page.getByRole("button", { name: "New opponent" }).first()).toBeVisible();
    await bob.page.getByRole("link", { name: "Play vs computer" }).click();
    await expect(bob.page).toHaveURL("/games/rock-paper-scissors");
  });
});
