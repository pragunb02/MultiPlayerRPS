import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// Someone opens a friend's invite link without a session (CC-086): they choose how to join — as a guest, by
// logging in or by signing up — and land in the room. A guest who later signs up keeps their progress (CC-032).

const chooser = (page, game = "Tic Tac Toe") =>
  page.getByRole("heading", { name: `You're invited to play ${game}` });
const main = (page) => page.getByRole("main");
const guestSessionRequests = (player) =>
  player.record.urls.filter((url) => new URL(url).pathname === "/api/session/guest");

async function fillSignup(page, account) {
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

/**
 * Bonus XP the player's daily quests paid for their games so far (CC-089) — the day's quests depend on the player
 * id and the date, so a guest's first win may also finish "Get a win". Waits until gamification has counted the
 * first match (unlocking "First Move" is its last step).
 */
async function questBonusXp(page) {
  const read = async (path) => (await page.request.get(path)).json();
  await expect
    .poll(
      async () =>
        (await read("/api/achievements")).achievements.find((a) => a.id === "first-match").unlockedAt,
    )
    .not.toBeNull();
  const { quests } = await read("/api/quests");
  const done = quests.items.filter((item) => item.completedAt !== null);
  return (
    done.reduce((xp, item) => xp + item.bonusXp, 0) +
    (quests.sweep.completedAt === null ? 0 : quests.sweep.bonusXp)
  );
}

/** An account that exists before the test's visitor arrives (signed up and out in its own browser). */
async function existingAccount(players) {
  const account = newAccount();
  const owner = await players.open("account owner", { secrets: [account.email, account.password] });
  await owner.page.goto("/signup");
  await fillSignup(owner.page, account);
  await expect(owner.page).toHaveURL("/");
  await owner.leave();
  return account;
}

test.describe("invite link without a session", () => {
  test("asks how to join and creates nothing until the visitor chooses; reload asks again", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const visitor = await players.open("visitor");

    await visitor.page.goto(room.path);

    await expect(chooser(visitor.page)).toBeVisible();
    await expect(chooser(visitor.page)).toBeFocused();
    await expect(main(visitor.page)).toContainText(room.code);
    await expect(visitor.page).toHaveTitle(`Tic Tac Toe · Room ${room.code} · ClassiCade`);
    expect(visitor.url()).toBe(room.path);
    await visitor.page.reload();
    await expect(chooser(visitor.page)).toBeVisible();
    expect(guestSessionRequests(visitor)).toEqual([]);
    expect((await visitor.context.cookies()).map((c) => c.name)).not.toContain("cc.sid");
    await expect(host.page.getByRole("list", { name: "Players" })).toContainText("Waiting for a player");
  });

  test("plays as a guest: one click, then straight into the game", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const visitor = await players.open("visitor");

    await joinAsGuest(visitor, room.path);

    await expect(visitor.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
    await expect(host.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
    await expect(visitor.page.getByRole("banner")).toContainText(/Guest-/);
    expect(visitor.url()).toBe(room.path);
    expect(guestSessionRequests(visitor)).toHaveLength(1);
    await visitor.page.reload();
    await expect(visitor.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
  });

  test("logs in and lands in the room as the account; Back never shows the login form again", async ({
    players,
  }) => {
    const account = await existingAccount(players);
    const host = await players.open("host");
    const room = await createRoom(host, "chess");
    const visitor = await players.open("visitor", { secrets: [account.email, account.password] });
    await visitor.page.goto(room.path);

    await main(visitor.page).getByRole("link", { name: "Log in" }).click();
    await expect(visitor.page).toHaveURL(`/login?next=${encodeURIComponent(room.path)}`);
    await visitor.page.getByLabel("Email").fill(account.email);
    await visitor.page.getByLabel("Password").fill(account.password);
    await visitor.page.getByRole("button", { name: "Log in" }).click();

    await expect(visitor.page).toHaveURL(room.path);
    await expect(visitor.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
    await expect(visitor.page.getByRole("list", { name: "Players" })).toContainText(account.username);
    await expect(host.page.getByRole("list", { name: "Players" })).toContainText(account.username);
    expect(guestSessionRequests(visitor)).toEqual([]); // never a guest on the way

    await visitor.page.goBack();
    await expect(visitor.page.getByRole("heading", { name: "Log in", exact: true })).toHaveCount(0);
    await expect(visitor.page).toHaveURL(room.path);
    await expect(visitor.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
    await visitor.page.goForward();
    await expect(visitor.page).toHaveURL(room.path);
    await expect(visitor.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
  });

  test("signs up and lands in the room as the new account", async ({ players }) => {
    const account = newAccount();
    const host = await players.open("host");
    const room = await createRoom(host, "rock-paper-scissors");
    const visitor = await players.open("visitor", { secrets: [account.email, account.password] });
    await visitor.page.goto(room.path);

    await main(visitor.page).getByRole("link", { name: "Sign up" }).click();
    await expect(visitor.page).toHaveURL(`/signup?next=${encodeURIComponent(room.path)}`);
    await expect(visitor.page.getByText(/guest XP/)).toHaveCount(0); // nothing to carry over yet
    await fillSignup(visitor.page, account);

    await expect(visitor.page).toHaveURL(room.path);
    await expect(visitor.page.getByRole("group", { name: "Your choice" })).toBeVisible();
    await expect(visitor.page.getByRole("banner")).toContainText(account.username);
    expect(guestSessionRequests(visitor)).toEqual([]);
    await visitor.page.goBack();
    await expect(visitor.page.getByRole("heading", { name: "Create your account" })).toHaveCount(0);
  });

  test("Back from the login page shows the choice again; Back, Forward and reload keep it", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const visitor = await players.open("visitor");
    await visitor.page.goto("/");
    await visitor.page.goto(room.path);
    await expect(chooser(visitor.page)).toBeVisible();

    await main(visitor.page).getByRole("link", { name: "Log in" }).click();
    await expect(visitor.page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
    await visitor.page.goBack();
    await expect(visitor.page).toHaveURL(room.path);
    await expect(chooser(visitor.page)).toBeVisible();

    await visitor.page.goBack();
    await expect(visitor.page).toHaveURL("/");
    await visitor.page.goForward();
    await expect(chooser(visitor.page)).toBeVisible();
    await visitor.page.goForward();
    await expect(visitor.page).toHaveURL(`/login?next=${encodeURIComponent(room.path)}`);
    await visitor.page.goBack();
    await visitor.page.reload();
    await expect(chooser(visitor.page)).toBeVisible();
    expect(guestSessionRequests(visitor)).toEqual([]);
  });

  test("someone who already plays as a guest goes straight into the room", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const friend = await players.open("friend");
    await friend.page.goto("/");
    await friend.page.getByRole("button", { name: "Play as a guest" }).click();
    await expect(friend.page.getByText(/You're playing as Guest-/)).toBeVisible();

    await friend.page.goto(room.path);

    await expect(friend.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
    await expect(friend.page.getByRole("button", { name: "Play as guest" })).toHaveCount(0);
  });
});

test.describe("guest progress carries over to the account (CC-032)", () => {
  test("a guest who wins, then signs up, finds the XP and the match on their profile", async ({
    players,
  }) => {
    const account = newAccount();
    const alice = await players.open("alice", { secrets: [account.email, account.password] });
    await alice.page.goto("/games/rock-paper-scissors");
    await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await alice.page.getByRole("button", { name: "Create room" }).click();
    const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    const bob = await players.open("bob");
    await joinAsGuest(bob, invite);
    await alice.page
      .getByRole("group", { name: "Your choice" })
      .getByRole("button", { name: /Rock/ })
      .click();
    await bob.page
      .getByRole("group", { name: "Your choice" })
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(alice.page.getByRole("heading", { name: "You won!" })).toBeVisible();
    await expect(alice.page.getByText("+30 XP")).toBeVisible(); // the XP is stored before she signs up
    const xp = 30 + (await questBonusXp(alice.page));

    await alice.page.goto("/signup?next=%2Fprofile");
    await expect(
      alice.page.getByText("Your guest XP, level and match history will move to your new account."),
    ).toBeVisible();
    await fillSignup(alice.page, account);

    await expect(alice.page).toHaveURL("/profile");
    await expect(
      alice.page.getByText(`Welcome! We moved ${xp} XP and 1 match from your guest games.`),
    ).toBeVisible();
    await expect(alice.page.getByRole("heading", { level: 1 })).toHaveText(account.username);
    await expect(main(alice.page)).toContainText(`${xp} XP`);
    const history = alice.page.getByRole("list", { name: "Match history" });
    await expect(history.getByRole("listitem")).toHaveCount(1);
    await expect(history).toContainText("Won");
    await alice.page.reload();
    await expect(history.getByRole("listitem")).toHaveCount(1);
  });

  test("a guest who logs in is told their games are added to the account", async ({ players }) => {
    const account = await existingAccount(players);
    const guest = await players.open("guest", { secrets: [account.email, account.password] });
    await guest.page.goto("/");
    await guest.page.getByRole("button", { name: "Play as a guest" }).click();
    await expect(guest.page.getByText(/You're playing as Guest-/)).toBeVisible();

    await guest.page.getByRole("banner").getByRole("link", { name: "Log in" }).click();
    await expect(
      guest.page.getByText("Logging in adds this guest's XP and matches to your account."),
    ).toBeVisible();
    await guest.page.getByLabel("Email").fill(account.email);
    await guest.page.getByLabel("Password").fill(account.password);
    await guest.page.getByRole("button", { name: "Log in" }).click();

    await expect(guest.page).toHaveURL("/");
    await expect(guest.page.getByRole("banner")).toContainText(account.username);
    await expect(guest.page.getByText(/We moved/)).toHaveCount(0); // nothing played as a guest, nothing to say
  });
});
