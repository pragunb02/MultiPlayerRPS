import { createRoom, expect, header, joinAsGuest, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// Every state of every screen a person can reach (CC-084), with what they can do from there.

async function signUp(player, account, from = "/signup") {
  await player.page.goto(from);
  await player.page.getByLabel("Username").fill(account.username);
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  await player.page.getByRole("button", { name: "Create account" }).click();
}

test.describe("home", () => {
  test("a visitor starts playing as a guest in one click; the page remembers it on reload", async ({
    players,
  }) => {
    const { page } = await players.open("visitor");
    await page.goto("/");

    await page.getByRole("button", { name: "Play as a guest" }).click();

    await expect(page.getByText(/You're playing as Guest-/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Play as a guest" })).toHaveCount(0);
    await expect((await header(page)).getByRole("link", { name: "Profile" })).toBeVisible();
    await page.reload();
    await expect(page.getByText(/You're playing as Guest-/)).toBeVisible();
  });

  test("lists every game with a link to its lobby", async ({ players }) => {
    const { page } = await players.open("visitor");
    await page.goto("/");

    for (const [name, url] of [
      ["Rock Paper Scissors", "/games/rock-paper-scissors"],
      ["Tic Tac Toe", "/games/tic-tac-toe"],
      ["Chess", "/games/chess"],
    ]) {
      await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("href", url);
    }
  });
});

test.describe("game lobby", () => {
  test("Join is only possible with a full room code", async ({ players }) => {
    const { page } = await players.open("visitor");
    await page.goto("/games/chess");
    const join = page.getByRole("button", { name: "Join room" });
    const code = page.getByRole("textbox", { name: "Room code" });

    await expect(join).toBeDisabled();
    await code.fill("AB2C");
    await expect(join).toBeDisabled();
    await code.fill("AB2CD3");
    await expect(join).toBeEnabled();
    await code.fill("AB2CD3XYZ");
    await expect(code).toHaveValue("AB2CD3"); // the field stops at the code length
  });

  test("a code for a room that doesn't exist says so, with a way back", async ({ players }) => {
    const { page } = await players.open("visitor");
    await page.goto("/games/chess");
    await page.getByRole("textbox", { name: "Room code" }).fill("ZZZZZZ");
    await page.getByRole("button", { name: "Join room" }).click();

    await expect(page).toHaveURL("/games/chess/rooms/ZZZZZZ");
    await page.getByRole("button", { name: "Play as guest" }).click(); // no session yet: choose how to join
    await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
    await expect(page).toHaveTitle("Room not found · ClassiCade");
    await page.getByRole("link", { name: "Back to the games" }).click();
    await expect(page).toHaveURL("/");
  });

  test("each game offers its own options", async ({ players }) => {
    const { page } = await players.open("visitor");

    await page.goto("/games/rock-paper-scissors");
    await expect(page.getByRole("combobox", { name: /match length/i })).toHaveValue("3");
    await page.goto("/games/chess");
    await expect(page.getByRole("combobox", { name: /time control/i })).toBeVisible();
    await page.goto("/games/tic-tac-toe");
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });
});

test.describe("room", () => {
  test("someone opening a game that already started is told so, and can start their own", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const friend = await players.open("friend");
    await joinAsGuest(friend, room.path);
    await expect(friend.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
    const latecomer = await players.open("latecomer");

    await joinAsGuest(latecomer, room.path);

    await expect(latecomer.page.getByRole("heading", { name: "Can't join this room" })).toBeVisible();
    await expect(latecomer.page.getByText("This game has already started")).toBeVisible();
    await latecomer.page.getByRole("link", { name: "Start a new Tic Tac Toe game" }).click();
    await expect(latecomer.page).toHaveURL("/games/tic-tac-toe");
  });

  test("a room everyone left is gone for the next person with the link, who is told why", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "chess");
    await host.page.getByRole("button", { name: "Leave room" }).click();
    await expect(host.page).toHaveURL("/games/chess");
    const late = await players.open("late friend");

    await joinAsGuest(late, room.path);

    // The room existed, so the link is not called wrong: it says why the room is gone (CC-101).
    await expect(late.page.getByRole("heading", { name: "Room closed" })).toBeVisible();
    await expect(late.page.getByText("Everyone left, so the room closed.")).toBeVisible();
    await late.page.getByRole("link", { name: "Start a new Chess game" }).click();
    await expect(late.page).toHaveURL("/games/chess");
  });

  test("the opponent's name, connection and turn are shown to both players", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    await expect(host.page.getByRole("list", { name: "Players" })).toContainText("Waiting for a player");
    const friend = await players.open("friend");
    await joinAsGuest(friend, room.path);

    for (const player of [host, friend]) {
      await expect(player.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
      await expect(player.page.getByRole("list", { name: "Players" }).getByRole("listitem")).toHaveCount(2);
    }
    const turns = await Promise.all(
      [host, friend].map((player) => player.page.getByText("Your turn", { exact: true }).count()),
    );
    expect(turns.sort()).toEqual([0, 1]); // exactly one of them is on turn

    await friend.leave();
    await expect(host.page.getByRole("list", { name: "Players" })).toContainText(/reconnecting \d:\d\d/);
  });

  test("logging out inside a waiting room gives the seat up: Back doesn't seat anyone in it (CC-085, CC-086)", async ({
    players,
  }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    await signUp(riya, account);
    await expect(riya.page).toHaveURL("/");
    const room = await createRoom(riya, "chess");
    // The name, its tags and "connected" wrap on a phone, so the room is never wider than the screen (CC-275).
    // A wider page pushed the header's Menu button off a phone's screen.
    await expect(riya.page.getByRole("list", { name: "Players" })).toContainText("connected");
    expect(await riya.page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      riya.page.viewportSize().width,
    );

    await (await header(riya.page)).getByRole("button", { name: "Log out" }).click();
    await expect(riya.page).toHaveURL("/");
    await riya.page.goBack();

    await expect(riya.page).toHaveURL(room.path);
    // Signed out, the room link asks how to join — nobody is seated without choosing to.
    await expect(riya.page.getByRole("heading", { name: "You're invited to play Chess" })).toBeVisible();
    expect((await riya.context.cookies()).map((c) => c.name)).not.toContain("cc.sid");
    await riya.page.getByRole("button", { name: "Play as guest" }).click();
    // The room closed when its only player gave up the seat.
    await expect(riya.page.getByRole("heading", { name: "Room closed" })).toBeVisible();
    await expect(riya.page.getByText("Everyone left, so the room closed.")).toBeVisible();
    await expect(riya.page.getByRole("grid", { name: "Chess board" })).toHaveCount(0);
  });
});

test.describe("profile", () => {
  test("after a game, the match is in the player's history with the result", async ({ players }) => {
    const alice = await players.open("alice");
    await alice.page.goto("/games/rock-paper-scissors");
    await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await alice.page.getByRole("button", { name: "Create room" }).click();
    const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    const bob = await players.open("bob");
    await joinAsGuest(bob, invite);
    await alice.page
      .getByRole("group", { name: "Your choice" })
      .getByRole("button", { name: /Scissors/ })
      .click();
    await bob.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /Paper/ }).click();
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();

    await (await header(alice.page)).getByRole("link", { name: "Profile" }).click();

    await expect(alice.page).toHaveURL("/profile");
    const history = alice.page.getByRole("list", { name: "Match history" });
    await expect(history.getByRole("listitem")).toHaveCount(1);
    await expect(history).toContainText("Rock Paper Scissors");
    await expect(history).toContainText("Won");
    await expect(alice.page.getByRole("progressbar", { name: "Progress to next level" })).toBeVisible();
  });

  test("a guest is invited to keep their name with an account; an account holder is not", async ({
    players,
  }) => {
    const guest = await players.open("guest");
    await guest.page.goto("/");
    await guest.page.getByRole("button", { name: "Play as a guest" }).click();
    // The guest session must exist before the next page load, or the profile asks to log in instead.
    await expect((await header(guest.page)).getByText(/^Guest-/)).toBeVisible();
    await guest.page.goto("/profile");
    await expect(guest.page.getByText("You're playing as a guest.")).toBeVisible();
    await guest.page.getByRole("link", { name: "Create an account" }).click();
    await expect(guest.page).toHaveURL("/signup?next=%2Fprofile");

    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    await signUp(riya, account, "/signup?next=%2Fprofile");
    await expect(riya.page).toHaveURL("/profile");
    await expect(riya.page.getByText("You're playing as a guest.")).toHaveCount(0);
    await expect(riya.page.getByText("No games yet.")).toBeVisible();
  });
});

test.describe("account forms", () => {
  test("sign-up checks each field as you leave it, and submits with Enter", async ({ players }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password, "short"] });
    const { page } = riya;
    await page.goto("/signup");

    await page.getByLabel("Username").fill("a");
    await page.getByLabel("Email").focus();
    await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").focus();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Password").fill("short");
    await page.getByLabel("Password").press("Enter");
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL("/signup"); // nothing was sent

    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByLabel("Password").press("Enter");
    await expect(page).toHaveURL("/");
  });
});
