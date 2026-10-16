import { createRoom, expect, test } from "./fixtures.js";

// Someone arriving for the first time, without a session.
test.describe("first-time visitor", () => {
  test("browses without getting a session, with one URL and title per screen", async ({ players }) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;

    await page.goto("/");
    await expect(page).toHaveTitle("ClassiCade");
    await expect(page.getByRole("button", { name: "Play as a guest" })).toBeVisible();

    await page.getByRole("link", { name: "Chess" }).click();
    await expect(page).toHaveURL("/games/chess");
    await expect(page).toHaveTitle("Chess · ClassiCade");
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Games" }),
    ).toHaveAttribute("aria-current", "page");

    await page.goBack();
    await expect(page).toHaveURL("/");
    // Looking around creates nothing on the server: no session until they choose to play.
    expect((await visitor.context.cookies()).map((c) => c.name)).not.toContain("cc.sid");
  });

  test("opens a friend's invite link and is seated as a guest, at the room's canonical URL", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const visitor = await players.open("visitor");

    await visitor.page.goto(room.path);

    await expect(visitor.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
    await expect(host.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
    expect(visitor.url()).toBe(room.path);
    await expect(visitor.page).toHaveTitle(`Tic Tac Toe · Room ${room.code} · ClassiCade`);
    await expect(visitor.page.getByRole("banner")).toContainText(/Guest-/);
  });

  test("old and mistyped links still arrive", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "rock-paper-scissors");
    const visitor = await players.open("visitor");

    for (const [from, to] of [
      ["/play/chess", "/games/chess"],
      ["/games/tictactoe", "/games/tic-tac-toe"],
      ["/games/rockpaperscissors", "/games/rock-paper-scissors"],
      [`/room/${room.code.toLowerCase()}`, room.path],
    ]) {
      await visitor.page.goto(from);
      await expect(visitor.page, `${from} → ${to}`).toHaveURL(to);
    }
    // Redirects replace history: Back leaves the redirect instead of bouncing on it.
    await visitor.page.goBack();
    await expect(visitor.page).toHaveURL("/games/rock-paper-scissors");
  });

  test("an unknown page says so", async ({ players }) => {
    const { page } = await players.open("visitor");

    await page.goto("/no/such/page");

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · ClassiCade");
    await page.getByRole("link", { name: "Back to the games" }).click();
    await expect(page).toHaveURL("/");
  });

  test("is offered log in from the profile page and returns there", async ({ players }) => {
    const { page } = await players.open("visitor");

    await page.goto("/profile");
    await page.getByRole("link", { name: "log in", exact: true }).click();

    await expect(page).toHaveURL("/login?next=%2Fprofile");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL("/signup?next=%2Fprofile");
  });
});
