import { expect, test } from "./fixtures.js";

// Achievements, streaks and daily quests (CC-054, CC-089): what a guest earns from one match, and that it stays
// put across reloads and history navigation.

/** A visitor becomes a guest from the home page (the one-click start), and sees today's quests. */
async function startAsGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  await expect(player.page.getByText(/You're playing as Guest-/)).toBeVisible();
}

/** Alice hosts a one-round Rock Paper Scissors match against Bob and wins it. */
async function aliceBeatsBob(alice, bob) {
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await bob.page.goto(invite);
  const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
  await choices(alice).getByRole("button", { name: /Rock/ }).click();
  await choices(bob)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
}

const achievementItem = (page, name) =>
  page.getByRole("list", { name: "Achievements" }).getByRole("listitem").filter({ hasText: name });

test.describe("gamification for guests", () => {
  test("a first match moves quests, starts a streak and unlocks achievements that survive reload and Back/Forward", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    await startAsGuest(alice);
    const homeQuests = alice.page.getByRole("region", { name: "Daily quests" });
    await expect(homeQuests).toContainText("Play your first match to start quests.");
    await expect(homeQuests).toContainText(/Resets in \d+h \d+m|Resets in \d+m/);
    await startAsGuest(bob);

    await aliceBeatsBob(alice, bob);

    // Told as it happens: match XP and the first unlocks, in the polite live region.
    const toasts = alice.page.getByRole("status").filter({ hasText: "Achievement unlocked" });
    await expect(toasts).toContainText("+30 XP");
    await expect(toasts).toContainText("Achievement unlocked: First Move");
    await expect(toasts).toContainText("Achievement unlocked: First Victory");

    // Home: one match always moves the "play" quest of the day (3, 5 or 2 different games).
    await alice.page.getByRole("link", { name: "ClassiCade home" }).click();
    await expect(alice.page).toHaveURL("/");
    await expect(homeQuests).not.toContainText("Play your first match");
    await expect(homeQuests.getByRole("list", { name: "Today's quests" })).toContainText(/1\/[235]/);

    // Profile: the player console.
    await homeQuests.getByRole("link", { name: "Open your player console" }).click();
    await expect(alice.page).toHaveURL("/profile");
    const panel = alice.page.getByRole("region", { name: "Player console" });
    await expect(panel.getByText("Daily streak", { exact: true }).locator("xpath=..")).toContainText("1 day");
    await expect(panel).toContainText("You've played today.");
    await expect(achievementItem(alice.page, "First Move")).toContainText("Unlocked");
    await expect(achievementItem(alice.page, "First Victory")).toContainText("Unlocked");
    await expect(achievementItem(alice.page, "Rising Star")).toContainText("1/10");
    await expect(
      panel.getByRole("link", { name: "Sign up to keep your streak and achievements" }),
    ).toHaveAttribute("href", "/signup?next=%2Fprofile");

    // History and reload keep everything.
    await alice.page.reload();
    await expect(achievementItem(alice.page, "First Victory")).toContainText("Unlocked");
    await alice.page.goBack();
    await expect(alice.page).toHaveURL("/");
    await expect(homeQuests.getByRole("list", { name: "Today's quests" })).toContainText(/1\/[235]/);
    await alice.page.goForward();
    await expect(alice.page).toHaveURL("/profile");
    await expect(achievementItem(alice.page, "First Move")).toContainText("Unlocked");

    // Bob finished the match too, but didn't win it.
    await bob.page.goto("/profile");
    await expect(achievementItem(bob.page, "First Move")).toContainText("Unlocked");
    await expect(achievementItem(bob.page, "First Victory")).toContainText("Locked.");
    await expect(achievementItem(bob.page, "First Victory")).toContainText("0/1");
  });

  test("a visitor without a session sees no quests, and the profile asks them to play first", async ({
    players,
  }) => {
    const visitor = await players.open("visitor");

    await visitor.page.goto("/");
    await expect(visitor.page.getByRole("button", { name: "Play as a guest" })).toBeVisible();
    await expect(visitor.page.getByRole("region", { name: "Daily quests" })).toHaveCount(0);
    await visitor.page.goto("/profile");
    await expect(visitor.page.getByRole("region", { name: "Player console" })).toHaveCount(0);
  });
});
