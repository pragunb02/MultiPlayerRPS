import { expect, header, test } from "./fixtures.js";

// Two guests who just finished a game and want another one (CC-037): the rematch starts in the same room, with
// the same URL, and history keeps working around it.

/** A guest from the home page's button — the way in that needs no invite link. */
async function asGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  const name = (await header(player.page)).getByText(/^Guest-/);
  await expect(name).toBeVisible();
  return name.textContent();
}

/** Alice hosts best-of-1 Rock Paper Scissors from the lobby, Bob joins by the invite link. */
async function startRps(players) {
  const alice = await players.open("alice");
  const aliceName = await asGuest(alice);
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const bob = await players.open("bob");
  const bobName = await asGuest(bob);
  await bob.page.goto(invite);
  return { alice, bob, aliceName, bobName, roomPath: new URL(invite).pathname };
}

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });

async function playRound(winner, loser) {
  await choices(winner).getByRole("button", { name: /Rock/ }).click();
  await choices(loser)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(winner.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  await expect(loser.page.getByRole("heading", { name: "You lost" })).toBeVisible();
}

test.describe("rematch", () => {
  test("both ask: a new game starts in the same room, and history stays clean", async ({ players }) => {
    const { alice, bob, aliceName, bobName, roomPath } = await startRps(players);
    await playRound(alice, bob);

    await alice.page.getByRole("button", { name: "Rematch" }).click();
    await expect(alice.page.getByText(`Waiting for ${bobName}…`)).toBeVisible();
    await expect(bob.page.getByText(`${aliceName} wants a rematch!`)).toBeVisible();

    // A reload in the middle of it shows the same offer: the server keeps it, not the page.
    await bob.page.reload();
    await expect(bob.page.getByText(`${aliceName} wants a rematch!`)).toBeVisible();
    await bob.page.getByRole("button", { name: "Accept rematch" }).click();

    for (const player of [alice, bob]) {
      await expect(choices(player)).toBeVisible();
      await expect(player.page.getByRole("heading", { name: /You (won|lost)/ })).toHaveCount(0);
      expect(player.url()).toBe(roomPath);
    }

    // The rematch added no history entry: Back leaves the room for the lobby, Forward returns to the game.
    await alice.page.goBack();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
    await alice.page.goForward();
    await expect(alice.page).toHaveURL(roomPath);
    await expect(choices(alice)).toBeVisible();

    await playRound(bob, alice);
    // Seats were swapped for the rematch, so Bob is listed first now.
    await expect(alice.page.getByText(/^Series after 2 games:/)).toHaveText(
      `Series after 2 games: ${bobName} 1 – You 1`,
    );
    await expect(bob.page.getByText(/^Series after 2 games:/)).toHaveText(
      `Series after 2 games: You 1 – ${aliceName} 1`,
    );

    // Both games are on record.
    await alice.page.goto("/profile");
    await expect(alice.page.getByRole("list", { name: "Match history" }).getByRole("listitem")).toHaveCount(
      2,
    );
  });

  test("the opponent leaves: no rematch, but a way to a new game", async ({ players }) => {
    const { alice, bob, bobName } = await startRps(players);
    await playRound(alice, bob);
    await alice.page.getByRole("button", { name: "Rematch" }).click();
    await expect(alice.page.getByText(`Waiting for ${bobName}…`)).toBeVisible();

    await bob.page.getByRole("button", { name: "Leave room" }).click();
    await expect(bob.page).toHaveURL("/games/rock-paper-scissors");

    await expect(alice.page.getByText(`${bobName} left, so there is no rematch this time.`)).toBeVisible();
    await expect(alice.page.getByRole("button", { name: /rematch/i })).toHaveCount(0);
    await alice.page.getByRole("button", { name: "New opponent" }).click();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
  });

  test("New opponent after asking for a rematch: the asker leaves, and the other player is told at once (CC-162)", async ({
    players,
  }) => {
    const { alice, bob, aliceName, roomPath } = await startRps(players);
    await playRound(alice, bob);
    await alice.page.getByRole("button", { name: "Rematch" }).click();
    await expect(bob.page.getByText(`${aliceName} wants a rematch!`)).toBeVisible();

    await alice.page.getByRole("button", { name: "New opponent" }).click();

    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
    await expect(bob.page.getByText(`${aliceName} left, so there is no rematch this time.`)).toBeVisible();
    await expect(
      bob.page.getByRole("status").filter({ hasText: `${aliceName} left the room` }),
    ).toBeVisible();
    await expect(bob.page.getByRole("button", { name: "Accept rematch" })).toHaveCount(0);
    // The seat is given up: Back does not lead into the room again.
    await alice.page.goBack();
    await expect(alice.page).not.toHaveURL(roomPath);
  });

  test("a request can be withdrawn before the opponent answers", async ({ players }) => {
    const { alice, bob, aliceName } = await startRps(players);
    await playRound(alice, bob);

    await alice.page.getByRole("button", { name: "Rematch" }).click();
    await expect(bob.page.getByText(`${aliceName} wants a rematch!`)).toBeVisible();
    await alice.page.getByRole("button", { name: "Cancel rematch" }).click();

    await expect(bob.page.getByRole("button", { name: "Rematch", exact: true })).toBeVisible();
    await expect(bob.page.getByText(`${aliceName} wants a rematch!`)).toHaveCount(0);
  });
});
