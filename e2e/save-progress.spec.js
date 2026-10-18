import mongoose from "mongoose";
import { expect, header, joinAsGuest, test } from "./fixtures.js";
import { E2E_MONGO_URI, newAccount } from "./personas.js";

// Guests are asked to save their progress when they have something to lose (CC-097): a card after a win, "Save it"
// on the level-up toast, a line when their streak is at risk, and "Save progress" in the header. Each can be
// closed for the rest of the visit, nothing blocks play, and account holders and visitors never see any of it.

const card = (page) => page.getByRole("region", { name: "Save your progress" });
const headerSignup = async (page) => (await header(page)).getByRole("link", { name: /sign up/i });
/** A toast (the room's result panel is a status region too). */
const toast = (page, text) =>
  page
    .getByRole("status")
    .filter({ hasText: text })
    .filter({ hasNotText: /You won|You lost|Draw (by|with|on)/ });
const readApi = async (page, path) => (await page.request.get(path)).json();

async function startAsGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  await expect(player.page.getByText(/You're playing as Guest-/)).toBeVisible();
}

async function fillSignup(page, account) {
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

/**
 * Alice hosts a one-round Rock Paper Scissors match against Bob in a new room and wins it. Returns the room path.
 * `inLobby`: she is already in the lobby (got there in the app, so this visit's memory — closed prompts — stays).
 */
async function aliceBeatsBob(alice, bob, { inLobby = false } = {}) {
  if (!inLobby) await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  if ((await bob.context.cookies()).length === 0) {
    await joinAsGuest(bob, invite);
  } else {
    await bob.page.goto(invite);
  }
  const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
  await choices(alice).getByRole("button", { name: /Rock/ }).click();
  await choices(bob)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  return new URL(invite).pathname;
}

/**
 * Waits until the server has finished paying for `wins` wins: match XP, then perhaps a quest bonus (CC-089). The
 * server sends a win's quests after its bonus XP, so once this page has the quests of all `wins`, the stored
 * numbers are final. Pushes reach only the page that is open, so call this before a reload.
 */
async function waitForWinsToSettle(player, { wins }) {
  const questPushes = () =>
    player.record.socketFrames.filter((frame) => frame.includes('"quests:updated"')).length;
  await expect.poll(questPushes, { timeout: 15_000 }).toBeGreaterThanOrEqual(wins);
}

/** The card shows the guest's stored numbers. Returns them. */
async function expectCardToShowStoredProgress(page) {
  let stored;
  await expect(async () => {
    const [{ progress }, { streaks }] = await Promise.all([
      readApi(page, "/api/progress"),
      readApi(page, "/api/streaks"),
    ]);
    const kept = card(page).getByRole("list", { name: "What you'd keep" });
    await expect(kept).toContainText(`Level ${progress.level}`, { timeout: 1_000 });
    await expect(kept).toContainText(`${progress.xp} XP`, { timeout: 1_000 });
    await expect(kept).toContainText(`${progress.wins} ${progress.wins === 1 ? "win" : "wins"}`, {
      timeout: 1_000,
    });
    await expect(kept).toContainText(`${streaks.daily.current}-day streak`, { timeout: 1_000 });
    stored = progress;
  }).toPass({ timeout: 10_000 });
  return stored;
}

test.describe("a guest who wins", () => {
  test("is offered to save it, signs up from the card and is back in the room as the account, with the numbers confirmed", async ({
    players,
  }) => {
    const account = newAccount();
    const alice = await players.open("alice", { secrets: [account.email, account.password] });
    const bob = await players.open("bob");
    await startAsGuest(alice);
    await expect(await headerSignup(alice.page)).toHaveText("Sign up"); // nothing to save yet

    const room = await aliceBeatsBob(alice, bob);

    await expect(card(alice.page)).toBeVisible();
    await waitForWinsToSettle(alice, { wins: 1 });
    const before = await expectCardToShowStoredProgress(alice.page);
    expect(before.wins).toBe(1);
    // Under the result and the rematch offer, covering nothing.
    const result = await alice.page.getByRole("button", { name: "New opponent" }).boundingBox();
    const rematch = await alice.page.getByRole("region", { name: "Rematch" }).boundingBox();
    const offered = await card(alice.page).boundingBox();
    expect(offered.y).toBeGreaterThanOrEqual(result.y + result.height);
    expect(offered.y).toBeGreaterThanOrEqual(rematch.y + rematch.height);
    await expect(card(alice.page).getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(room)}`,
    );
    // The header's sign-up says what it does for her now.
    await expect(await headerSignup(alice.page)).toHaveText("Save progress");
    await expect(
      (await header(alice.page)).getByRole("link", { name: "Save progress — sign up" }),
    ).toHaveAttribute("href", `/signup?next=${encodeURIComponent(room)}`);

    await card(alice.page).getByRole("link", { name: "Sign up — keep it" }).click();
    await expect(alice.page).toHaveURL(`/signup?next=${encodeURIComponent(room)}`);
    await fillSignup(alice.page, account);

    await expect(alice.page).toHaveURL(room);
    await expect(alice.page.getByRole("banner")).toContainText(account.username);
    const { progress } = await readApi(alice.page, "/api/progress");
    expect(progress.xp).toBe(before.xp);
    await expect(
      toast(alice.page, `Your progress is now saved: Level ${progress.level} · ${progress.xp} XP · 1 match`),
    ).toBeVisible();
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expect(card(alice.page)).toHaveCount(0);
    await expect(await headerSignup(alice.page)).toHaveCount(0);

    // Signing in replaced the form in history: Back stays in the room, as the account, and never shows the form.
    await alice.page.goBack();
    await expect(alice.page).toHaveURL(room);
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expect(card(alice.page)).toHaveCount(0);
    await alice.page.goForward();
    await expect(alice.page).toHaveURL(room);
    await expect(alice.page.getByRole("button", { name: "Create account" })).toHaveCount(0);
    await expect(card(alice.page)).toHaveCount(0);
    await alice.page.goBack();
    await alice.page.goBack();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
    await expect(alice.page.getByRole("banner")).toContainText(account.username);
  });

  test("closes the card for the rest of the visit; a reload starts over (nothing is stored)", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    await startAsGuest(alice);
    const first = await aliceBeatsBob(alice, bob);
    await expect(card(alice.page)).toBeVisible();

    await alice.page.getByRole("button", { name: "Close: save your progress" }).click();

    await expect(card(alice.page)).toHaveCount(0);
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expect(await headerSignup(alice.page)).toHaveText("Save progress"); // the quiet way in stays
    // Another room, another win (2 wins, 60+ XP — worth a card), but she closed it.
    await alice.page.getByRole("button", { name: "New opponent" }).click();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
    const second = await aliceBeatsBob(alice, bob, { inLobby: true });
    expect(second).not.toBe(first);
    await expect.poll(async () => (await readApi(alice.page, "/api/progress")).progress.wins).toBe(2);
    await expect(await headerSignup(alice.page)).toHaveText("Save progress");
    await expect(card(alice.page)).toHaveCount(0);
    await waitForWinsToSettle(alice, { wins: 2 });

    await alice.page.reload();

    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expect(card(alice.page)).toBeVisible();
    await expectCardToShowStoredProgress(alice.page);
  });

  test("gets 'Save it' on the level-up toast, back to the page they were on", async ({ players }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    await startAsGuest(alice);
    let room = await aliceBeatsBob(alice, bob);
    // Level 2 is 50 XP: the first win (30) gets there with a quest bonus, the second always does.
    const levelUp = toast(alice.page, "Level up! You reached level 2");
    const already = await levelUp
      .waitFor({ state: "attached", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!already) {
      room = await aliceBeatsBob(alice, bob);
    }

    const saveIt = levelUp.getByRole("link", { name: "Save it" });
    await expect(saveIt).toHaveAttribute("href", `/signup?next=${encodeURIComponent(room)}`);
    await saveIt.click();

    await expect(alice.page).toHaveURL(`/signup?next=${encodeURIComponent(room)}`);
    await expect(alice.page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await alice.page.goBack();
    await expect(alice.page).toHaveURL(room);
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  });

  test("can close the level-up offer; the toast goes and the game goes on", async ({ players }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    await startAsGuest(alice);
    await aliceBeatsBob(alice, bob);
    const levelUp = toast(alice.page, "Level up! You reached level 2");
    if (
      !(await levelUp.waitFor({ state: "attached", timeout: 5_000 }).then(
        () => true,
        () => false,
      ))
    ) {
      await aliceBeatsBob(alice, bob);
    }

    await levelUp.getByRole("button", { name: "Close: save your level" }).click();

    await expect(alice.page.getByText("Level up! You reached level 2")).toHaveCount(0);
    await expect(alice.page.getByRole("button", { name: "New opponent" })).toBeVisible();
  });
});

test.describe("a guest whose streak is at risk", () => {
  /**
   * The shared test server's clock can't move for one test, so the guest's stats are written as the server leaves
   * them after three days in a row of play ending yesterday (UTC) — the only state that makes a streak "at risk".
   */
  async function playedThreeDaysUntilYesterday(page) {
    const { identity } = await readApi(page, "/api/session");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const db = await mongoose.createConnection(E2E_MONGO_URI).asPromise();
    try {
      // Replace or create: looking at quests or streaks may already have stored the guest's empty stats.
      await db.collection("player_stats").replaceOne(
        { playerId: identity.id },
        {
          playerId: identity.id,
          winsByGame: {},
          matchesByGame: {},
          checkmateWins: 0,
          questsCompleted: 0,
          winStreak: { current: 0, best: 1 },
          dailyStreak: { current: 3, best: 3, lastDay: yesterday },
          recentKeys: [],
          mergedFrom: [],
          updatedAt: new Date(),
          version: 1,
        },
        { upsert: true },
      );
    } finally {
      await db.close();
    }
  }

  const LINE = "Play today to keep your 3-day streak — sign up so it's never lost";

  test("sees one line on the home quest card and in the player console, and can close it", async ({
    players,
  }) => {
    const guest = await players.open("guest");
    await startAsGuest(guest);
    await playedThreeDaysUntilYesterday(guest.page);

    await guest.page.reload();

    const quests = guest.page.getByRole("region", { name: "Daily quests" });
    await expect(quests.getByText(LINE)).toBeVisible();
    await expect(quests.getByRole("link", { name: "sign up so it's never lost" })).toHaveAttribute(
      "href",
      "/signup",
    );
    await expect(await headerSignup(guest.page)).toHaveText("Sign up"); // a streak, but no XP yet

    await quests.getByRole("link", { name: "Open your player console" }).click();
    await expect(guest.page).toHaveURL("/profile");
    const panel = guest.page.getByRole("region", { name: "Player console" });
    await expect(panel.getByText(LINE)).toBeVisible();
    await expect(panel.getByRole("link", { name: "sign up so it's never lost" })).toHaveAttribute(
      "href",
      "/signup?next=%2Fprofile",
    );
    await expect(panel.getByRole("link", { name: /Sign up to keep/ })).toHaveCount(0); // one sign-up line, not two

    await panel.getByRole("button", { name: "Close: streak reminder" }).click();

    await expect(guest.page.getByText(LINE)).toHaveCount(0);
    await expect(
      panel.getByRole("link", { name: "Sign up to keep your streak and achievements" }),
    ).toBeVisible();
    await guest.page.goBack();
    await expect(guest.page).toHaveURL("/");
    await expect(guest.page.getByRole("region", { name: "Daily quests" })).toBeVisible();
    await expect(guest.page.getByText(LINE)).toHaveCount(0);
    await guest.page.reload();
    await expect(guest.page.getByText(LINE)).toBeVisible();
  });
});

test.describe("never shown to", () => {
  test("an account holder: no card after a win, no 'Save it', no streak line, no sign-up in the header", async ({
    players,
  }) => {
    const account = newAccount();
    const alice = await players.open("alice", { secrets: [account.email, account.password] });
    const bob = await players.open("bob");
    await alice.page.goto("/signup");
    await fillSignup(alice.page, account);
    await expect(alice.page).toHaveURL("/");

    await aliceBeatsBob(alice, bob);
    await expect(card(alice.page)).toHaveCount(0);
    const levelUp = toast(alice.page, "Level up! You reached level 2");
    if (
      !(await levelUp.waitFor({ state: "attached", timeout: 5_000 }).then(
        () => true,
        () => false,
      ))
    ) {
      await aliceBeatsBob(alice, bob); // 60 XP and more: past level 2
      await expect(levelUp).toBeAttached();
    }

    await expect(levelUp.getByRole("link")).toHaveCount(0);
    await expect(levelUp.getByRole("button")).toHaveCount(0);
    await expect(card(alice.page)).toHaveCount(0);
    await expect(await headerSignup(alice.page)).toHaveCount(0);
    await alice.page.goto("/");
    await expect(alice.page.getByRole("region", { name: "Daily quests" })).toBeVisible();
    await expect(alice.page.getByText(/sign up so it's never lost/)).toHaveCount(0);
    // Bob, the guest who lost, isn't offered the card either: it follows a win.
    await expect(bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(card(bob.page)).toHaveCount(0);
    await expect(await headerSignup(bob.page)).toHaveText("Save progress");
  });

  test("a visitor without a session: a plain 'Sign up', and no progress is even asked for", async ({
    players,
  }) => {
    const visitor = await players.open("visitor");

    await visitor.page.goto("/");
    await expect(await headerSignup(visitor.page)).toHaveText("Sign up");
    await visitor.page.goto("/profile");
    await expect(visitor.page.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await visitor.page.goto("/games/tic-tac-toe/rooms/AB2CD3");
    await expect(visitor.page.getByRole("button", { name: "Play as guest" })).toBeVisible();

    await expect(card(visitor.page)).toHaveCount(0);
    await expect(visitor.page.getByText(/sign up so it's never lost|Save progress/)).toHaveCount(0);
    const asked = visitor.record.urls.filter((url) =>
      /\/api\/(progress|streaks)/.test(new URL(url).pathname),
    );
    expect(asked).toEqual([]);
  });
});
