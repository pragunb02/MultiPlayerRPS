import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";

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

  test("opens a friend's invite link, chooses to play as a guest and is seated, at the room's canonical URL", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const visitor = await players.open("visitor");

    await joinAsGuest(visitor, room.path);

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
    ]) {
      await visitor.page.goto(from);
      await expect(visitor.page, `${from} → ${to}`).toHaveURL(to);
    }
    // An old room link names no game: the room's URL is known once joined.
    await joinAsGuest(visitor, `/room/${room.code.toLowerCase()}`);
    await expect(visitor.page).toHaveURL(room.path);
    // Redirects replace history: Back leaves the redirect instead of bouncing on it.
    await visitor.page.goBack();
    await expect(visitor.page).toHaveURL("/games/rock-paper-scissors");
  });

  test("an unknown page says so", async ({ players }) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;
    // The server answers 404 (CC-047), with the app, which shows its own page for it.
    visitor.expect(404, "/no/such/page");

    await page.goto("/no/such/page");

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · ClassiCade");
    await page.getByRole("link", { name: "Back to the games" }).click();
    await expect(page).toHaveURL("/");
  });

  test("is offered log in from the profile page and returns there", async ({ players }) => {
    const { page } = await players.open("visitor");

    await page.goto("/profile");
    await page.getByRole("main").getByRole("link", { name: "Log in", exact: true }).click();

    await expect(page).toHaveURL("/login?next=%2Fprofile");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL("/signup?next=%2Fprofile");
  });

  test("reads the privacy policy and the terms from the footer, and goes back and forward through them", async ({
    players,
  }) => {
    const { page } = await players.open("visitor");
    const legal = page.getByRole("contentinfo").getByRole("navigation", { name: "Legal" });

    await page.goto("/games/chess");
    await expect(page.getByRole("contentinfo")).toContainText("One cookie keeps you signed in.");
    await legal.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL("/privacy");
    await expect(page).toHaveTitle("Privacy policy · ClassiCade");
    await expect(page.getByRole("note")).toContainText("Draft.");
    await legal.getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL("/terms");
    await expect(page).toHaveTitle("Terms of use · ClassiCade");
    await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL("/games/chess");
    await expect(page).toHaveTitle("Chess · ClassiCade");
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL("/terms");
    await expect(page).toHaveTitle("Terms of use · ClassiCade");

    // Reading them starts no session and stores nothing.
    expect((await page.context().cookies()).map((cookie) => cookie.name)).not.toContain("cc.sid");
  });

  test("arrives straight at a legal page by link, with that page's own head", async ({ players }) => {
    const { page } = await players.open("visitor");

    await page.goto("/terms");

    await expect(page).toHaveTitle("Terms of use · ClassiCade");
    // The tags the server wrote for crawlers are replaced by the app's own: one description, one canonical.
    await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", /\/terms$/);
    await page.getByRole("link", { name: "privacy policy" }).click();
    await expect(page).toHaveURL("/privacy");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", /\/privacy$/);
    await expect(page.locator('head meta[property="og:title"]')).toHaveCount(0);
  });
});
