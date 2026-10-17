import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// Browser history on every screen (CC-084): links forward, Back, Forward, long Back/Forward chains, reload, and
// Back after every redirect and every action that changes who you are or where you sit. At each step: the URL,
// the tab title and what is on screen agree.

/** What a screen looks like: its URL, its title and a heading that proves it rendered. */
const at = async (page, url, title, heading) => {
  await expect(page).toHaveURL(url);
  await expect(page).toHaveTitle(title);
  if (heading) await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
};
const HOME = ["/", "ClassiCade", "Play the classics with anyone, in one click."];
const CHESS = ["/games/chess", "Chess · ClassiCade", "Chess"];
const TTT = ["/games/tic-tac-toe", "Tic Tac Toe · ClassiCade", "Tic Tac Toe"];
const RPS = ["/games/rock-paper-scissors", "Rock Paper Scissors · ClassiCade", "Rock Paper Scissors"];

test.describe("history: browsing", () => {
  test("home → game → Back → Forward → another game → Back, Back → Forward, Forward", async ({ players }) => {
    const { page } = await players.open("visitor");
    await page.goto("/");
    await at(page, ...HOME);

    await page.getByRole("link", { name: "Chess" }).click();
    await at(page, ...CHESS);
    await page.goBack();
    await at(page, ...HOME);
    await page.goForward();
    await at(page, ...CHESS);

    await page.getByRole("link", { name: "Games" }).click();
    await at(page, ...HOME);
    await page.getByRole("link", { name: "Tic Tac Toe" }).click();
    await at(page, ...TTT);

    await page.goBack();
    await at(page, ...HOME);
    await page.goBack();
    await at(page, ...CHESS);
    await page.goForward();
    await at(page, ...HOME);
    await page.goForward();
    await at(page, ...TTT);
  });

  test("every screen survives a reload as the same screen", async ({ players }) => {
    const host = await players.open("host");
    host.expect(404, "/no/such/page"); // a real 404 from the server, with the app (CC-047)
    const room = await createRoom(host, "tic-tac-toe");
    const screens = [
      HOME,
      CHESS,
      TTT,
      RPS,
      ["/login", "Log in · ClassiCade", "Log in"],
      ["/signup", "Sign up · ClassiCade", "Create your account"],
      ["/profile", /^Guest-\w+ · ClassiCade$/], // a guest's profile is titled with their name
      ["/no/such/page", "Page not found · ClassiCade", "Page not found"],
    ];
    for (const [url, title] of screens) {
      await host.page.goto(url);
      await host.page.reload();
      await at(host.page, url, title);
    }
    await host.page.goto(room.path);
    await host.page.reload();
    await at(host.page, room.path, `Tic Tac Toe · Room ${room.code} · ClassiCade`, "Invite a friend");
  });

  test("a redirect is never a step in history: Back skips it", async ({ players }) => {
    const { page } = await players.open("visitor");
    await page.goto("/");
    await page.goto("/play/chess");
    await at(page, ...CHESS);
    await page.goto("/games/tictactoe");
    await at(page, ...TTT);

    await page.goBack();
    await at(page, ...CHESS);
    await page.goBack();
    await at(page, ...HOME);
    await page.goForward();
    await page.goForward();
    await at(page, ...TTT);
  });

  test("not found → Back to the games", async ({ players }) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;
    visitor.expect(404, "/games/ludo");
    await page.goto("/games/ludo");
    await at(page, "/games/ludo", "Page not found · ClassiCade", "Page not found");

    await page.getByRole("link", { name: "Back to the games" }).click();
    await at(page, ...HOME);
    await page.goBack();
    await at(page, "/games/ludo", "Page not found · ClassiCade", "Page not found");
  });
});

test.describe("history: rooms", () => {
  test("create a room → Back to the lobby → Forward into the same room → reload", async ({ players }) => {
    const host = await players.open("host");
    await host.page.goto("/games/chess");
    await host.page.getByRole("button", { name: "Create room" }).click();
    await expect(host.page.getByRole("heading", { name: "Invite a friend" })).toBeVisible();
    const roomUrl = host.url();
    expect(roomUrl).toMatch(/^\/games\/chess\/rooms\/[A-Z0-9]{6}$/);

    await host.page.goBack();
    await at(host.page, ...CHESS);
    await host.page.goForward();
    await expect(host.page).toHaveURL(roomUrl);
    await expect(host.page.getByRole("heading", { name: "Invite a friend" })).toBeVisible();
    await host.page.reload();
    await expect(host.page.getByRole("heading", { name: "Invite a friend" })).toBeVisible();
    // Still one seat: going back and forth never seated the host twice.
    await expect(host.page.getByRole("list", { name: "Players" }).getByRole("listitem")).toHaveCount(2); // host + "waiting"
  });

  test("join by code → Back → Forward, and the friend still plays the same game", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const friend = await players.open("friend");
    await friend.page.goto("/games/tic-tac-toe");
    await friend.page.getByRole("textbox", { name: "Room code" }).fill(room.code.toLowerCase());
    await friend.page.getByRole("button", { name: "Join room" }).click();
    await expect(friend.page).toHaveURL(room.path);
    await friend.page.getByRole("button", { name: "Play as guest" }).click();
    await expect(friend.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();

    await friend.page.goBack();
    await at(friend.page, ...TTT);
    await friend.page.goForward();
    await expect(friend.page).toHaveURL(room.path);
    await expect(friend.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
    await expect(host.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
  });

  test("leaving a waiting room: Back does not put you back in it", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "rock-paper-scissors");

    await host.page.getByRole("button", { name: "Leave room" }).click();
    await at(host.page, ...RPS);
    await host.page.goBack();

    // The page before the room, never the room you just left (it closed when you left it alone).
    await expect(host.page).not.toHaveURL(room.path);
  });

  test("forfeiting: Back shows the finished game, never a new seat in it", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const friend = await players.open("friend");
    await joinAsGuest(friend, room.path);
    await expect(friend.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();

    await friend.page.getByRole("button", { name: "Leave room" }).click();
    await friend.page.getByRole("button", { name: "Leave and forfeit" }).click();
    await at(friend.page, ...TTT);
    await expect(host.page.getByRole("heading", { name: /^You won/ })).toBeVisible();

    await friend.page.goBack();
    await expect(friend.page).not.toHaveURL(room.path);
  });

  test("finished game → New opponent → the lobby, and Back never re-enters the room (CC-162)", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    await alice.page.goto("/games/rock-paper-scissors");
    await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await alice.page.getByRole("button", { name: "Create room" }).click();
    const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    const roomUrl = alice.url();
    const bob = await players.open("bob");
    await joinAsGuest(bob, invite);
    await alice.page
      .getByRole("group", { name: "Your choice" })
      .getByRole("button", { name: /Paper/ })
      .click();
    await bob.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /Rock/ }).click();
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();

    await alice.page.getByRole("button", { name: "New opponent" }).click();
    await at(alice.page, ...RPS);
    await alice.page.goBack();
    await expect(alice.page).not.toHaveURL(roomUrl);
    await alice.page.goForward();
    await at(alice.page, ...RPS);
  });
});

test.describe("history: signing in and out", () => {
  test("log in from a lobby → back in the lobby → Back never shows the login form again", async ({
    players,
  }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    const { page } = riya;
    await page.goto("/signup");
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await at(page, ...HOME);
    await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();

    await page.goto("/games/chess");
    await page.getByRole("banner").getByRole("link", { name: "Log in" }).click();
    await at(page, "/login?next=%2Fgames%2Fchess", "Log in · ClassiCade", "Log in");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await at(page, ...CHESS);

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Log in", exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Log in", exact: true })).toHaveCount(0);
    await page.goForward();
    await page.goForward();
    await at(page, ...CHESS);
    await expect(page.getByRole("banner")).toContainText(account.username);
  });

  test("switching between log in and sign up keeps where you were going, through Back and Forward", async ({
    players,
  }) => {
    const { page } = await players.open("visitor");
    await page.goto("/games/tic-tac-toe");
    await page.getByRole("banner").getByRole("link", { name: "Sign up" }).click();
    await at(page, "/signup?next=%2Fgames%2Ftic-tac-toe", "Sign up · ClassiCade", "Create your account");
    await page.getByRole("link", { name: "Log in", exact: true }).last().click();
    await at(page, "/login?next=%2Fgames%2Ftic-tac-toe", "Log in · ClassiCade", "Log in");
    await page.getByRole("link", { name: "Create an account" }).click();
    await at(page, "/signup?next=%2Fgames%2Ftic-tac-toe", "Sign up · ClassiCade", "Create your account");

    await page.goBack();
    await at(page, "/login?next=%2Fgames%2Ftic-tac-toe", "Log in · ClassiCade", "Log in");
    await page.goBack();
    await at(page, "/signup?next=%2Fgames%2Ftic-tac-toe", "Sign up · ClassiCade", "Create your account");
    await page.goBack();
    await at(page, ...TTT);
    await page.goForward();
    await page.goForward();
    await at(page, "/login?next=%2Fgames%2Ftic-tac-toe", "Log in · ClassiCade", "Log in");
  });

  test("log out on the profile → Back shows a signed-out profile, never the previous account's data", async ({
    players,
  }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    const { page } = riya;
    await page.goto("/signup?next=%2Fprofile");
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await at(page, "/profile", `${account.username} · ClassiCade`, account.username);

    await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
    await at(page, ...HOME);
    await page.goBack();

    await at(page, "/profile", "Your profile · ClassiCade", "Your profile");
    await expect(page.getByText(account.username)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "log in", exact: true })).toBeVisible();
    await page.goForward();
    await at(page, ...HOME);
  });

  test("a guest who signs up from a room: Back and Forward keep them in their room as the account", async ({
    players,
  }) => {
    const account = newAccount();
    const alice = await players.open("alice", { secrets: [account.email, account.password] });
    const room = await createRoom(alice, "chess");
    await alice.page.getByRole("banner").getByRole("link", { name: "Sign up" }).click();
    await alice.page.getByLabel("Username").fill(account.username);
    await alice.page.getByLabel("Email").fill(account.email);
    await alice.page.getByLabel("Password").fill(account.password);
    await alice.page.getByRole("button", { name: "Create account" }).click();
    await expect(alice.page).toHaveURL(room.path);

    await alice.page.goBack();
    await alice.page.goForward();
    await expect(alice.page).toHaveURL(room.path);
    const seats = alice.page.getByRole("list", { name: "Players" });
    await expect(seats).toContainText(account.username);
    await expect(seats).not.toContainText("Guest-");
  });
});
