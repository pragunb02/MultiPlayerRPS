import { createRoom, expect, header, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// A person with several tabs and devices (CC-234, CC-115, ADR-033). Every tab and device shows who the server says
// the browser is, without a reload: after a sign out from another device, and after signing in or out in another
// tab of the same browser.

const banner = (page) => page.getByRole("banner");
const loginLink = async (page) => (await header(page)).getByRole("link", { name: "Log in" });
const chooser = (page) => page.getByRole("heading", { name: "You're invited to play Tic Tac Toe" });
const inviteCard = (page) => page.getByRole("heading", { name: "Invite a friend" });

/** Marks the page, so a test can tell afterwards that it was never reloaded. */
const markPage = (page) =>
  page.evaluate(() => {
    window.ccNotReloaded = true;
  });
const wasNotReloaded = (page) => page.evaluate(() => window.ccNotReloaded === true);

async function signUp(page, account) {
  await page.goto("/signup");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
}

async function logIn(page, account) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("signed out from another device (CC-234)", () => {
  test("sign out other devices on the laptop: the phone leaves its room and shows signed out without a reload", async ({
    players,
  }) => {
    const account = newAccount();
    const secrets = { secrets: [account.email, account.password] };
    const laptop = await players.open("laptop", secrets);
    await signUp(laptop.page, account);
    const phone = await players.open("phone", secrets);
    await logIn(phone.page, account);
    const room = await createRoom(phone, "tic-tac-toe");
    await expect(banner(phone.page)).toContainText(account.username);
    await markPage(phone.page);

    await laptop.page.goto("/profile");
    const settings = laptop.page.getByRole("region", { name: "Account" });
    await settings.getByRole("button", { name: "Sign out other devices" }).click();
    await expect(settings.getByRole("status")).toHaveText("Your other devices are signed out.");

    await expect(await loginLink(phone.page)).toBeVisible();
    await expect(chooser(phone.page)).toBeVisible();
    await expect(inviteCard(phone.page)).toHaveCount(0);
    await expect(banner(phone.page)).not.toContainText(account.username);
    expect(phone.url()).toBe(room.path);
    expect(await wasNotReloaded(phone.page)).toBe(true);
    await expect(banner(laptop.page)).toContainText(account.username);
  });

  test("a password change on the laptop shows the phone signed out without a reload", async ({ players }) => {
    const account = newAccount();
    const newPassword = `${account.password} renewed`;
    const secrets = { secrets: [account.email, account.password, newPassword] };
    const laptop = await players.open("laptop", secrets);
    await signUp(laptop.page, account);
    const phone = await players.open("phone", secrets);
    await logIn(phone.page, account);
    await expect(banner(phone.page)).toContainText(account.username);
    await markPage(phone.page);

    await laptop.page.goto("/profile");
    const settings = laptop.page.getByRole("region", { name: "Account" });
    await settings.getByLabel("Current password").fill(account.password);
    await settings.getByLabel("New password").fill(newPassword);
    await settings.getByRole("button", { name: "Change password" }).click();
    await expect(settings.getByRole("status")).toHaveText(
      "Password changed. Your other devices are signed out.",
    );

    await expect(await loginLink(phone.page)).toBeVisible();
    await expect(banner(phone.page)).not.toContainText(account.username);
    expect(await wasNotReloaded(phone.page)).toBe(true);
  });
});

test.describe("other tabs of the same browser (CC-115)", () => {
  test("sign in on tab 1, and tab 2 shows the account", async ({ players }) => {
    const account = newAccount();
    const person = await players.open("person", { secrets: [account.email, account.password] });
    const first = person.page;
    const second = await person.openTab();
    await second.goto("/");
    await expect(await loginLink(second)).toBeVisible();
    await markPage(second);

    await signUp(first, account);

    await expect(banner(second)).toContainText(account.username);
    await expect(await loginLink(second)).toHaveCount(0);
    expect(await wasNotReloaded(second)).toBe(true);
  });

  test("a guest in a room on tab 2 becomes the account when tab 1 logs in", async ({ players }) => {
    // The server ends tab 2's guest socket before the browser has the new cookie, so tab 2's first ask can answer
    // "signed out". The ask after tab 1's message must win (PR #74 review).
    const account = newAccount();
    const owner = await players.open("account owner", { secrets: [account.email, account.password] });
    await signUp(owner.page, account);
    await owner.leave();
    const person = await players.open("person", { secrets: [account.email, account.password] });
    const second = await person.openTab();
    await second.goto("/games/tic-tac-toe");
    await second.getByRole("button", { name: "Create room" }).click();
    await expect(inviteCard(second)).toBeVisible();
    await expect((await header(second)).getByTitle("Guest")).toBeVisible();
    const roomPath = new URL(second.url()).pathname;
    await markPage(second);

    await logIn(person.page, account);

    await expect(banner(second)).toContainText(account.username);
    await expect(await loginLink(second)).toHaveCount(0);
    await expect(inviteCard(second)).toBeVisible();
    expect(new URL(second.url()).pathname).toBe(roomPath);
    expect(await wasNotReloaded(second)).toBe(true);
  });

  test("starting a guest on tab 1 shows that guest on tab 2", async ({ players }) => {
    const person = await players.open("person");
    const second = await person.openTab();
    await second.goto("/");
    await markPage(second);

    await createRoom(person, "tic-tac-toe");
    const guestName = (await banner(person.page).getByTitle("Guest").textContent()).trim();

    await expect(banner(second).getByTitle("Guest")).toHaveText(guestName);
    expect(await wasNotReloaded(second)).toBe(true);
  });

  test("log out on tab 1, and tab 2 leaves its room screen and shows signed out", async ({ players }) => {
    const account = newAccount();
    const person = await players.open("person", { secrets: [account.email, account.password] });
    const first = person.page;
    await signUp(first, account);
    const second = await person.openTab();
    await second.goto("/games/tic-tac-toe");
    await second.getByRole("button", { name: "Create room" }).click();
    await expect(inviteCard(second)).toBeVisible();
    const roomPath = new URL(second.url()).pathname;
    await markPage(second);

    await (await header(first)).getByRole("button", { name: "Log out" }).click();
    await expect(await loginLink(first)).toBeVisible();

    await expect(await loginLink(second)).toBeVisible();
    await expect(chooser(second)).toBeVisible();
    await expect(inviteCard(second)).toHaveCount(0);
    await expect(banner(second)).not.toContainText(account.username);
    expect(new URL(second.url()).pathname).toBe(roomPath);
    expect(await wasNotReloaded(second)).toBe(true);
  });
});
