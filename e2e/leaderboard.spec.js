import { expect, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// Leaderboards (CC-053): public boards with one URL each; accounts climb them, guests never appear on them.

const TABS = [
  ["Overall XP", "/leaderboards/overall"],
  ["This week", "/leaderboards/weekly"],
  ["Rock Paper Scissors", "/leaderboards/rock-paper-scissors"],
  ["Tic Tac Toe", "/leaderboards/tic-tac-toe"],
  ["Chess", "/leaderboards/chess"],
];

const boardTabs = (page) => page.getByRole("navigation", { name: "Leaderboards" });

async function at(page, path, title) {
  await expect(page).toHaveURL(path);
  await expect(page).toHaveTitle(`${title} · Leaderboards · ClassiCade`);
  await expect(boardTabs(page).getByRole("link", { name: title, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
}

async function signUp(player, account) {
  await player.page.goto("/signup");
  await player.page.getByLabel("Username").fill(account.username);
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  await player.page.getByRole("button", { name: "Create account" }).click();
  await expect(player.page).toHaveURL("/");
}

test.describe("leaderboards", () => {
  test("a visitor browses the boards: tabs are links, Back and Forward walk them, reload stays", async ({
    players,
  }) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;
    await page.goto("/");

    await page.getByRole("banner").getByRole("link", { name: "Leaderboards" }).click();
    await at(page, "/leaderboards/overall", "Overall XP");
    const tabs = boardTabs(page).getByRole("link");
    await expect(tabs).toHaveCount(TABS.length);
    for (const [index, [name, href]] of TABS.entries()) {
      await expect(tabs.nth(index)).toHaveText(name);
      await expect(tabs.nth(index)).toHaveAttribute("href", href);
    }

    await boardTabs(page).getByRole("link", { name: "This week" }).click();
    await at(page, "/leaderboards/weekly", "This week");
    await expect(page.getByText(/^Resets in \d+(d \d+h|h \d+m|m)$/)).toBeVisible();
    await boardTabs(page).getByRole("link", { name: "Chess" }).click();
    await at(page, "/leaderboards/chess", "Chess");

    await page.goBack();
    await at(page, "/leaderboards/weekly", "This week");
    await page.goBack();
    await at(page, "/leaderboards/overall", "Overall XP");
    await page.goForward();
    await page.goForward();
    await at(page, "/leaderboards/chess", "Chess");
    await page.reload();
    await at(page, "/leaderboards/chess", "Chess");

    // Without a session nobody is asked to sign up for a rank, and no session is started for browsing.
    await expect(page.getByText(/Guests aren't ranked|Your rank|not on this board/)).toHaveCount(0);
    expect(await visitor.context.cookies()).toEqual([]);
  });

  test("/leaderboards opens the overall board, and an unknown board is not found", async ({ players }) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;
    await page.goto("/");

    await page.goto("/leaderboards");
    await at(page, "/leaderboards/overall", "Overall XP");
    await page.goBack();
    await expect(page).toHaveURL("/");

    visitor.expect(404, "/leaderboards/ludo"); // the server knows there is no such board (CC-047)
    await page.goto("/leaderboards/ludo");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page).toHaveURL("/leaderboards/ludo");
  });

  test("an account who wins climbs the boards; the guest they beat is never listed", async ({ players }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    await signUp(riya, account);
    await riya.page.goto("/games/rock-paper-scissors");
    await riya.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await riya.page.getByRole("button", { name: "Create room" }).click();
    const invite = await riya.page.getByRole("textbox", { name: "Invite link" }).inputValue();

    const bob = await players.open("bob");
    await bob.page.goto("/");
    await bob.page.getByRole("button", { name: "Play as a guest" }).click();
    const bobName = await bob.page
      .getByRole("banner")
      .getByText(/^Guest-/)
      .textContent();
    await bob.page.goto(invite);
    await riya.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /Rock/ }).click();
    await bob.page
      .getByRole("group", { name: "Your choice" })
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(riya.page.getByRole("heading", { name: "You won!" })).toBeVisible();

    // Boards are updated in the background after the match is stored: reload until riya is on them.
    const yourRow = riya.page.getByRole("listitem").filter({ hasText: account.username });
    await expect(async () => {
      await riya.page.goto("/leaderboards/rock-paper-scissors");
      await expect(yourRow).toContainText("1 win", { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(yourRow).toHaveAttribute("aria-current", "true");
    // A win is 30 XP; the day's quests may add a bonus (CC-089). A new account earned all of it this week.
    // Quest bonuses reach the boards in the background too: reload until both boards agree.
    await expect(async () => {
      await riya.page.goto("/leaderboards/overall");
      await expect(yourRow).toContainText(/\d+ XP/, { timeout: 1_000 });
      const [, overallXp] = (await yourRow.textContent()).match(/(\d+) XP/);
      expect(Number(overallXp)).toBeGreaterThanOrEqual(30);
      await boardTabs(riya.page).getByRole("link", { name: "This week" }).click();
      await expect(yourRow).toContainText(`${overallXp} XP`, { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(riya.page.getByText(bobName)).toHaveCount(0);

    await riya.page.goto("/profile");
    await expect(riya.page.getByRole("region", { name: "Your rank" }).getByText(/^#\d+$/)).toHaveCount(2);

    // The guest sees the boards too, with an invitation to get on them.
    await bob.page.goto("/leaderboards/rock-paper-scissors");
    await expect(bob.page.getByRole("listitem").filter({ hasText: account.username })).toBeVisible();
    await expect(bob.page.getByRole("listitem").filter({ hasText: bobName })).toHaveCount(0);
    const nudge = bob.page.getByText(/Guests aren't ranked/);
    await expect(nudge).toBeVisible();
    await nudge.getByRole("link", { name: "Sign up" }).click();
    await expect(bob.page).toHaveURL("/signup?next=%2Fleaderboards%2Frock-paper-scissors");
  });
});
