import { expect, test } from "./fixtures.js";
import { BASE_URL, newAccount } from "./personas.js";

// Someone trying to misuse links, inputs and the API. Each attempt must fail quietly and safely.
test.describe("attacker", () => {
  test("crafted `next` links never leave the site after logging in", async ({ players }) => {
    const account = newAccount();
    const victim = await players.open("victim", { secrets: [account.email, account.password] });
    const { page } = victim;
    page.on("dialog", (dialog) => {
      throw new Error(`a script ran: ${dialog.message()}`);
    });
    await page.goto("/signup");
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/");
    await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toBeVisible();

    for (const next of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel("Email").fill(account.email);
      await page.getByLabel("Password").fill(account.password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page, `next=${next}`).toHaveURL(`${BASE_URL}/`);
      await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
      await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toBeVisible();
    }
  });

  test("markup in a URL is shown as text, never run", async ({ players }) => {
    const prober = await players.open("prober");
    const { page } = prober;
    let ran = false;
    page.on("dialog", async (dialog) => {
      ran = true;
      await dialog.dismiss();
    });

    const path = `/games/chess/rooms/${encodeURIComponent("<img src=x onerror=alert(1)>")}`;
    // No room can have that code, so the server answers 404 (CC-047). The app still opens and explains.
    prober.expect(404, new URL(path, "http://localhost").pathname);
    await page.goto(path);

    await expect(page.getByText("<IMG SRC=X ONERROR=ALERT(1)>")).toBeVisible(); // the invite shows the code as text
    await page.getByRole("button", { name: "Play as guest" }).click();
    await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
    expect(ran).toBe(false);
  });

  test("the API refuses cross-site writes and never shows internals", async ({ request }) => {
    const crossSite = await request.post("/api/session/guest", {
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      data: {},
    });
    expect(crossSite.status()).toBe(403);

    for (const response of [
      await request.get("/api/nope"),
      await request.post("/api/auth/login", { headers: { "Content-Type": "text/plain" }, data: "x" }),
      await request.post("/api/auth/login", {
        headers: { "Content-Type": "application/json" },
        data: "{bad",
      }),
      await request.get("/api/matches/..%2F..%2Fetc%2Fpasswd"),
    ]) {
      const body = await response.text();
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      expect(body, "no stack traces or file paths").not.toMatch(/\bat \S+ \(|node_modules|\/src\/|Error:/);
    }
  });

  test("security headers are on every page", async ({ request }) => {
    const response = await request.get("/games/chess", { headers: { Accept: "text/html" } });
    const headers = response.headers();

    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
