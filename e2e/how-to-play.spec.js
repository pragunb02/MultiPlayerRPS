import { createRoom, expect, formFactor, test } from "./fixtures.js";

// How to play where the player is (CC-349, clarity audit B1): one line near the top of the lobby that opens in
// place, the same steps on an invite and a challenge before the friend chooses how to join, and a How to play
// button in every match that opens a dialog without moving the board, closes with Escape or a tap outside, and gives
// the focus back. The e2e server turns the how_to_play flag on (server.mjs).

const fold = (page) => page.locator("[data-cc-slot='how-to-play']");
const summary = (page) => page.getByText("How to play: 3 steps");
const stage = (page) => page.locator("[data-cc-slot='stage']");

/**
 * Where the board starts on the page and how wide it is, and how far the page is scrolled. Not its height, which
 * grows with the moves made while the dialog is open (a chess move list on a phone).
 */
const place = (page) =>
  stage(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, scrollY };
  });
const howToPlayButton = (page) =>
  page.locator("[data-cc-slot='match-bar']").getByRole("button", { name: "How to play" });

/** Opens the fold and checks it shows the three steps. */
async function openFold(page) {
  await expect(fold(page)).not.toHaveAttribute("open");
  await summary(page).click();
  await expect(fold(page)).toHaveAttribute("open");
  await expect(fold(page).getByRole("listitem")).toHaveCount(3);
}

/**
 * Opens How to play in a match twice, with a press and then with Enter, closing it once with Escape and once with a
 * tap outside. Each time the
 * dialog has the game's title and steps, the board stays exactly where it was, and the focus comes back to the
 * button. `whileOpen` runs once with the dialog open, to show that the game goes on behind it.
 */
async function checkInGame(page, gameName, whileOpen = async () => {}) {
  const before = await place(page);
  const dialog = page.getByRole("dialog", { name: `How to play ${gameName}` });
  const button = howToPlayButton(page);

  await button.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Back to the game" })).toBeFocused();
  expect(await place(page)).toEqual(before);
  await whileOpen();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  // Again from the keyboard, as the focus is back on the button.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.locator("[data-cc-modal-backdrop]").click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(await place(page)).toEqual(before);
}

/**
 * Records where `selector` is on the page in every frame, from the first paint, so a test can say it never moved.
 * The page's flags are answered `delayMs` late, as on a slow connection.
 */
async function watchPlace(page, selector, delayMs) {
  await page.route("**/api/flags?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
  await page.addInitScript((watched) => {
    window.ccPlaces = [];
    const tick = () => {
      const element = document.querySelector(watched);
      if (element) window.ccPlaces.push(Math.round(element.getBoundingClientRect().top + window.scrollY));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
  return async () => [...new Set(await page.evaluate(() => window.ccPlaces))];
}

test.describe("How to play (CC-349)", () => {
  test("nothing moves when the flags answer late: the lobby's first card and the invite's Play as guest", async ({
    players,
  }, testInfo) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    if (formFactor(testInfo) === "mobile") await bob.page.setViewportSize({ width: 390, height: 844 });
    const flagsAnswered = (page) =>
      page.waitForResponse((res) => new URL(res.url()).pathname === "/api/flags");

    const lobbyPlaces = await watchPlace(bob.page, "main h2", 1_500);
    const lobbyAnswer = flagsAnswered(bob.page);
    await bob.page.goto("/games/chess");
    await lobbyAnswer;
    await expect(summary(bob.page)).toBeVisible();
    await bob.page.waitForTimeout(300);
    expect(await lobbyPlaces()).toHaveLength(1);

    const { path } = await createRoom(alice, "tic-tac-toe");
    const carol = await players.open("carol");
    const invite = carol.page;
    if (formFactor(testInfo) === "mobile") await invite.setViewportSize({ width: 390, height: 844 });
    const invitePlaces = await watchPlace(invite, "[data-cc-control='join.guest']", 1_500);
    const inviteAnswer = flagsAnswered(invite);
    await invite.goto(path);
    await inviteAnswer;
    await expect(summary(invite)).toBeVisible();
    await invite.waitForTimeout(300);
    expect(await invitePlaces()).toHaveLength(1);
  });

  test("the lobby shows How to play as one line above the fold, which opens in place", async ({
    players,
  }, testInfo) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;
    if (formFactor(testInfo) === "mobile") await page.setViewportSize({ width: 390, height: 844 });

    for (const slug of ["rock-paper-scissors", "tic-tac-toe", "chess"]) {
      await page.goto(`/games/${slug}`);
      const line = await summary(page).boundingBox();
      expect(line.y + line.height, slug).toBeLessThanOrEqual(page.viewportSize().height);
      // One line until it is opened.
      expect(line.height, slug).toBeLessThan(60);
      await openFold(page);
      await expect(page).toHaveURL(new RegExp(`/games/${slug}$`));
    }
  });

  test("a friend sees the steps on an invite and on a challenge before choosing how to join", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    const { path } = await createRoom(alice, "tic-tac-toe");

    await bob.page.goto(path);
    await expect(bob.page.getByRole("heading", { name: "You're invited to play Tic Tac Toe" })).toBeVisible();
    const line = await summary(bob.page).boundingBox();
    const guest = await bob.page.getByRole("button", { name: "Play as guest" }).boundingBox();
    expect(line.y).toBeLessThan(guest.y);
    await openFold(bob.page);

    await alice.page.goto("/games/chess");
    await alice.page.getByRole("button", { name: "Make a challenge link" }).click();
    await expect(alice.page.getByRole("heading", { name: "Your Chess challenge" })).toBeVisible();
    const link = await alice.page.getByRole("textbox", { name: "Challenge link" }).inputValue();
    const carol = await players.open("carol");
    await carol.page.goto(new URL(link).pathname);
    await expect(carol.page.getByRole("heading", { name: "You've been challenged to Chess" })).toBeVisible();
    await openFold(carol.page);
    await expect(fold(carol.page).locator('[lang="hi-Latn"]').first()).toHaveText(
      "Mohra tap karo, phir woh square jahan le jaana hai. Ya drag karo.",
    );
  });

  test("in a chess match How to play is one press away, and the game goes on behind it", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    const { path } = await createRoom(alice, "chess");
    await bob.page.goto(path);
    await bob.page.getByRole("button", { name: "Play as guest" }).click();
    for (const player of [alice, bob]) {
      await expect(player.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
    }
    const phase = (player) => player.page.locator("[data-cc-phase]");
    const aliceFirst = (await phase(alice).getAttribute("data-cc-phase")) === "my-turn";
    const [first, second] = aliceFirst ? [alice, bob] : [bob, alice];

    await checkInGame(second.page, "Chess", async () => {
      // White moves while Black reads the rules: the dialog never pauses the game.
      await first.page.getByRole("gridcell", { name: /^e2(,|$)/ }).click();
      await first.page.getByRole("gridcell", { name: /^e4(,|$)/ }).click();
      await expect(phase(second)).toHaveAttribute("data-cc-phase", "my-turn");
    });
  });

  test("against the computer and in pass and play, How to play is one press away", async ({ players }) => {
    const player = await players.open("solo");
    const { page } = player;

    await page.goto("/games/tic-tac-toe");
    await page.locator("[data-cc-control='lobby.play_computer']").click();
    await expect(page.getByRole("grid", { name: /Tic-Tac-Toe board/ })).toBeVisible();
    await checkInGame(page, "Tic Tac Toe");

    await page.goto("/games/rock-paper-scissors/pass-and-play");
    await page.getByRole("textbox", { name: "Player 1" }).fill("Asha");
    await page.getByRole("textbox", { name: "Player 2" }).fill("Ben");
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.locator("[data-cc-phase]")).toHaveAttribute("data-cc-phase", /playing|hand-over/);
    await checkInGame(page, "Rock Paper Scissors");
  });
});
