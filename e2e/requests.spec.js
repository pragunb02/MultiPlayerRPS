import fs from "node:fs";
import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";

// Two people in a room asking each other things (CC-104): a draw offer in chess and a rematch in any game. The one
// asked gets a popup with Accept and Decline, the asker waits with Cancel, and every answer is shown to the other
// side. Also the background tab that calls a player back on their move, and the sound switch (CC-103).

const SHOTS = "/tmp/cc104-shots";

async function screenshot(player, name, testInfo) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await player.page.screenshot({
    path: `${SHOTS}/${testInfo.project.name}-${name}.png`,
    animations: "disabled",
  });
}

const nameOf = async (player) =>
  player.page
    .getByRole("banner")
    .getByText(/^Guest-/)
    .textContent();
const popup = (player) => player.page.getByRole("alertdialog");

/**
 * Alice hosts a chess game and Bob joins by the link. Colours are drawn at random, so this finds out who plays
 * White (whose pieces can be moved first) and hands the players back by colour.
 */
async function startChess(players) {
  const alice = await players.open("alice");
  const room = await createRoom(alice, "chess");
  const bob = await players.open("bob");
  await joinAsGuest(bob, room.path);
  for (const player of [alice, bob]) {
    await expect(player.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
  }
  await expect(alice.page.getByText(/^(Your turn|Waiting for)/).first()).toBeVisible();
  const aliceIsWhite = await alice.page.getByRole("gridcell", { name: "e2, white pawn" }).isEnabled();
  const [white, black] = aliceIsWhite ? [alice, bob] : [bob, alice];
  return { white, black, whiteName: await nameOf(white), blackName: await nameOf(black) };
}

async function play(player, from, to) {
  await player.page.getByRole("gridcell", { name: new RegExp(`^${from}, `) }).click();
  await player.page.getByRole("gridcell", { name: `${to}, legal move` }).click();
}

/** Alice hosts best-of-1 Rock Paper Scissors, Bob joins, and Alice wins the only round. */
async function finishedRps(players) {
  const alice = await players.open("alice");
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const bob = await players.open("bob");
  await joinAsGuest(bob, new URL(invite).pathname);
  const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
  await choices(alice).getByRole("button", { name: /Rock/ }).click();
  await choices(bob)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(alice.page.getByRole("heading", { name: "You won!" })).toBeVisible();
  await expect(bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();
  return { alice, bob, aliceName: await nameOf(alice), bobName: await nameOf(bob) };
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

test.describe("draw offers", () => {
  test("declined: the offerer is told, the game goes on", async ({ players }, testInfo) => {
    const { white: alice, black: bob, whiteName: aliceName, blackName: bobName } = await startChess(players);

    await bob.page.getByRole("button", { name: "Offer draw" }).click();
    const waiting = bob.page.getByRole("region", { name: "Draw offered" });
    await expect(waiting).toContainText(`Waiting for ${aliceName}…`);
    await expect(popup(alice)).toBeVisible();
    await expect(popup(alice)).toHaveAccessibleName("Draw offer");
    await expect(popup(alice)).toHaveAccessibleDescription(`${bobName} offers a draw.`);
    await screenshot(alice, "draw-offer-popup", testInfo);
    await screenshot(bob, "draw-offer-waiting", testInfo);

    await popup(alice).getByRole("button", { name: "Decline" }).click();

    await expect(popup(alice)).toHaveCount(0);
    await expect(waiting).toHaveCount(0);
    await expect(bob.page.getByText(`${aliceName} declined your draw offer`)).toBeVisible();
    // The board was never blocked: Alice plays on.
    await play(alice, "e2", "e4");
    await expect(bob.page.getByRole("gridcell", { name: "e4, white pawn" })).toBeVisible();
  });

  test("accepted: the game ends in a draw for both", async ({ players }) => {
    const { white: alice, black: bob } = await startChess(players);

    await bob.page.getByRole("button", { name: "Offer draw" }).click();
    await popup(alice).getByRole("button", { name: "Accept" }).click();

    for (const player of [alice, bob]) {
      await expect(player.page.getByRole("heading", { name: "It's a draw" })).toBeVisible();
      await expect(popup(player)).toHaveCount(0);
    }
  });

  test("withdrawn: the popup closes and the opponent is told", async ({ players }) => {
    const { white: alice, black: bob, blackName: bobName } = await startChess(players);
    await bob.page.getByRole("button", { name: "Offer draw" }).click();
    await expect(popup(alice)).toBeVisible();

    await bob.page
      .getByRole("region", { name: "Draw offered" })
      .getByRole("button", { name: "Cancel" })
      .click();

    await expect(popup(alice)).toHaveCount(0);
    await expect(alice.page.getByText(`${bobName} withdrew the draw offer`)).toBeVisible();
  });

  test("a reload keeps the question, and Hide puts it away without answering", async ({ players }) => {
    const { white: alice, black: bob } = await startChess(players);
    await bob.page.getByRole("button", { name: "Offer draw" }).click();
    await expect(popup(alice)).toBeVisible();

    await alice.page.reload();
    await expect(popup(alice)).toBeVisible();
    await popup(alice).getByRole("button", { name: "Hide" }).click();

    await expect(popup(alice)).toHaveCount(0);
    await expect(bob.page.getByRole("region", { name: "Draw offered" })).toBeVisible();
  });
});

test.describe("rematch requests", () => {
  test("declined, asked again and withdrawn, asked again and accepted", async ({ players }, testInfo) => {
    const { alice, bob, aliceName, bobName } = await finishedRps(players);

    await alice.page.getByRole("button", { name: "Rematch", exact: true }).click();
    await expect(alice.page.getByText(`Waiting for ${bobName}…`)).toBeVisible();
    await expect(popup(bob)).toHaveAccessibleDescription(`${aliceName} wants a rematch.`);
    await screenshot(bob, "rematch-popup", testInfo);
    await popup(bob).getByRole("button", { name: "Decline" }).click();

    await expect(popup(bob)).toHaveCount(0);
    await expect(alice.page.getByText(`${bobName} declined the rematch`, { exact: true })).toBeVisible();
    await expect(alice.page.getByText(`${bobName} declined the rematch.`)).toBeVisible();
    await screenshot(alice, "rematch-declined", testInfo);

    await alice.page.getByRole("button", { name: "Rematch", exact: true }).click();
    await expect(popup(bob)).toBeVisible();
    await alice.page.getByRole("button", { name: "Cancel rematch" }).click();
    await expect(popup(bob)).toHaveCount(0);
    await expect(bob.page.getByText(`${aliceName} took back the rematch request`)).toBeVisible();

    await alice.page.getByRole("button", { name: "Rematch", exact: true }).click();
    await popup(bob).getByRole("button", { name: "Accept" }).click();
    for (const player of [alice, bob]) {
      await expect(player.page.getByRole("group", { name: "Your choice" })).toBeVisible();
      await expect(popup(player)).toHaveCount(0);
    }
  });
});

test.describe("background tab", () => {
  test("the title calls you back on your move, and goes back when you look", async ({ players }) => {
    const { white: alice, black: bob } = await startChess(players);
    await play(alice, "e2", "e4");
    await expect(bob.page.getByRole("gridcell", { name: "e4, white pawn" })).toBeVisible();
    const roomTitle = await alice.page.title();

    await setTabHidden(alice, true);
    await play(bob, "e7", "e5");

    await expect(alice.page).toHaveTitle("Your turn! · ClassiCade");
    await expect(alice.page).toHaveTitle(roomTitle);
    await expect(alice.page).toHaveTitle("Your turn! · ClassiCade");
    await expect(alice.page.locator("link[rel='icon']")).toHaveAttribute("href", "/favicon-turn.svg");
    await setTabHidden(alice, false);
    await expect(alice.page).toHaveTitle(roomTitle);
    await expect(alice.page.locator("link[rel='icon']")).toHaveAttribute("href", "/favicon.svg");
    // The badged icon is served like any other file.
    expect((await alice.page.request.get("/favicon-turn.svg")).ok()).toBe(true);
  });
});

test.describe("sound switch", () => {
  test("muting survives a reload and is the only thing kept in storage", async ({ players }) => {
    const riya = await players.open("riya");
    await riya.page.goto("/");
    const banner = riya.page.getByRole("banner");

    await banner.getByRole("button", { name: "Sound on" }).click();
    await expect(banner.getByRole("button", { name: "Sound off" })).toBeVisible();
    await riya.page.reload();

    await expect(banner.getByRole("button", { name: "Sound off" })).toBeVisible();
    const stored = await riya.page.evaluate(() => Object.entries(localStorage));
    expect(stored).toEqual([["cc.sound", '{"muted":true,"volume":0.6}']]);

    await banner.getByRole("button", { name: "Sound off" }).click();
    await riya.page.reload();
    await expect(banner.getByRole("button", { name: "Sound on" })).toBeVisible();
  });
});
