import { readFile } from "node:fs/promises";
import { Chess } from "chess.js";
import mongoose from "mongoose";
import { expect, test } from "./fixtures.js";
import { E2E_MONGO_URI } from "./personas.js";

// Two guests playing chess the way people do on the big chess sites (CC-102): dragging pieces with a mouse,
// tapping or dragging with a finger on a phone, the keyboard, looking back through the moves, promotion, the
// result and the PGN download. The desktop project plays with the mouse, the mobile project with touch.

const isMobile = (testInfo) => testInfo.project.name === "mobile";

/** Alice hosts a chess room with the given time control, Bob joins by the invite link. */
async function startChess(players, { timeControl = "blitz-5+0" } = {}) {
  const alice = await players.open("alice");
  await alice.page.goto("/games/chess");
  await alice.page.getByRole("combobox", { name: "Time control" }).selectOption(timeControl);
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const bob = await players.open("bob");
  await bob.page.goto(invite);
  await bob.page.getByRole("button", { name: "Play as guest" }).click();
  for (const player of [alice, bob]) {
    await expect(player.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
  }
  // Colours are drawn at random. White sees a8 in the top left corner.
  const aliceIsWhite =
    (await square(alice, "a8").boundingBox()).y < (await square(alice, "a1").boundingBox()).y;
  const [white, black] = aliceIsWhite ? [alice, bob] : [bob, alice];
  return { white, black, roomPath: new URL(invite).pathname };
}

/** A square by its name, whatever is on it ("e4", "e4, white pawn", "e4, legal move"). */
const square = (player, name) => player.page.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) });
const moveList = (player) => player.page.getByRole("list", { name: "Move list" });

/** Brings the whole board on screen (it can be taller than a laptop window) and finds a square's centre. */
async function centre(locator) {
  await locator
    .page()
    .getByRole("grid", { name: "Chess board" })
    .evaluate((board) => {
      const { top, bottom } = board.getBoundingClientRect();
      if (top < 0 || bottom > window.innerHeight) board.scrollIntoView({ block: "center" });
    });
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Picks a piece up with the mouse and lets go over another square, moving in small steps like a hand does. */
async function drag(player, from, to) {
  const start = await centre(square(player, from));
  const end = await centre(square(player, to));
  await player.page.mouse.move(start.x, start.y);
  await player.page.mouse.down();
  await player.page.mouse.move(end.x, end.y, { steps: 8 });
  await player.page.mouse.up();
}

/** The same with a finger. Playwright has no touch drag, so the touches go straight to the browser. */
async function fingerDrag(player, from, to) {
  const start = await centre(square(player, from));
  const end = await centre(square(player, to));
  const cdp = await player.context.newCDPSession(player.page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  for (let step = 1; step <= 8; step += 1) {
    const point = {
      x: start.x + ((end.x - start.x) * step) / 8,
      y: start.y + ((end.y - start.y) * step) / 8,
    };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Plays a move the way this project's person would: mouse drag on desktop, two taps on a phone. */
async function play(player, from, to, testInfo) {
  if (isMobile(testInfo)) {
    await square(player, from).tap();
    await square(player, to).tap();
  } else {
    await drag(player, from, to);
  }
}

/** Two clicks: the piece, then where it goes. */
async function clickMove(player, from, to) {
  await square(player, from).click();
  await square(player, to).click();
}

/** Waits until both players see `san` as the newest move. */
async function seen(players, san) {
  for (const player of players) {
    await expect(moveList(player).getByRole("button").last()).toHaveText(san);
  }
}

async function downloadedPgn(player) {
  const [download] = await Promise.all([
    player.page.waitForEvent("download"),
    player.page.getByRole("link", { name: "Download PGN" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^classicade-[A-Z0-9]{6}-\d{4}-\d{2}-\d{2}\.pgn$/);
  return readFile(await download.path(), "utf8");
}

/**
 * Turns the game in this room into one 210 moves long, written straight into the room the way the server stores it
 * (CC-101), because playing that many moves by hand takes minutes. It opens with "bxc8=Q+", one of the longest
 * kinds of move, then goes on with legal moves that never end the game. White is to move. Returns the moves.
 */
async function storeLongGame(roomPath) {
  const chess = new Chess();
  for (const san of ["e4", "d5", "exd5", "c6", "dxc6", "Qa5", "cxb7", "Nd7", "bxc8=Q+"]) chess.move(san);
  for (let step = 0; chess.history().length < 210; step += 1) {
    const options = chess.moves({ verbose: true });
    const fine = options.findIndex((_, k) => {
      chess.move(options[(step * 7 + k) % options.length]);
      const over = chess.isGameOver();
      chess.undo();
      return !over;
    });
    chess.move(options[(step * 7 + fine) % options.length]);
  }
  const now = Date.now();
  const moves = chess.history({ verbose: true }).map(({ from, to, san, promotion }, index, all) => ({
    from,
    to,
    san,
    at: now - (all.length - index) * 1000,
    ...(promotion && { promotion }),
  }));
  const db = await mongoose.createConnection(E2E_MONGO_URI).asPromise();
  try {
    const { modifiedCount } = await db.collection("rooms").updateOne(
      { code: roomPath.split("/").at(-1) },
      {
        $set: { "game.state.moves": moves, "game.state.fen": chess.fen(), "game.state.lastMoveAt": now },
        $inc: { version: 1 },
      },
    );
    expect(modifiedCount).toBe(1);
  } finally {
    await db.close();
  }
  return moves.map((move) => move.san);
}

/**
 * Everything in the move list that is cut off or sticks out sideways: each number and move must show in full
 * inside the list, and the list must not scroll sideways. The columns must line up from row to row.
 */
function moveListProblems(list) {
  const problems = [];
  if (list.scrollWidth > list.clientWidth) {
    problems.push(`the list scrolls sideways: ${list.scrollWidth} > ${list.clientWidth}`);
  }
  const box = list.getBoundingClientRect();
  const inner = { left: box.left + list.clientLeft, right: box.left + list.clientLeft + list.clientWidth };
  const columns = [new Set(), new Set(), new Set()];
  for (const row of list.querySelectorAll("li")) {
    [...row.children].forEach((cell, column) => {
      const { left, right } = cell.getBoundingClientRect();
      if (cell.scrollWidth > cell.clientWidth) problems.push(`"${cell.textContent}" is cut off`);
      if (left < inner.left - 0.5 || right > inner.right + 0.5)
        problems.push(`"${cell.textContent}" sticks out`);
      columns[column].add(Math.round(column === 0 ? right : left));
    });
  }
  columns.forEach((edges, column) => {
    if (edges.size > 1) problems.push(`column ${column + 1} does not line up: ${[...edges].join(", ")}`);
  });
  return problems;
}

test.describe("chess", () => {
  test("a game played by hand ends in checkmate, with the reason, the score and the PGN", async ({
    players,
  }, testInfo) => {
    const { white, black } = await startChess(players);

    // Only your own pieces look like they can be picked up, and only on your turn.
    if (!isMobile(testInfo)) {
      const cursor = (player, name) => square(player, name).evaluate((el) => getComputedStyle(el).cursor);
      expect(await cursor(white, "f2")).toBe("grab");
      expect(await cursor(white, "f7")).toBe("default");
      expect(await cursor(black, "f7")).toBe("default");
    }

    await play(white, "f2", "f3", testInfo);
    await seen([white, black], "f3");
    await expect(square(black, "f2")).toHaveClass(/_last_/);
    await expect(square(black, "f3")).toHaveClass(/_last_/);
    await play(black, "e7", "e5", testInfo);
    await seen([white, black], "e5");
    await play(white, "g2", "g4", testInfo);
    await seen([white, black], "g4");
    await play(black, "d8", "h4", testInfo);
    await seen([white, black], "Qh4#");

    for (const player of [white, black]) {
      await expect(square(player, "e1")).toHaveClass(/_check_/);
      await expect(player.page.getByRole("heading", { name: "Checkmate" })).toBeVisible();
      await expect(player.page.getByText("0–1")).toBeVisible();
    }
    await expect(black.page.getByText("You won with Black")).toBeVisible();
    await expect(black.page.getByRole("heading", { name: "You won!" })).toBeVisible();
    await expect(white.page.getByRole("heading", { name: "You lost" })).toBeVisible();

    const pgn = await downloadedPgn(white);
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[Termination "Checkmate"]');
    expect(pgn).toContain('[TimeControl "300+0"]');
    expect(pgn).toMatch(/\[White "Guest-[^"]+"\]/);
    expect(pgn).toContain("1. f3 e5 2. g4 Qh4# 0-1");
  });

  test("a piece dropped on a square it cannot reach goes back, and stays picked up", async ({
    players,
  }, testInfo) => {
    const { white, black } = await startChess(players);
    const dragOff = isMobile(testInfo) ? fingerDrag : drag;

    await dragOff(white, "e2", "e5");

    await expect(square(white, "e2")).toHaveAccessibleName("e2, white pawn");
    await expect(square(white, "e5")).toHaveAccessibleName("e5");
    await expect(square(white, "e2")).toHaveAttribute("aria-pressed", "true");
    await expect(square(white, "e4")).toHaveAccessibleName("e4, legal move");
    await expect(moveList(white).getByRole("button")).toHaveCount(0);

    // A drop where it can go plays the move, by finger on a phone too.
    await dragOff(white, "e2", "e4");
    await seen([white, black], "e4");
    await expect(square(black, "e4")).toHaveAccessibleName("e4, white pawn");
    await expect(square(white, "e2")).toHaveAttribute("aria-pressed", "false");
  });

  test("a pawn reaching the last rank asks which piece it becomes, and Escape takes the move back", async ({
    players,
  }) => {
    const { white, black } = await startChess(players);
    const line = [
      [white, "h2", "h4", "h4"],
      [black, "g7", "g5", "g5"],
      [white, "h4", "g5", "hxg5"],
      [black, "f7", "f5", "f5"],
      [white, "g5", "g6", "g6"],
      [black, "f5", "f4", "f4"],
      [white, "g6", "g7", "g7"],
      [black, "f4", "f3", "f3"],
    ];
    for (const [player, from, to, san] of line) {
      await clickMove(player, from, to);
      await seen([white, black], san);
    }

    await clickMove(white, "g7", "h8");
    const picker = white.page.getByRole("dialog", { name: "Promote to" });
    await expect(picker.getByRole("button")).toHaveText(["", "", "", ""]);
    await expect(picker.getByRole("button", { name: "queen" })).toBeFocused();
    await white.page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(square(white, "g7")).toHaveAccessibleName("g7, white pawn");

    await clickMove(white, "g7", "h8");
    await picker.getByRole("button", { name: "knight" }).click();

    await seen([white, black], "gxh8=N");
    await expect(square(black, "h8")).toHaveAccessibleName("h8, white knight");
    // White took a pawn (1) and a rook (5) and turned a pawn into a knight (2 more), so White is 8 ahead. The new knight
    // is not counted as a pawn Black took.
    await expect(white.page.getByRole("img", { name: "Captured 1 pawn, 1 rook" })).toBeVisible();
    await expect(white.page.getByText("+8")).toBeVisible();
    await expect(black.page.getByRole("img", { name: /^Captured/ })).toHaveCount(1);
  });

  test("the keyboard plays moves, and looking back through the game never changes it", async ({
    players,
  }) => {
    const { white, black } = await startChess(players);

    // The board is one stop in the Tab order. The arrows walk the squares and Enter picks up and puts down.
    await square(white, "a1").focus();
    for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowUp"]) {
      await white.page.keyboard.press(key);
    }
    await expect(square(white, "e2")).toBeFocused();
    await white.page.keyboard.press("Enter");
    await white.page.keyboard.press("ArrowUp");
    await white.page.keyboard.press("ArrowUp");
    await expect(square(white, "e4")).toBeFocused();
    await white.page.keyboard.press("Enter");
    await seen([white, black], "e4");

    await clickMove(black, "e7", "e5");
    await seen([white, black], "e5");
    await clickMove(white, "g1", "f3");
    await seen([white, black], "Nf3");

    // Black looks back two moves. The board shows that position and cannot be played on.
    const navigation = black.page.getByRole("group", { name: "Move navigation" });
    await navigation.getByRole("button", { name: "Previous move" }).click();
    await navigation.getByRole("button", { name: "Previous move" }).click();
    await expect(black.page.getByText("Looking at move 1 of 3.")).toBeVisible();
    await expect(square(black, "e5")).toHaveAccessibleName("e5");
    await expect(square(black, "g1")).toHaveAccessibleName("g1, white knight");
    await expect(square(black, "e7")).toHaveAttribute("aria-disabled", "true");

    // The arrow keys step through the moves too, and a move in the list jumps to it.
    await black.page.getByRole("heading", { name: "Moves" }).click();
    await black.page.keyboard.press("ArrowLeft");
    await expect(black.page.getByText("Looking at move 0 of 3.")).toBeVisible();
    await expect(square(black, "e2")).toHaveAccessibleName("e2, white pawn");
    await moveList(black).getByRole("button", { name: "e5" }).click();
    await expect(black.page.getByText("Looking at move 2 of 3.")).toBeVisible();
    await expect(moveList(black).getByRole("button", { name: "e5" })).toHaveAttribute("aria-current", "step");
    await navigation.getByRole("button", { name: "Latest move" }).click();
    await expect(black.page.getByText(/Looking at move/)).toHaveCount(0);
    await expect(square(black, "f3")).toHaveAccessibleName("f3, white knight");

    // White never noticed: the game went on.
    await expect(white.page.getByText(/Looking at move/)).toHaveCount(0);
    await clickMove(black, "b8", "c6");
    await seen([white, black], "Nc6");

    // Flipping turns the board round for this player only.
    const first = (player) => player.page.getByRole("gridcell").first();
    await expect(first(white)).toHaveAccessibleName("a8, black rook");
    await white.page.getByRole("button", { name: "Flip board" }).click();
    await expect(first(white)).toHaveAccessibleName("h1, white rook");
    await expect(first(black)).toHaveAccessibleName("h1, white rook");
    await clickMove(white, "f1", "b5");
    await seen([white, black], "Bb5");
  });

  for (const reducedMotion of ["no-preference", "reduce"]) {
    test(`the opponent's move ${reducedMotion === "reduce" ? "appears in place for a player who asked for less motion" : "slides into place"}`, async ({
      players,
    }) => {
      const { white, black } = await startChess(players);
      await black.page.emulateMedia({ reducedMotion });
      // Record every position the moving piece is drawn at while it travels.
      await black.page.getByRole("grid", { name: "Chess board" }).evaluate((board) => {
        window.slideSteps = [];
        new MutationObserver(() => {
          for (const img of board.querySelectorAll("img[class*='_sliding_']")) {
            window.slideSteps.push(img.style.transform);
          }
        }).observe(board, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
      });

      await clickMove(white, "g1", "f3");
      await seen([black], "Nf3");
      await expect(square(black, "f3")).toHaveAccessibleName("f3, white knight");

      const moved = (steps) =>
        steps.filter((t) => /translate/.test(t) && !/translateX\(0(%|px)?\) translateY\(0(%|px)?\)/.test(t));
      await expect
        .poll(async () => moved(await black.page.evaluate(() => window.slideSteps)).length)
        [reducedMotion === "reduce" ? "toBe" : "toBeGreaterThan"](0);
    });
  }

  test("resigning ends the game for the other player, and the PGN says so", async ({ players }) => {
    const { white, black } = await startChess(players);
    await clickMove(white, "e2", "e4");
    await seen([white, black], "e4");

    await black.page.getByRole("button", { name: "Resign" }).click();
    await black.page
      .getByRole("dialog", { name: "Resign this game?" })
      .getByRole("button", { name: "Resign" })
      .click();

    for (const player of [white, black]) {
      await expect(player.page.getByRole("heading", { name: "Resignation" })).toBeVisible();
      await expect(player.page.getByText("1–0")).toBeVisible();
    }
    await expect(white.page.getByText("You won with White")).toBeVisible();
    const pgn = await downloadedPgn(black);
    expect(pgn).toContain('[Termination "Resignation"]');
    expect(pgn).toContain("1. e4 1-0");
  });

  test("a draw offered and accepted ends the game as a draw by agreement", async ({ players }) => {
    const { white, black } = await startChess(players);
    await clickMove(white, "d2", "d4");
    await seen([white, black], "d4");

    await white.page.getByRole("button", { name: "Offer draw" }).click();
    await expect(white.page.getByRole("button", { name: "Draw offered" })).toBeDisabled();
    // Black answers in the room's request popup (CC-104).
    const offer = black.page.getByRole("region", { name: "Draw offer" });
    await expect(offer).toContainText(/offers a draw\./);
    await offer.getByRole("button", { name: "Accept" }).click();

    for (const player of [white, black]) {
      await expect(player.page.getByRole("heading", { name: "Draw by agreement" })).toBeVisible();
      await expect(player.page.getByText("½–½")).toBeVisible();
    }
    expect(await downloadedPgn(white)).toContain('[Result "1/2-1/2"]');
  });

  test("a reload in the middle of a game keeps the position, the moves and the running clock", async ({
    players,
  }) => {
    const { white, black, roomPath } = await startChess(players);
    await clickMove(white, "e2", "e4");
    await seen([white, black], "e4");
    await clickMove(black, "c7", "c5");
    await seen([white, black], "c5");
    // White's clock is running now. Let it run a little so the reload has time to lose.
    const whiteClock = white.page.getByRole("timer", { name: "white clock" });
    await expect(whiteClock).not.toHaveText("5:00");
    const seconds = (text) => {
      const [m, s] = text.split(":").map(Number);
      return m * 60 + s;
    };
    const before = seconds(await whiteClock.textContent());

    await white.page.reload();

    expect(white.url()).toBe(roomPath);
    await expect(square(white, "e4")).toHaveAccessibleName("e4, white pawn");
    await expect(square(white, "c5")).toHaveAccessibleName("c5, black pawn");
    await expect(moveList(white).getByRole("button")).toHaveText(["e4", "c5"]);
    const after = seconds(await whiteClock.textContent());
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(before - 10);
    await expect(white.page.getByRole("timer", { name: "black clock" })).toHaveText(/^4:5\d$|^5:00$/);

    // Back leaves the game for the lobby and Forward comes back to the same position.
    await white.page.goBack();
    await white.page.goForward();
    await expect(white.page).toHaveURL(roomPath);
    await expect(square(white, "c5")).toHaveAccessibleName("c5, black pawn");
    await clickMove(white, "g1", "f3");
    await seen([white, black], "Nf3");
  });

  test("a clock under 20 seconds turns red and is announced, and at zero the game is lost on time", async ({
    players,
  }) => {
    test.setTimeout(120_000);
    const { white, black } = await startChess(players, { timeControl: "bullet-1+0" });
    await clickMove(white, "e2", "e4");
    await seen([white, black], "e4");

    // Black thinks for too long. Their clock turns red and a screen reader hears it once.
    const blackClock = black.page.getByRole("timer", { name: "black clock" });
    await expect(blackClock.locator("..")).toHaveClass(/_low_/, { timeout: 50_000 });
    await expect(black.page.getByText("Less than 20 seconds left on your clock")).toBeAttached();
    await expect(white.page.getByRole("timer", { name: "black clock" }).locator("..")).toHaveClass(/_low_/);

    for (const player of [white, black]) {
      await expect(player.page.getByRole("heading", { name: "Time out" })).toBeVisible({ timeout: 30_000 });
    }
    await expect(white.page.getByText("You won with White")).toBeVisible();
    await expect(blackClock).toHaveText("0:00.0");
    expect(await downloadedPgn(white)).toContain('[Termination "Time out"]');
  });
  test("a long game's move list shows every number and move in full, past move 100, light and dark", async ({
    players,
  }, testInfo) => {
    const { white, black, roomPath } = await startChess(players);
    const sans = await storeLongGame(roomPath);

    for (const player of [white, black]) {
      await player.page.reload();
      const list = moveList(player);
      await expect(list.getByRole("button").last()).toHaveText(sans.at(-1));
      await expect(list.getByRole("listitem")).toHaveCount(105);
      await expect(list.getByRole("listitem").nth(4)).toHaveText(/^5\.\s*bxc8=Q\+/);
      await expect(list.getByRole("listitem").nth(9)).toHaveText(/^10\./);
      await expect(list.getByRole("listitem").nth(99)).toHaveText(/^100\./);
      for (const colorScheme of ["light", "dark"]) {
        await player.page.emulateMedia({ colorScheme });
        expect(await list.evaluate(moveListProblems), colorScheme).toEqual([]);
      }
    }
    // On desktop, also where the side panel is at its narrowest: the board and the panel side by side, just over
    // the 48rem width where they stack.
    if (!isMobile(testInfo)) {
      await white.page.setViewportSize({ width: 49 * 16, height: 800 });
      expect(await moveList(white).evaluate(moveListProblems), "narrowest panel").toEqual([]);
    }
  });
});
