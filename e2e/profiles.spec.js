import { expect, header, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// Public profiles and avatars (CC-034, ADR-065). Riya, an adult, picks an avatar, plays a guest and makes her profile
// public. A visitor finds her on the leaderboard and opens her profile by its random handle. A minor's and a guest's
// profiles are "Hidden player", and a private one shows the name and avatar only. No answer about a profile holds
// anything shaped like a player id.

const PLAYER_ID = /(?<![A-Za-z0-9_-])(?:guest|user|deleted|bot)_[A-Za-z0-9-]+/;
const HANDLE_PATH = /^\/players\/[0-9a-hjkmnp-tv-z]{16}$/;
const MINOR_YEAR = String(new Date().getFullYear() - 15);

async function signUp(player, account, birthYear) {
  await player.page.goto("/signup");
  await player.page.getByLabel("Username").fill(account.username);
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  if (birthYear !== undefined) {
    await player.page.getByLabel("Year of birth").selectOption(birthYear);
  }
  await player.page.getByRole("button", { name: "Create account" }).click();
  await expect(player.page).toHaveURL("/");
}

async function asGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  const name = (await header(player.page)).getByText(/^Guest-/);
  await expect(name).toBeVisible();
  return name.textContent();
}

/** The player's own profile link, from their profile page. */
async function ownLink(player) {
  await player.page.goto("/profile");
  const link = player.page.getByRole("link", { name: HANDLE_PATH });
  await expect(link).toBeVisible();
  return link.getAttribute("href");
}

/** Opens a profile and answers what the API said about it. */
async function openProfile(player, path) {
  const answer = player.page.waitForResponse((res) =>
    new URL(res.url()).pathname.startsWith("/api/profiles/"),
  );
  await player.page.goto(path);
  const res = await answer;
  return { status: res.status(), text: await res.text() };
}

const picker = (page) => page.getByRole("group", { name: "Your avatar" });

test.describe("public profiles and avatars", () => {
  test("an adult picks an avatar, it shows in the room, and a visitor opens her public profile from the board", async ({
    players,
  }) => {
    const riya = await players.open("riya");
    const bob = await players.open("bob");
    const visitor = await players.open("visitor");
    const account = newAccount();
    await signUp(riya, account, "1990");

    // Riya picks the crown and makes her profile public.
    await riya.page.goto("/profile");
    await picker(riya.page).getByRole("radio", { name: "Crown" }).check();
    await expect(picker(riya.page).getByRole("status")).toHaveText("Crown is your avatar now.");
    await riya.page.getByRole("button", { name: "Make my profile public" }).click();
    await expect(riya.page.getByText("Tumhara profile ab sabko dikhta hai.")).toBeVisible();
    const link = await ownLink(riya);

    // A game against a guest puts her on the board. Her avatar is on her seat for both of them.
    await asGuest(bob);
    await riya.page.goto("/games/rock-paper-scissors");
    await riya.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await riya.page.getByRole("button", { name: "Create room" }).click();
    const invite = await riya.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    await bob.page.goto(invite);
    for (const player of [riya, bob]) {
      const seat = player.page.getByRole("list", { name: "Players" }).getByRole("listitem").first();
      await expect(seat).toContainText(account.username);
      await expect(seat.locator("svg .silhouette")).toHaveCount(0);
    }
    await riya.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /Rock/ }).click();
    await bob.page
      .getByRole("group", { name: "Your choice" })
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(riya.page.getByRole("heading", { name: /^You won/ })).toBeVisible();

    // A visitor finds her on the board and opens her profile.
    await visitor.page.goto("/leaderboards/overall");
    const row = visitor.page.getByRole("link", { name: account.username });
    await expect(async () => {
      await visitor.page.reload();
      await expect(row).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(row).toHaveAttribute("href", link);
    const answer = visitor.page.waitForResponse((res) =>
      new URL(res.url()).pathname.startsWith("/api/profiles/"),
    );
    await row.click();
    await expect(visitor.page).toHaveURL(link);
    const res = await answer;
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toMatch(PLAYER_ID);
    await expect(visitor.page.getByRole("heading", { level: 1, name: account.username })).toBeVisible();
    await expect(visitor.page.getByText("Chess rating")).toBeVisible();
    await expect(visitor.page.getByText(account.email)).toHaveCount(0);
  });

  test("a minor's and a guest's profiles are Hidden player, and a private one shows only name and avatar", async ({
    players,
  }) => {
    const kabir = await players.open("kabir");
    const guest = await players.open("guest");
    const arjun = await players.open("arjun");
    const visitor = await players.open("visitor");
    const minorAccount = newAccount();
    const adultAccount = newAccount();
    await signUp(kabir, minorAccount, MINOR_YEAR);
    await asGuest(guest);
    await signUp(arjun, adultAccount, "1990");

    for (const player of [kabir, guest]) {
      const { status, text } = await openProfile(visitor, await ownLink(player));
      expect(status).toBe(200);
      expect(text).not.toMatch(PLAYER_ID);
      await expect(visitor.page.getByRole("heading", { level: 1, name: "Hidden player" })).toBeVisible();
      await expect(visitor.page.getByText("Is player ka profile chhupa hua hai.")).toBeVisible();
      await expect(visitor.page.getByText("Played")).toHaveCount(0);
      await expect(visitor.page.getByText(minorAccount.username)).toHaveCount(0);
    }

    // The minor's own switch is locked and says why.
    await kabir.page.goto("/profile");
    await expect(kabir.page.getByText(/Jab tak pakka na ho ki tum 18/)).toBeVisible();

    const privateProfile = await openProfile(visitor, await ownLink(arjun));
    expect(privateProfile.text).not.toMatch(PLAYER_ID);
    await expect(visitor.page.getByRole("heading", { level: 1, name: adultAccount.username })).toBeVisible();
    await expect(visitor.page.getByText("This profile is private.")).toBeVisible();
    await expect(visitor.page.getByText("Played")).toHaveCount(0);
  });
});
