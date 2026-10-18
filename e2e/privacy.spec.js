import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// An account holder's data and privacy (CC-035, CC-152): the year of birth at sign-up, a copy of their data, and
// deleting the account. The opponent of a deleted player keeps the game, with "Deleted player".

const privacyOf = (page) => page.getByRole("region", { name: "Your data and privacy" });

async function signUp(page, account, birthYear) {
  await page.goto("/signup");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  if (birthYear !== undefined) {
    await page.getByLabel("Year of birth").selectOption(String(birthYear));
  }
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
}

/** `host` creates a one round game of Rock Paper Scissors, `guest` joins by the link, and `host` wins. */
async function hostBeatsGuest(host, guest) {
  await host.page.goto("/games/rock-paper-scissors");
  await host.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await host.page.getByRole("button", { name: "Create room" }).click();
  const invite = await host.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await guest.page.goto(invite);
  await guest.page.getByRole("button", { name: "Play as guest" }).click();
  await host.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /Rock/ }).click();
  await guest.page
    .getByRole("group", { name: "Your choice" })
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(host.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
}

test.describe("an account holder's data (CC-035)", () => {
  test("downloads a copy of their data, deletes the account, and the opponent keeps the game", async ({
    players,
  }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    const bob = await players.open("bob");
    await signUp(riya.page, account, 1990);
    await hostBeatsGuest(riya, bob);
    await expect(async () => {
      await riya.page.goto("/profile");
      await expect(riya.page.getByRole("list", { name: "Match history" })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });

    // The download: a JSON file with the account and the game, the opponent by display name only.
    const privacy = privacyOf(riya.page);
    await privacy.getByLabel("Password for the download").fill(account.password);
    const [download] = await Promise.all([
      riya.page.waitForEvent("download"),
      privacy.getByRole("button", { name: "Download my data" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^classicade-data-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(exported.account).toEqual(
      expect.objectContaining({ username: account.username, email: account.email, birthYear: 1990 }),
    );
    expect(exported.matches).toHaveLength(1);
    expect(exported.matches[0].players.map((p) => p.player)).toEqual(["you", "player-2"]);
    expect(JSON.stringify(exported)).not.toMatch(/guest_[0-9a-f-]{36}/);
    await expect(privacy.getByText("Your data is downloaded.")).toBeVisible();
    await expect(privacy.getByLabel("Password for the download")).toHaveValue("");

    // A wrong password deletes nothing.
    riya.expect(400, "/api/account/delete");
    await privacy.getByLabel("Password for deleting").fill("not my password");
    await privacy.getByRole("button", { name: "Delete my account" }).click();
    await riya.page
      .getByRole("dialog", { name: "Delete your account?" })
      .getByRole("button", { name: "Delete for good" })
      .click();
    await expect(privacy.getByText("That is not your password")).toBeVisible();

    // The real deletion: the question says what goes and what stays, then the browser is signed out.
    await privacy.getByLabel("Password for deleting").fill(account.password);
    await privacy.getByRole("button", { name: "Delete my account" }).click();
    const dialog = riya.page.getByRole("dialog", { name: "Delete your account?" });
    await expect(dialog.getByText(/replaced by "Deleted player"/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep my account" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete for good" }).click();
    await expect(riya.page.getByText(/Your account and its data are deleted\./)).toBeVisible();
    await expect(riya.page).toHaveURL("/profile");
    await expect(
      riya.page.getByRole("region", { name: "Your profile" }).getByRole("link", { name: "Log in" }),
    ).toBeVisible();
    await expect(riya.page.getByRole("banner")).not.toContainText(account.username);
    // A reload shows the same: the browser has no account any more.
    await riya.page.reload();
    await expect(privacyOf(riya.page)).toHaveCount(0);

    // Bob keeps the game he lost, against "Deleted player", and the boards no longer list Riya.
    await bob.page.goto("/profile");
    await expect(bob.page.getByRole("list", { name: "Match history" })).toContainText("vs Deleted player");
    await bob.page.goto("/leaderboards/rock-paper-scissors");
    await expect(bob.page.getByRole("listitem").filter({ hasText: account.username })).toHaveCount(0);

    // The account is gone: the old password no longer logs in.
    riya.expect(401, "/api/auth/login");
    await riya.page.goto("/login");
    await riya.page.getByLabel("Email").fill(account.email);
    await riya.page.getByLabel("Password").fill(account.password);
    await riya.page.getByRole("button", { name: "Log in" }).click();
    await expect(riya.page.getByRole("alert")).toHaveText("Invalid email or password");
  });
});

test.describe("the year of birth (CC-152)", () => {
  test("a child is refused an account after choosing the year, the year is never sent, and cannot be changed", async ({
    players,
  }) => {
    const account = newAccount();
    const kid = await players.open("kid", { secrets: [account.email, account.password] });
    const { page } = kid;
    await page.goto("/signup");
    const year = page.getByLabel("Year of birth");
    // Neutral: it starts at "I'd rather not say", lists every year, and says nothing about any age.
    await expect(year).toHaveValue("");
    await expect(page.getByText(/must be|aged 13|under 18|over 18/)).toHaveCount(0);

    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    const childYear = String(new Date().getFullYear() - 8);
    await year.selectOption(childYear);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
      page.getByText("ClassiCade accounts are for people aged 13 and over. You can keep playing as a guest."),
    ).toBeVisible();
    await expect(year).toBeDisabled();
    await expect(year).toHaveValue(childYear);
    expect(kid.record.urls.some((url) => url.endsWith("/api/auth/signup"))).toBe(false);
    await page.getByRole("link", { name: "Play as a guest" }).click();
    await expect(page).toHaveURL("/");
  });

  test("an account without a year is hidden on the public boards until it states one", async ({
    players,
  }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    const bob = await players.open("bob");
    await signUp(riya.page, account);
    await hostBeatsGuest(riya, bob);

    // Riya's own row says "you", while everyone sees "Hidden player" for her name.
    const yourRow = riya.page
      .getByRole("listitem")
      .filter({ has: riya.page.getByText("you", { exact: true }) });
    await expect(async () => {
      await riya.page.goto("/leaderboards/rock-paper-scissors");
      await expect(yourRow).toContainText("Hidden player", { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(riya.page.getByRole("listitem").filter({ hasText: account.username })).toHaveCount(0);
    await expect(riya.page.getByText(/has not said their age/)).toBeVisible();

    await riya.page.goto("/profile");
    const privacy = privacyOf(riya.page);
    await expect(
      privacy.getByText("On the public leaderboards your name shows as Hidden player."),
    ).toBeVisible();
    await privacy.getByLabel("Year of birth").selectOption("1990");
    await privacy.getByRole("button", { name: "Save year" }).click();
    await expect(privacy.getByText(/^1990\. It can be set once/)).toBeVisible();

    await bob.page.goto("/leaderboards/rock-paper-scissors");
    await expect(bob.page.getByRole("listitem").filter({ hasText: account.username })).toBeVisible();
  });
});
