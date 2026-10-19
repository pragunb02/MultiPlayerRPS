import { expect, header, joinAsGuest, test } from "./fixtures.js";
import { longNameAccount } from "./personas.js";

// No main screen is ever wider than a phone, with the longest name sign-up allows (CC-256), and the effects after a
// win and a level-up stay inside the screen (CC-270). A page wider than the screen makes a phone zoom out and pushes
// the header's Menu button, and Log out inside it, off the screen (CC-275).

/** The phones we check: a small Android, an iPhone 12 to 15 and a Pixel 7. */
const PHONES = Object.freeze([
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
]);

/**
 * Records, on every frame, the widest the page has been since the last `resetWidest`, and what stood past the
 * right edge then. A burst of confetti or a level-up lasts about a second, so one look at the end could miss it.
 */
function recordWidest() {
  const empty = () => ({ scrollWidth: 0, innerWidth: 0, past: [] });
  window.__widest = empty();
  window.__resetWidest = () => {
    window.__widest = empty();
  };
  const describe = (element) => {
    const name = element.getAttribute("data-effect") ?? element.getAttribute("class") ?? "";
    return `<${element.tagName.toLowerCase()} ${name.slice(0, 40)}> "${(element.textContent ?? "").trim().slice(0, 30)}"`;
  };
  const look = () => {
    const { scrollWidth, clientWidth } = document.documentElement;
    if (scrollWidth > window.__widest.scrollWidth || innerWidth > window.__widest.innerWidth) {
      const past = [...document.querySelectorAll("body *")]
        .filter((element) => element.getBoundingClientRect().right > clientWidth + 0.5)
        .slice(0, 8)
        .map(describe);
      window.__widest = {
        scrollWidth: Math.max(scrollWidth, window.__widest.scrollWidth),
        innerWidth: Math.max(innerWidth, window.__widest.innerWidth),
        past: scrollWidth > clientWidth ? past : window.__widest.past,
      };
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/** Opens a player's browser at the size of `phone`, recording how wide each page gets. */
async function openAt(players, name, phone, options) {
  const player = await players.open(name, options);
  await player.page.setViewportSize(phone);
  await player.page.addInitScript(recordWidest);
  return player;
}

/**
 * The page was never wider than the screen since the last check, and the browser did not widen its layout to fit
 * (a phone does that instead of scrolling sideways, so `innerWidth` grows with the page). Then starts afresh.
 */
async function expectFits(page, screen) {
  const now = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  }));
  const widest = await page.evaluate(() => window.__widest);
  const { width } = page.viewportSize();
  const seen = `${screen}: widest ${widest.scrollWidth} px in a ${widest.innerWidth} px window, now ${now.scrollWidth} px. Past the edge: ${widest.past.join(", ") || "nothing"}`;
  expect(now.scrollWidth, seen).toBeLessThanOrEqual(now.innerWidth);
  expect(widest.scrollWidth, seen).toBeLessThanOrEqual(width);
  expect(widest.innerWidth, seen).toBe(width);
  await page.evaluate(() => window.__resetWidest());
}

/** The header's controls on screen, with the menu open on a phone, all inside the screen (CC-256). */
async function expectHeaderInside(page, name) {
  const banner = await header(page);
  const { width } = page.viewportSize();
  for (const control of [
    banner.getByRole("button", { name: "Menu" }),
    banner.getByText(name, { exact: true }),
    banner.getByRole("button", { name: "Log out" }),
  ]) {
    const box = await control.boundingBox();
    expect(box, `${control} is on the page`).not.toBeNull();
    expect(box.x, `${control} starts inside the screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${control} ends inside the screen`).toBeLessThanOrEqual(width);
  }
}

async function signUp(player, account) {
  await player.page.goto("/signup");
  await player.page.getByLabel("Username").fill(account.username);
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  await player.page.getByRole("button", { name: "Create account" }).click();
  await expect(player.page).toHaveURL("/");
}

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });

/** One round of Rock Paper Scissors from the lobby: the long-named player wins. Checks each screen on the way. */
async function winOnce(winner, loser, check) {
  await winner.page.goto("/games/rock-paper-scissors");
  await check(winner.page, "lobby");
  await winner.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await winner.page.getByRole("button", { name: "Create room" }).click();
  const invite = await winner.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await expect(winner.page.getByRole("list", { name: "Players" })).toContainText("connected");
  await check(winner.page, "room waiting");
  // The loser's first invite asks how to join (CC-086); after that they have a guest session.
  if ((await loser.context.cookies()).length === 0) {
    await joinAsGuest(loser, invite);
  } else {
    await loser.page.goto(invite);
  }
  for (const player of [winner, loser]) {
    await expect(choices(player).getByRole("button", { name: /Rock/ })).toBeVisible();
    await check(player.page, `room playing (${player.name})`);
  }
  await choices(winner).getByRole("button", { name: /Rock/ }).click();
  await choices(loser)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(winner.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  await expect(loser.page.getByRole("heading", { name: /^You lost/ })).toBeVisible();
}

for (const phone of PHONES) {
  test(`at ${phone.width}×${phone.height} no main screen is wider than the screen, with a 20 character name and after a win with a level-up`, async ({
    players,
  }) => {
    const account = longNameAccount();
    const riya = await openAt(players, "riya", phone, { secrets: [account.email, account.password] });
    const guest = await openAt(players, "guest", phone);
    const { page } = riya;

    await signUp(riya, account);
    await expectFits(page, "home");
    await expectHeaderInside(page, account.username);
    await expectFits(page, "home with the menu open");

    await winOnce(riya, guest, expectFits);
    // The first win's work (its XP and quests) reaches the browser in the background. Once it has, a second win
    // is played unless the first one's quest bonus already gave the level-up (as in visual.spec.js).
    const frames = (text) => riya.record.socketFrames.filter((frame) => frame.includes(text));
    await expect
      .poll(() => frames('"progress:updated"').length > 0 && frames('"quests:updated"').length > 0, {
        timeout: 15_000,
      })
      .toBe(true);
    if (frames('"leveledUp":true').length === 0) {
      await expectFits(page, "result after the first win");
      await expectFits(guest.page, "result after the first loss (guest)");
      await winOnce(riya, guest, expectFits);
    }
    // Checked after the level-up burst has played and cleared itself, with every frame of it recorded.
    await expect(page.locator('[data-effect="level-up"]')).toHaveCount(0, { timeout: 5_000 });
    await expect((await header(page)).getByRole("progressbar", { name: /^Level 2:/ })).toBeVisible();
    await expectFits(page, "result after a win with a level-up");
    await expectFits(guest.page, "result after a loss (guest)");

    await page.goto("/leaderboards/overall");
    await expect(page.getByRole("heading", { name: "Overall XP", exact: true })).toBeVisible();
    await expectFits(page, "leaderboard");

    await page.goto("/profile");
    await expect(page.getByRole("heading", { level: 1, name: account.username })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out other devices" })).toBeVisible();
    await expectFits(page, "profile");
    await expectHeaderInside(page, account.username);
    await expectFits(page, "profile with the menu open");
  });
}
