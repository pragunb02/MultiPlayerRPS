import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures.js";

// Two people on one phone (CC-223): a visitor opens a game's lobby, chooses pass and play, types two names and plays
// a whole game of each game. The game runs in the browser with the same engine as the server, so once it starts
// nothing goes to the server: no API request and no socket event, while the board loads on demand like any other.
// Rock Paper Scissors covers the board with a "pass the phone" screen whenever the phone changes hands, so a secret
// choice is never on screen for the other player. Chess keeps the board still, White at the bottom. Every result
// says it was not counted. Each game runs at the two sizes the evidence is taken at, a phone and a laptop.

const SIZES = Object.freeze([
  { name: "phone", viewport: { width: 390, height: 844 } },
  { name: "laptop", viewport: { width: 1280, height: 720 } },
]);
const NAMES = Object.freeze(["Asha", "Ben"]);

const phase = (page) => page.locator("[data-cc-phase]");
const matchBar = (page) => page.locator("[data-cc-slot='match-bar']");
const stage = (page) => page.locator("[data-cc-slot='stage']");
const headline = (page) => page.locator("#result-heading");

/**
 * Everything the page sends to the server from now on: requests to the API or the realtime path, and Socket.IO
 * event frames (a frame starting "42"). Static files are not counted, because the board and the engine load on
 * demand. Listening starts before the page opens, so a socket opened earlier is watched too.
 */
function watchServerTraffic(page) {
  const sent = [];
  let watching = false;
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (watching && (pathname.startsWith("/api/") || pathname.startsWith("/socket.io/"))) {
      sent.push(`${request.method()} ${pathname}`);
    }
  });
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (watching && String(frame.payload).startsWith("42")) sent.push(`socket ${frame.payload}`);
    }),
  );
  return {
    start: () => {
      watching = true;
    },
    sent: () => [...sent],
  };
}

/** From the game's lobby to the first turn: pass and play, two names, Start. */
async function startPassAndPlay(page, { slug, traffic }) {
  await page.goto(`/games/${slug}`);
  await page.getByRole("link", { name: "Play on this phone" }).click();
  await expect(page).toHaveURL(new RegExp(`/games/${slug}/pass-and-play$`));
  await page.getByRole("textbox", { name: "Player 1" }).fill(NAMES[0]);
  await page.getByRole("textbox", { name: "Player 2" }).fill(NAMES[1]);
  const start = page.getByRole("button", { name: "Start game" });
  await expect(start).not.toHaveAttribute("aria-disabled", "true");
  traffic.start();
  await start.click();
  await expect(phase(page)).toHaveAttribute("data-cc-phase", /playing|hand-over/);
}

/** The result says who won, that nothing was counted, and nothing went to the server during the game. */
async function expectNotCountedResult(page, { traffic, winner }) {
  await expect(phase(page)).toHaveAttribute("data-cc-phase", "finished");
  await expect(headline(page)).toContainText(winner);
  await expect(page.locator("[data-cc-slot='not-counted']")).toHaveText(
    "Not counted: games on one phone give no XP, quests or leaderboard places.",
  );
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
  expect(traffic.sent(), "nothing may reach the server during a pass and play game").toEqual([]);
}

for (const { name: size, viewport } of SIZES) {
  test.describe(`pass and play on a ${size}`, () => {
    test.use({ viewport });

    test("Rock Paper Scissors covers each choice and plays a whole match offline from the server", async ({
      players,
    }) => {
      const visitor = await players.open("Meena");
      const { page } = visitor;
      const traffic = watchServerTraffic(page);
      await startPassAndPlay(page, { slug: "rock-paper-scissors", traffic });

      // Asha wins both rounds with a different hand each time, so the hand still secret is never in the last note.
      for (const { round, asha, ben } of [
        { round: 1, asha: "Rock", ben: "Scissors" },
        { round: 2, asha: "Paper", ben: "Rock" },
      ]) {
        await expect(page.getByRole("heading", { name: "Pass the phone to Asha" })).toBeVisible();
        await page.getByRole("button", { name: "I'm Asha, show my turn" }).click();
        await page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: asha }).click();

        await expect(page.getByRole("heading", { name: "Pass the phone to Ben" })).toBeVisible();
        await expect(page.getByRole("group", { name: "Your choice" })).toHaveCount(0);
        await expect(stage(page)).not.toContainText(asha);
        await page.getByRole("button", { name: "I'm Ben, show my turn" }).click();
        await page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: ben }).click();
        if (round === 1) {
          await expect(stage(page)).toContainText(
            "Round 1: Asha played Rock, Ben played Scissors. Asha won the round.",
          );
        }
      }

      await expectNotCountedResult(page, { traffic, winner: "Asha won the best of 3" });
    });

    test("Tic-Tac-Toe names whose turn it is and plays a whole game offline from the server", async ({
      players,
    }) => {
      const visitor = await players.open("Meena");
      const { page } = visitor;
      const traffic = watchServerTraffic(page);
      await startPassAndPlay(page, { slug: "tic-tac-toe", traffic });
      // The engine draws who starts, so the test reads it from the match bar.
      const first = (await matchBar(page).textContent()).includes("Asha's turn") ? "Asha" : "Ben";
      const second = first === "Asha" ? "Ben" : "Asha";

      for (const [cell, mover] of [
        ["top left", first],
        ["middle left", second],
        ["top centre", first],
        ["middle centre", second],
        ["top right", first],
      ]) {
        await expect(matchBar(page)).toContainText(`${mover}'s turn`);
        await page.getByRole("gridcell", { name: new RegExp(`^${cell}: empty`) }).click();
      }

      await expectNotCountedResult(page, { traffic, winner: `${first} won with three in a row` });
    });

    test("Chess keeps the board still and plays a whole game offline from the server", async ({
      players,
    }) => {
      const visitor = await players.open("Meena");
      const { page } = visitor;
      const traffic = watchServerTraffic(page);
      await startPassAndPlay(page, { slug: "chess", traffic });
      const board = page.getByRole("grid", { name: "Chess board" });
      const firstSquare = board.getByRole("gridcell").first();
      const move = async (from, to) => {
        await board.getByRole("gridcell", { name: new RegExp(`^${from}, `) }).click();
        await board.getByRole("gridcell", { name: new RegExp(`^${to}, legal move`) }).click();
      };

      await expect(firstSquare).toHaveAccessibleName(/^a8/);
      await move("f2", "f3");
      await move("e7", "e5");
      await expect(firstSquare).toHaveAccessibleName(/^a8/);
      await move("g2", "g4");
      await move("d8", "h4");

      await expectNotCountedResult(page, { traffic, winner: "won by checkmate" });
    });
  });
}

// The pass and play screens are scanned with axe like every other screen (CC-183), with the same rules: the setup,
// the pass the phone screen, a board and the not counted result. Once, on the laptop browser.
test("the pass and play screens have no serious accessibility problems", async ({ players }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "each screen is scanned once");
  const visitor = await players.open("Meena");
  const { page } = visitor;
  // As in accessibility.spec.js: nothing is judged half way through fading in.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Every rule in the light theme, and the colour rules again in the dark one, as accessibility.spec.js does.
  const scan = async (screen) => {
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const axe = new AxeBuilder({ page });
      const { violations } = await (
        colorScheme === "light"
          ? axe.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          : axe.withRules(["color-contrast", "link-in-text-block"])
      ).analyze();
      const serious = violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
      expect(
        serious.map(
          (violation) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
        ),
        `${screen}, ${colorScheme}`,
      ).toEqual([]);
    }
  };

  await page.goto("/games/rock-paper-scissors/pass-and-play");
  await scan("the setup");
  await page.getByLabel(/match length/i).selectOption("1");
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.getByRole("heading", { name: "Pass the phone to Player 1" })).toBeVisible();
  await scan("the pass the phone screen");
  await page.getByRole("button", { name: "I'm Player 1, show my turn" }).click();
  await expect(page.getByRole("group", { name: "Your choice" })).toBeVisible();
  await scan("the board");
  await page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: "Rock" }).click();
  await page.getByRole("button", { name: "I'm Player 2, show my turn" }).click();
  await page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: "Paper" }).click();
  await expect(phase(page)).toHaveAttribute("data-cc-phase", "finished");
  await scan("the result");
});
