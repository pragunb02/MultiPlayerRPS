import { expect, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// Leaderboards (CC-053): public boards with one URL each. Accounts climb them, and so do guests under the name the
// server gave them, until the guest signs up and its place moves to the account (ADR-060).

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
  // An adult, so the name shows on the public boards (CC-152).
  await player.page.getByLabel("Year of birth").selectOption("1990");
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
    await expect(page.getByText(/keep your place|Your rank|not on this board/)).toHaveCount(0);
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

  test("a guest who wins is on the boards as its Guest name and sees its row as you; signing up moves it once", async ({
    players,
  }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    await signUp(riya, account);
    await riya.page.goto("/games/rock-paper-scissors");
    await riya.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await riya.page.getByRole("button", { name: "Create room" }).click();
    const invite = await riya.page.getByRole("textbox", { name: "Invite link" }).inputValue();

    const bobAccount = newAccount();
    const bob = await players.open("bob", { secrets: [bobAccount.email, bobAccount.password] });
    await bob.page.goto("/");
    await bob.page.getByRole("button", { name: "Play as a guest" }).click();
    const bobName = await bob.page
      .getByRole("banner")
      .getByText(/^Guest-/)
      .textContent();
    await bob.page.goto(invite);
    await bob.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /Rock/ }).click();
    await riya.page
      .getByRole("group", { name: "Your choice" })
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(bob.page.getByRole("heading", { name: /^You won/ })).toBeVisible();

    // Boards are updated in the background after the match is stored: reload until the guest is on them.
    const guestRow = (page) => page.getByRole("listitem").filter({ hasText: bobName });
    await expect(async () => {
      await bob.page.goto("/leaderboards/rock-paper-scissors");
      await expect(guestRow(bob.page)).toContainText("1 win", { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(guestRow(bob.page)).toHaveAttribute("aria-current", "true");
    await expect(guestRow(bob.page)).toContainText(`${bobName}you`);
    const nudge = bob.page.getByText(/to keep your place on the boards/);
    await expect(nudge).toBeVisible();
    // A win is 30 XP and the day's quests may add a bonus (CC-089). The guest earned all of it this week.
    let guestXp = 0;
    await expect(async () => {
      await bob.page.goto("/leaderboards/overall");
      await expect(guestRow(bob.page)).toContainText(/\d+ XP/, { timeout: 1_000 });
      [, guestXp] = (await guestRow(bob.page).textContent()).match(/(\d+) XP/);
      expect(Number(guestXp)).toBeGreaterThanOrEqual(30);
      await boardTabs(bob.page).getByRole("link", { name: "This week" }).click();
      await expect(guestRow(bob.page)).toContainText(`${guestXp} XP`, { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });

    // Everyone sees the guest under its server-given name, and the account sees only its own row as you.
    await riya.page.goto("/leaderboards/rock-paper-scissors");
    await expect(guestRow(riya.page)).toContainText("1 win");
    await expect(guestRow(riya.page)).not.toHaveAttribute("aria-current", "true");
    await riya.page.goto("/leaderboards/overall");
    // Riya lost, so its few XP put it in the top 50 only while the shared server is young. Its own place is its
    // row in the list, marked as current, or else the "Your rank" row pinned under the list, and exactly one of
    // the two is shown (CC-309).
    const riyaRow = riya.page
      .getByRole("listitem")
      .filter({ hasText: account.username })
      .and(riya.page.locator('[aria-current="true"]'));
    const pinnedRow = riya.page.locator("main p").filter({ hasText: /^Your rank: #\d+You\d+ XP$/ });
    await expect(riyaRow.or(pinnedRow)).toHaveCount(1);
    await expect(riya.page.locator('main [aria-current="true"]')).toHaveCount(await riyaRow.count());
    await expect(riya.page.getByText(/keep your place/)).toHaveCount(0);

    // The guest signs up from the board. Its place moves to the account: the same XP, once, under its username.
    await bob.page.goto("/leaderboards/overall");
    await bob.page
      .getByText(/to keep your place on the boards/)
      .getByRole("link", { name: "Sign up" })
      .click();
    await expect(bob.page).toHaveURL("/signup?next=%2Fleaderboards%2Foverall");
    await bob.page.getByLabel("Username").fill(bobAccount.username);
    await bob.page.getByLabel("Email").fill(bobAccount.email);
    await bob.page.getByLabel("Password").fill(bobAccount.password);
    await bob.page.getByLabel("Year of birth").selectOption("1990");
    await bob.page.getByRole("button", { name: "Create account" }).click();
    await expect(bob.page).toHaveURL("/leaderboards/overall");
    const bobRow = bob.page.getByRole("listitem").filter({ hasText: bobAccount.username });
    for (const [tab, score] of [
      ["Overall XP", `${guestXp} XP`],
      ["This week", `${guestXp} XP`],
      ["Rock Paper Scissors", "1 win"],
    ]) {
      await boardTabs(bob.page).getByRole("link", { name: tab, exact: true }).click();
      await expect(bobRow).toContainText(score);
      await expect(bobRow).toHaveAttribute("aria-current", "true");
      await expect(guestRow(bob.page)).toHaveCount(0);
    }
    await expect(bob.page.getByText(/keep your place/)).toHaveCount(0);
  });
});
