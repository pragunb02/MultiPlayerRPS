import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.js";
import { OWNER, SEEDED_TOTALS, SEEDED_WEEK } from "./ownerConsole.js";
import { BASE_URL, newAccount } from "./personas.js";

// The owner console (CC-233): the site's owner sees totals of the seeded week, and nobody else can tell that a
// console exists. The owner and the week are seeded by server.mjs (ownerConsole.js).

const WEEK = `from=${SEEDED_WEEK.from}&to=${SEEDED_WEEK.to}&bucket=day`;
const LABELS = Object.freeze({
  activePlayers: "Active players",
  matches: "Matches finished",
  newPlayers: "New players",
  weeklyReturning: "Weekly returning players",
  matchesPerPlayer: "Matches per player",
  guestsConverted: "Guests who saved progress",
  conversionRate: "Guest to account",
});

async function logIn(player, { email, password }) {
  await player.page.goto("/login");
  await player.page.getByLabel("Email").fill(email);
  await player.page.getByLabel("Password").fill(password);
  await player.page.getByRole("button", { name: "Log in" }).click();
  await expect(player.page).toHaveURL("/");
}

const tile = (page, label) => page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=..");
const sections = (page) => page.getByRole("navigation", { name: "Console sections" });

async function at(page, path, tab) {
  await expect(page).toHaveURL(path);
  await expect(page).toHaveTitle(`${tab} · Owner console · ClassiCade`);
  await expect(sections(page).getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
}

test.describe("owner console", () => {
  test("the owner sees the seeded week's totals, walks the sections with Back and Forward, and exports CSV", async ({
    players,
  }) => {
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    const { page } = owner;
    await logIn(owner, OWNER);

    await page.getByRole("banner").getByRole("link", { name: "Console" }).click();
    await at(page, "/admin", "Overview");
    await page.goto(`/admin?${WEEK}`);
    await at(page, `/admin?${WEEK}`, "Overview");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    for (const [id, label] of Object.entries(LABELS)) {
      await expect(tile(page, label).locator("dd").first(), label).toHaveText(SEEDED_TOTALS[id]);
    }

    await sections(page).getByRole("link", { name: "Games" }).click();
    await at(page, `/admin/games?${WEEK}`, "Games");
    await expect(page.getByRole("img", { name: /^Matches finished, 7 bars/ })).toBeVisible();
    await sections(page).getByRole("link", { name: "Retention" }).click();
    await at(page, `/admin/retention?${WEEK}`, "Retention");
    await expect(page.getByRole("table", { name: "Cohort retention" }).getByRole("row").nth(1)).toContainText(
      "2025-03-03",
    );

    await page.goBack();
    await at(page, `/admin/games?${WEEK}`, "Games");
    await page.goBack();
    await at(page, `/admin?${WEEK}`, "Overview");
    await page.goForward();
    await page.goForward();
    await at(page, `/admin/retention?${WEEK}`, "Retention");
    await page.reload();
    await at(page, `/admin/retention?${WEEK}`, "Retention");

    await sections(page).getByRole("link", { name: "Players" }).click();
    await at(page, `/admin/players?${WEEK}`, "Players");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV: Active players" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("classicade-active-players-2025-03-03-to-2025-03-09.csv");
    const csv = await readFile(await download.path(), "utf8");
    expect(csv.split("\r\n").slice(0, 3)).toEqual([
      "Day,Players,Guests,Accounts",
      "2025-03-03,10,10,0",
      "2025-03-04,6,0,6",
    ]);
    expect(csv).not.toMatch(/guest_|user_|Player-/);
  });

  test("a new range from the form is a new address, and Back returns to the week before", async ({
    players,
  }) => {
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    const { page } = owner;
    await logIn(owner, OWNER);
    await page.goto(`/admin/players?${WEEK}`);
    await at(page, `/admin/players?${WEEK}`, "Players");

    await page.getByLabel("Group by").selectOption("week");
    await page.getByRole("button", { name: "Show" }).click();

    await at(page, `/admin/players?from=${SEEDED_WEEK.from}&to=${SEEDED_WEEK.to}&bucket=week`, "Players");
    await expect(page.getByRole("img", { name: /^Active players, 1 bars from 2025-03-03/ })).toBeVisible();
    await page.goBack();
    await at(page, `/admin/players?${WEEK}`, "Players");
  });

  test("a range the server refuses keeps the form, so the owner can correct it", async ({ players }) => {
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    const { page } = owner;
    await logIn(owner, OWNER);
    owner.expect(400, "/api/admin/analytics");
    await page.goto(`/admin?from=2024-01-01&to=${SEEDED_WEEK.to}&bucket=week`);

    await expect(page.getByRole("alert")).toContainText("at most 400 days");
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await page.getByLabel("From").fill(SEEDED_WEEK.from);
    await page.getByRole("button", { name: "Show" }).click();

    await at(page, `/admin?from=${SEEDED_WEEK.from}&to=${SEEDED_WEEK.to}&bucket=week`, "Overview");
    await expect(tile(page, LABELS.activePlayers).locator("dd").first()).toHaveText(
      SEEDED_TOTALS.activePlayers,
    );
  });

  test("an account that is not the owner gets the ordinary not found page and a 404 from the API", async ({
    players,
  }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.password, account.email] });
    const { page } = riya;
    await page.goto("/signup");
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Console" })).toHaveCount(0);

    riya.expect(404, "/admin/players");
    await page.goto(`/admin/players?${WEEK}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · ClassiCade");
    expect((await page.request.get(`/api/admin/analytics?${WEEK}`)).status()).toBe(404);
    await expect(page.getByText(/console/i)).toHaveCount(0);
  });

  test("a guest and a visitor get the ordinary not found page", async ({ players }) => {
    const guest = await players.open("guest");
    await guest.page.goto("/");
    const started = await guest.page.request.post("/api/session/guest", { headers: { Origin: BASE_URL } });
    expect(started.status()).toBe(201);
    guest.expect(404, "/admin");
    await guest.page.goto("/admin");
    await expect(guest.page.getByRole("heading", { name: "Page not found" })).toBeVisible();

    const visitor = await players.open("visitor");
    visitor.expect(404, "/admin");
    await visitor.page.goto("/admin");
    await expect(visitor.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect((await visitor.page.request.get("/api/admin/analytics")).status()).toBe(404);
    expect(await visitor.context.cookies()).toEqual([]);
  });
});
