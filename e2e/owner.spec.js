import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.js";
import { OWNER, SEEDED_TOTALS, SEEDED_WEEK, STATUS_TOTALS, STATUS_WEEK } from "./ownerConsole.js";
import { BASE_URL, newAccount } from "./personas.js";

// The owner console (CC-233): the site's owner sees totals of the seeded week, and nobody else can tell that a
// console exists. The owner and the week are seeded by server.mjs (ownerConsole.js).

const WEEK = `from=${SEEDED_WEEK.from}&to=${SEEDED_WEEK.to}&bucket=day`;
const LABELS = Object.freeze({
  northStar: "Regular and Core players",
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

  test("the owner sees the next week's player statuses, how players moved, and exports them as CSV", async ({
    players,
  }) => {
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    const { page } = owner;
    await logIn(owner, OWNER);
    const STATUS_RANGE = `from=${STATUS_WEEK.from}&to=${STATUS_WEEK.to}&bucket=week`;

    await page.goto(`/admin?${STATUS_RANGE}`);
    await at(page, `/admin?${STATUS_RANGE}`, "Overview");
    await expect(tile(page, LABELS.northStar).locator("dd").first()).toHaveText(STATUS_TOTALS.northStar);

    await sections(page).getByRole("link", { name: "Statuses" }).click();
    await at(page, `/admin/statuses?${STATUS_RANGE}`, "Statuses");
    await expect(
      page.getByRole("img", { name: /^Players by status on the last day of each week, 1 bars/ }),
    ).toBeVisible();
    const weeks = page.getByRole("table", { name: "Player statuses by week" });
    await page.getByText("Show as a table").click();
    await expect(weeks.getByRole("row").nth(1).getByRole("cell")).toHaveText(STATUS_TOTALS.weekRow.slice(1));
    const moves = page.getByRole("table", { name: "Moves between statuses" });
    const fromNew = moves.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "New" }) });
    await expect(fromNew.getByRole("cell").nth(2)).toHaveText(STATUS_TOTALS.newToRegular);
    await expect(fromNew.getByRole("cell").nth(3)).toHaveText(STATUS_TOTALS.newToCore);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV: Player statuses by week" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("classicade-player-statuses-2025-03-10-to-2025-03-16.csv");
    const csv = await readFile(await download.path(), "utf8");
    expect(csv.split("\r\n")[1]).toBe(STATUS_TOTALS.weekRow.join(","));
    expect(csv).not.toMatch(/guest_|user_|Player-/);

    await page.goBack();
    await at(page, `/admin?${STATUS_RANGE}`, "Overview");
    await page.goForward();
    await at(page, `/admin/statuses?${STATUS_RANGE}`, "Statuses");
    await page.reload();
    await at(page, `/admin/statuses?${STATUS_RANGE}`, "Statuses");
    await expect(fromNew.getByRole("cell").nth(3)).toHaveText(STATUS_TOTALS.newToCore);
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

  test("the design page shows every contract state to an admin and 404 to others", async ({ players }) => {
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    const { page } = owner;
    const scripts = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith("/assets/") && pathname.endsWith(".js")) scripts.push(pathname);
    });
    await logIn(owner, OWNER);
    expect(scripts.some((script) => script.includes("DesignPage"))).toBe(false);

    // The flag's rollout is one setting on the shared server. Both devices turn it on and neither turns it off, so
    // they never race, and no other test reads design_page.
    const on = await page.request.put("/api/admin/flags/design_page", {
      data: { rollout: "on" },
      headers: { Origin: BASE_URL },
    });
    expect(on.status()).toBe(200);

    const answer = await page.goto("/admin/design");
    expect(answer.headers()["cache-control"]).toBe("no-store");
    expect(answer.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await at(page, "/admin/design", "Design");
    await expect(page.getByRole("heading", { name: "Colour roles" })).toBeVisible();
    expect(scripts.some((script) => script.includes("DesignPage"))).toBe(true);
    await expect(page.getByText(/Shown in the light theme/)).toBeVisible();
    for (const role of ["success", "warning", "danger", "info", "you", "opponent"]) {
      await expect(page.locator(`[data-cc-role="${role}"]`)).toContainText(/\d+\.\d:1/);
    }
    await expect(page.locator("[data-cc-component]")).toHaveCount(7);
    await expect(page.getByText("Your turn", { exact: true })).toBeVisible();

    // The real dialog: Tab and Shift+Tab never leave it, the page behind is inert, Escape gives the focus back.
    // Opened from the keyboard, so the opener has the focus to get back in every engine (Safari does not focus a
    // button on a click).
    const opener = page.getByRole("button", { name: "Open a dialog" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Block Riya?" });
    await expect(dialog).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#root")).not.toHaveAttribute("inert");
    await expect(opener).toBeFocused();

    await page.getByRole("button", { name: "Show a toast" }).click();
    await expect(page.getByText("Saved. This is a toast.")).toBeVisible();

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(page.getByText(/Shown in the dark theme/)).toBeVisible();
    await expect(page.locator('[data-cc-role="you"]')).toContainText(/\d+\.\d:1/);

    const visitor = await players.open("visitor");
    visitor.expect(404, "/admin/design");
    await visitor.page.goto("/admin/design");
    await expect(visitor.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(visitor.page).toHaveTitle("Page not found · ClassiCade");
    await expect(visitor.page.getByText("Colour roles")).toHaveCount(0);
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
