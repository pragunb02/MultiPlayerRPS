import { expect, test } from "./fixtures.js";

// Challenges (CC-139) and the requests that reach a player on any page (CC-207). Alice makes a challenge link and
// sends it on WhatsApp. Bob opens it later, as a visitor, and takes it. Alice is on another page: the news reaches
// her there, and Go and play brings both into the game. Not now keeps it in her inbox instead.

const nameOf = async (player) =>
  player.page
    .getByRole("banner")
    .getByText(/^Guest-/)
    .textContent();
const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
const takenPopup = (player) => player.page.getByRole("region", { name: "Challenge taken" });

/** Alice makes a best-of-1 Rock Paper Scissors challenge from the lobby. Answers its link as she would send it. */
async function makeChallenge(alice) {
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Make a challenge link" }).click();
  await expect(alice.page.getByRole("heading", { name: "Your Rock Paper Scissors challenge" })).toBeVisible();
  await expect(alice.page).toHaveURL(/\/challenge\/[0-9a-hjkmnp-tv-z]{20}$/);
  const link = await alice.page.getByRole("textbox", { name: "Challenge link" }).inputValue();
  const whatsapp = await alice.page.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href");
  expect(decodeURIComponent(whatsapp)).toContain(new URL(link).pathname);
  return new URL(link).pathname;
}

/** Bob opens the link without an account, plays as a guest and takes the challenge. */
async function takeAsVisitor(bob, path) {
  await bob.page.goto(path);
  await expect(
    bob.page.getByRole("heading", { name: "You've been challenged to Rock Paper Scissors" }),
  ).toBeVisible();
  // Alice is a guest, so the link never shows her name (ADR-028.7).
  await expect(
    bob.page.getByText("A ClassiCade player challenges you to Rock Paper Scissors."),
  ).toBeVisible();
  await bob.page.getByRole("button", { name: "Play as guest" }).click();
  await bob.page.getByRole("button", { name: "Accept and play" }).click();
  await expect(bob.page).toHaveURL(/\/games\/rock-paper-scissors\/rooms\/[A-Z0-9]{6}$/);
}

test.describe("challenge links (CC-139)", () => {
  test("Alice sends a link, Bob takes it, Alice hears it on another page and both play", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const path = await makeChallenge(alice);
    const aliceName = await nameOf(alice);
    await alice.page.goto("/leaderboards/overall");

    const bob = await players.open("bob");
    await takeAsVisitor(bob, path);
    await expect(bob.page.getByRole("heading", { name: `Waiting for ${aliceName}` })).toBeVisible();
    const bobName = await nameOf(bob);

    await expect(takenPopup(alice)).toContainText(`${bobName} took your Rock Paper Scissors challenge.`);
    await takenPopup(alice).getByRole("button", { name: "Go and play" }).click();

    await expect(choices(alice)).toBeVisible();
    await expect(choices(bob)).toBeVisible();
    await choices(alice).getByRole("button", { name: /Rock/ }).click();
    await choices(bob)
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  });

  test("Not now keeps it in the inbox, from where Alice goes to the game", async ({ players }) => {
    const alice = await players.open("alice");
    const path = await makeChallenge(alice);
    await alice.page.goto("/");
    const bob = await players.open("bob");
    await takeAsVisitor(bob, path);

    await takenPopup(alice).getByRole("button", { name: "Not now" }).click();
    await expect(takenPopup(alice)).toHaveCount(0);
    await alice.page.getByRole("button", { name: "Inbox 1 waiting" }).click();
    await alice.page
      .getByRole("region", { name: "Inbox" })
      .getByRole("link", { name: "Go and play" })
      .click();

    await expect(choices(alice)).toBeVisible();
    await expect(choices(bob)).toBeVisible();
  });

  test("a link that was taken back or leads nowhere says so, with the way to play", async ({ players }) => {
    const alice = await players.open("alice");
    const path = await makeChallenge(alice);
    await alice.page.getByRole("button", { name: "Take back" }).click();
    await expect(alice.page.getByRole("heading", { name: "Challenge taken back" })).toBeVisible();

    const bob = await players.open("bob");
    await bob.page.goto(path);
    await expect(bob.page.getByRole("heading", { name: "Challenge taken back" })).toBeVisible();
    await expect(bob.page.getByRole("link", { name: "Play Rock Paper Scissors" })).toHaveAttribute(
      "href",
      "/games/rock-paper-scissors",
    );

    bob.expect(404, "/api/challenges/0000000000000000zzzz");
    await bob.page.goto("/challenge/0000000000000000zzzz");
    await expect(bob.page.getByRole("heading", { name: "Challenge not found" })).toBeVisible();
    await expect(bob.page).toHaveTitle("Challenge not found · ClassiCade");
  });
});
