import { answerTo, arm, installProbe } from "./controlProbe.js";
import { expect, joinAsGuest, test } from "./fixtures.js";
import { restartServer } from "./serverControl.js";

// Requests and presence when time passes or the server goes away (CC-207, CC-158, CC-036): the server restarts
// while a question waits on another page, a request nobody answers, a finished room a player stays away from, the
// player's own lost connection, and an opponent who never comes back. These restart the real server, or run it
// with short room times for a while, so they run after all the other tests and one at a time
// (playwright.config.js).

test.describe.configure({ timeout: 120_000 });

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
const seats = (player) => player.page.getByRole("list", { name: "Players" });
const sitePopup = (player) => player.page.getByRole("region", { name: "Rematch?" });
const connection = (player) =>
  player.page.getByRole("alert").filter({ hasText: /Reconnecting|Server restarting/ });
const nameOf = async (player) =>
  player.page
    .getByRole("banner")
    .getByText(/^Guest-/)
    .textContent();

/** Alice hosts Rock Paper Scissors over `bestOf` rounds and Bob joins by the link. */
async function startRps(players, bestOf) {
  const alice = await players.open("alice");
  const bob = await players.open("bob");
  for (const player of [alice, bob]) await installProbe(player);
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption(String(bestOf));
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const roomPath = new URL(invite).pathname;
  await joinAsGuest(bob, roomPath);
  await expect(choices(alice)).toBeVisible();
  await expect(choices(bob)).toBeVisible();
  return { alice, bob, roomPath, aliceName: await nameOf(alice), bobName: await nameOf(bob) };
}

/** A best-of-1 game that Alice won. */
async function finishedRps(players) {
  const game = await startRps(players, 1);
  await choices(game.alice).getByRole("button", { name: /Rock/ }).click();
  await choices(game.bob)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(game.alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  await expect(game.bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();
  return game;
}

/** Presses a control and fails unless something on the page answered within 100 ms (CC-170). */
async function pressAnswers(player, locator) {
  // Named before the press, because a press may take the control away.
  const label = await locator.textContent();
  const armed = await arm(player.page);
  await locator.click({ force: true });
  await player.page.waitForTimeout(150);
  const answer = await answerTo(player.page, armed);
  expect(answer.ms, `${label} answered by ${answer.kind}`).toBeLessThanOrEqual(100);
}

test.describe("the server restarts", () => {
  test("while a question waits on another page: both are told the game is safe, and the question survives", async ({
    players,
  }) => {
    const { alice, bob, roomPath, bobName } = await finishedRps(players);
    await alice.page.getByRole("link", { name: "ClassiCade home" }).click();
    await bob.page.getByRole("button", { name: "Rematch", exact: true }).click();
    await expect(sitePopup(alice)).toBeVisible();

    alice.expectRestart();
    bob.expectRestart();
    const restarting = restartServer();
    for (const player of [alice, bob]) {
      await expect(connection(player)).toHaveText("Server restarting, your game is safe");
    }
    await restarting;
    for (const player of [alice, bob]) {
      await expect(connection(player)).toHaveCount(0, { timeout: 20_000 });
    }

    // A reload asks the new server process, so what Alice sees now is what it kept and pushed on connecting.
    await alice.page.reload();
    await expect(sitePopup(alice)).toHaveAccessibleDescription(
      `${bobName} wants a rematch at Rock Paper Scissors`,
    );
    await sitePopup(alice).getByRole("button", { name: "Accept and go" }).click();
    await expect(alice.page).toHaveURL(roomPath);
    for (const player of [alice, bob]) await expect(choices(player)).toBeVisible();
  });

  test("when it crashes: the player sees Reconnecting after a second, and the controls say so until it is back", async ({
    players,
  }) => {
    const { alice, bob } = await startRps(players, 3);
    alice.expectRestart();
    bob.expectRestart();

    const restarting = restartServer({ crash: true });
    await expect(connection(alice)).toHaveText("Reconnecting…");
    const rock = choices(alice).getByRole("button", { name: /Rock/ });
    await expect(rock).toHaveAttribute("aria-disabled", "true");
    await pressAnswers(alice, rock);
    await expect(alice.page.getByText("Reconnecting", { exact: true }).first()).toBeVisible();
    await restarting;

    await expect(connection(alice)).toHaveCount(0, { timeout: 20_000 });
    await expect(rock).not.toHaveAttribute("aria-disabled", "true");
    await rock.click();
    await choices(bob).getByRole("button", { name: /Paper/ }).click();
    await expect(alice.page.getByRole("list", { name: "Rounds" }).getByRole("listitem")).toHaveCount(1);
  });
});

test.describe("time passing in a room, with short room times for this server process", () => {
  // Production always runs with the standard times: a minute for a rematch request, two minutes away from a
  // finished room before the seat goes, and a minute to come back to a game.
  test.beforeAll(async () => {
    await restartServer({
      rooms: { lifetimes: { rematchRequestMs: 3_000, awayReleaseMs: 8_000, reconnectGraceMs: 3_000 } },
    });
  });
  test.afterAll(async () => {
    await restartServer();
  });

  test("a rematch nobody answers: Bob hears No answer with ways to play on, and Alice's question goes", async ({
    players,
  }) => {
    const { alice, bob, aliceName } = await finishedRps(players);
    await alice.page.getByRole("link", { name: "ClassiCade home" }).click();
    await bob.page.getByRole("button", { name: "Rematch", exact: true }).click();
    await expect(sitePopup(alice)).toBeVisible();

    const card = bob.page.getByRole("region", { name: "Answer" });
    await expect(card).toContainText(`No answer from ${aliceName}`);
    await expect(sitePopup(alice)).toHaveCount(0);
    await expect(bob.page.getByText(`No answer from ${aliceName}.`)).toBeVisible();
    // Every control of the card answers a press (CC-170).
    await pressAnswers(bob, card.getByRole("button", { name: "Copy invite link" }));
    await expect(card.getByRole("link", { name: "Play vs computer" })).toHaveAttribute(
      "href",
      "/games/rock-paper-scissors",
    );
    await pressAnswers(bob, card.getByRole("button", { name: "Close" }));
    await expect(card).toHaveCount(0);
  });

  test("a finished room Alice stays away from lets her seat go, and Bob is told there is no rematch", async ({
    players,
  }) => {
    const { alice, bob, aliceName } = await finishedRps(players);

    await alice.page.getByRole("link", { name: "ClassiCade home" }).click();
    await expect(seats(bob)).toContainText("away from the game screen");

    await expect(bob.page.getByText(`${aliceName} left, so there is no rematch this time.`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      bob.page.getByRole("status").filter({ hasText: `${aliceName} left the room` }),
    ).toBeVisible();
    await expect(bob.page.getByRole("button", { name: "Rematch", exact: true })).toHaveCount(0);
  });

  test("an opponent who loses the connection mid-game and stays away: the win can be claimed", async ({
    players,
  }) => {
    const { alice, bob, bobName } = await startRps(players, 3);

    await bob.leave();
    const bobSeat = seats(alice).getByRole("listitem").filter({ hasText: bobName });
    await expect(bobSeat).toContainText(/reconnecting \d:\d\d/);
    const claim = alice.page.getByRole("button", { name: "Claim the win" });
    await expect(claim).toBeVisible({ timeout: 10_000 });
    await expect(bobSeat).toContainText("offline");
    await pressAnswers(alice, claim);

    await expect(alice.page.getByRole("heading", { name: "You won by forfeit" })).toBeVisible();
  });
});
