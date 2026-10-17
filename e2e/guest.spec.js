import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";

// Two guests playing: what each one can see, and where every button leads.
test.describe("guest players", () => {
  test("a guest with three rooms waiting is asked to close one before opening a fourth (CC-107)", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const first = await createRoom(alice, "tic-tac-toe");
    await createRoom(alice, "tic-tac-toe");
    await createRoom(alice, "rock-paper-scissors");

    await alice.page.goto("/games/chess");
    await alice.page.getByRole("button", { name: "Create room" }).click();
    await expect(alice.page.getByRole("alert")).toHaveText(
      "You already have 3 rooms waiting; close one first",
    );
    await expect(alice.page).toHaveURL("/games/chess");

    await alice.page.goto(first.path);
    await alice.page.getByRole("button", { name: "Leave room" }).click();
    await alice.page.goto("/games/chess");
    await alice.page.getByRole("button", { name: "Create room" }).click();
    await expect(alice.page.getByRole("heading", { name: "Invite a friend" })).toBeVisible();
  });

  test("play Rock Paper Scissors without seeing the other's choice before the reveal", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    await alice.page.goto("/games/rock-paper-scissors");
    await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await alice.page.getByRole("button", { name: "Create room" }).click();
    const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    const bob = await players.open("bob");
    await joinAsGuest(bob, invite);
    const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
    await expect(choices(alice)).toBeVisible();
    await expect(choices(bob)).toBeVisible();

    await choices(alice).getByRole("button", { name: /Rock/ }).click();
    await expect(bob.page.getByText(/has chosen/)).toBeVisible();

    // Bob's browser was told that Alice chose — never what: no round result on screen, nothing on the wire.
    await expect(bob.page.getByRole("list", { name: "Rounds" })).toHaveCount(0);
    expect(bob.record.socketFrames.join("\n")).not.toMatch(/"rock"/);

    await choices(bob)
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expect(bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();

    await bob.page.getByRole("button", { name: "New opponent" }).click();
    await expect(bob.page).toHaveURL("/games/rock-paper-scissors");
  });

  test("leaving a game in progress asks first, then forfeits and returns to the lobby", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const room = await createRoom(alice, "tic-tac-toe");
    const bob = await players.open("bob");
    await joinAsGuest(bob, room.path);
    await expect(bob.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();

    await bob.page.getByRole("button", { name: "Leave room" }).click();
    await bob.page.getByRole("button", { name: "Stay" }).click();
    expect(bob.url()).toBe(room.path);
    await bob.page.getByRole("button", { name: "Leave room" }).click();
    await bob.page.getByRole("button", { name: "Leave and forfeit" }).click();

    await expect(bob.page).toHaveURL("/games/tic-tac-toe");
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  });

  test("a guest who signs up from a room comes back to that room as the new user", async ({ players }) => {
    const alice = await players.open("alice");
    const room = await createRoom(alice, "chess");
    const account = { username: `g_${Date.now().toString(36)}`, email: `g.${Date.now()}@example.com` };
    const password = "a guest becomes a user";
    alice.secrets.push(account.email, password);

    await alice.page.getByRole("banner").getByRole("link", { name: "Sign up" }).click();
    await expect(alice.page).toHaveURL(`/signup?next=${encodeURIComponent(room.path)}`);
    await alice.page.getByLabel("Username").fill(account.username);
    await alice.page.getByLabel("Email").fill(account.email);
    await alice.page.getByLabel("Password").fill(password);
    await alice.page.getByRole("button", { name: "Create account" }).click();

    await expect(alice.page).toHaveURL(room.path);
    await expect(alice.page.getByRole("banner")).toContainText(account.username);
    // Her seat came with her (CC-083): she still hosts the room, alone, waiting for her friend.
    const seats = alice.page.getByRole("list", { name: "Players" });
    await expect(seats).toContainText(account.username);
    await expect(seats).not.toContainText("Guest-");
    await expect(alice.page.getByRole("heading", { name: "Invite a friend" })).toBeVisible();

    const friend = await players.open("friend");
    await joinAsGuest(friend, room.path);
    await expect(friend.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
    await expect(friend.page.getByRole("list", { name: "Players" })).toContainText(account.username);
    await expect(alice.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
  });
});
