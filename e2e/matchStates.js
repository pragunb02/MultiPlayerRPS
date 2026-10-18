// Brings two players into each state of a match, for every game (CC-170): waiting for an opponent, my turn, their
// turn, a request open, finished as a win, a loss or a draw, and a rematch asked or declined. The match-shell
// tests press every control in each of these states and check what each state shows without scrolling.
import { expect } from "./fixtures.js";
import { installProbe } from "./controlProbe.js";

const control = (page, id) => page.locator(`main [data-cc-control="${id}"]`);
/** Where the questions from other rooms show on any page (CC-207). */
export const SITE_REQUESTS = "[data-cc-site-requests]";
const phaseOf = (player) => player.page.locator("[data-cc-phase]");

/** Waits until the player's room page says the match is in `phase` (data-cc-phase on the room page). */
export async function phaseIs(player, phase, request) {
  await expect(phaseOf(player)).toHaveAttribute("data-cc-phase", phase);
  if (request !== undefined) {
    await expect(phaseOf(player)).toHaveAttribute("data-cc-request", request);
  }
}

/** Where both players stand now: the address and the match state on each screen. */
export async function snapshot(players) {
  return Promise.all(
    players.map(async (player) => ({
      url: player.url(),
      phase: await phaseOf(player)
        .getAttribute("data-cc-phase", { timeout: 2_000 })
        .catch(() => ""),
      request: await phaseOf(player)
        .getAttribute("data-cc-request", { timeout: 2_000 })
        .catch(() => ""),
    })),
  );
}

/**
 * Two new players, each with their own browser and the press probe installed. Every state is built with a new
 * pair, so what one visit shows only once (the save progress card after a first win) is there every time.
 */
export async function openPair(players) {
  const alice = await players.open("alice");
  const bob = await players.open("bob");
  await installProbe(alice);
  await installProbe(bob);
  return { alice, bob, bobIsGuest: false };
}

/** Alice opens the game's lobby, sets it up and creates a room. Answers the invite link. */
async function createRoom(pair, game) {
  const { alice } = pair;
  await alice.page.goto(`/games/${game.slug}`);
  await game.lobby?.(alice.page);
  await control(alice.page, "lobby.create").click();
  return alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
}

/** Bob follows the invite. The first time he chooses to play as a guest (CC-086). */
async function joinRoom(pair, invite) {
  const { bob } = pair;
  await bob.page.goto(invite);
  if (!pair.bobIsGuest) {
    await control(bob.page, "join.guest").click();
    pair.bobIsGuest = true;
  }
}

/** A started match: who moves first, and the other player. */
async function startMatch(pair, game) {
  const invite = await createRoom(pair, game);
  await joinRoom(pair, invite);
  const { alice, bob } = pair;
  for (const player of [alice, bob]) {
    await expect(phaseOf(player)).toHaveAttribute("data-cc-phase", /my-turn|their-turn/);
  }
  await game.ready?.(alice, bob);
  const aliceFirst = (await phaseOf(alice).getAttribute("data-cc-phase")) === "my-turn";
  return aliceFirst ? { first: alice, second: bob } : { first: bob, second: alice };
}

const cell = (player, index) => control(player.page, "ttt.cell").nth(index);

/** Tic-Tac-Toe moves, each waiting for the other player's turn so no press lands early. */
async function tttMoves(first, second, cells) {
  for (const [index, at] of cells.entries()) {
    const [mover, next] = index % 2 === 0 ? [first, second] : [second, first];
    await cell(mover, at).click();
    if (index < cells.length - 1) await phaseIs(next, "my-turn");
  }
}

const hand = (player, name) =>
  player.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name });

/** The chess square by its name, whatever stands on it. */
const square = (player, name) => player.page.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) });

export const GAMES = Object.freeze({
  tictactoe: {
    slug: "tic-tac-toe",
    async win(first, second) {
      await tttMoves(first, second, [0, 3, 1, 4, 2]);
    },
    async draw(first, second) {
      await tttMoves(first, second, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    },
    async theirTurn(first, second) {
      await cell(first, 4).click();
      await phaseIs(second, "my-turn");
      return { clicker: first, other: second };
    },
  },
  rps: {
    slug: "rock-paper-scissors",
    lobby: (page) => page.getByRole("combobox", { name: /match length/i }).selectOption("1"),
    async win(first, second) {
      await hand(first, /Rock/).click();
      await phaseIs(first, "their-turn");
      await hand(second, /Scissors/).click();
    },
    async theirTurn(first) {
      // Both choose at once. Once you chose you wait for the other.
      await hand(first, /Paper/).click();
      await phaseIs(first, "their-turn");
      return { clicker: first };
    },
  },
  chess: {
    slug: "chess",
    async ready(alice, bob) {
      for (const player of [alice, bob]) {
        await expect(player.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
      }
    },
    async win(first, second) {
      // The player who does not win resigns.
      await control(second.page, "chess.resign").click();
      await control(second.page, "chess.resign.confirm").click();
      await phaseIs(first, "finished");
    },
    async draw(first, second) {
      await control(first.page, "chess.offer_draw").click();
      await phaseIs(second, "their-turn", "incoming");
      await control(second.page, "room.request.accept").click();
    },
    async theirTurn(first, second) {
      await square(first, "e2").click();
      await square(first, "e4").click();
      await phaseIs(second, "my-turn");
      return { clicker: first, other: second };
    },
    async request(first, second) {
      await control(first.page, "chess.offer_draw").click();
      await phaseIs(second, "their-turn", "incoming");
      await phaseIs(first, "my-turn", "outgoing");
    },
  },
});

/** Plays a match to its end with `winner` winning. */
async function finishWith(pair, game) {
  const { first, second } = await startMatch(pair, game);
  await game.win(first, second);
  await phaseIs(first, "finished");
  await phaseIs(second, "finished");
  return { winner: first, loser: second };
}

/** The winner asks for a rematch and the loser is asked. */
async function rematchAsked(pair, game) {
  const { winner, loser } = await finishWith(pair, game);
  await control(winner.page, "room.rematch.ask").click();
  await phaseIs(winner, "finished", "outgoing");
  await phaseIs(loser, "finished", "incoming");
  return { winner, loser };
}

/**
 * Every state of a match the tests visit, for one game. Each builds the state from the start, in a new room, and
 * answers whose screen is looked at (`clicker`) and who else is in the room (`other`).
 */
export function statesFor(gameId) {
  const game = GAMES[gameId];
  const states = {
    waiting: async (pair) => {
      await createRoom(pair, game);
      await phaseIs(pair.alice, "waiting");
      return { clicker: pair.alice };
    },
    "my-turn": async (pair) => {
      const { first, second } = await startMatch(pair, game);
      return { clicker: first, other: second };
    },
    "their-turn": async (pair) => {
      const { first, second } = await startMatch(pair, game);
      return { other: second, ...(await game.theirTurn(first, second)) };
    },
    win: async (pair) => {
      const { winner, loser } = await finishWith(pair, game);
      return { clicker: winner, other: loser };
    },
    loss: async (pair) => {
      const { winner, loser } = await finishWith(pair, game);
      return { clicker: loser, other: winner };
    },
    "rematch-asked": async (pair) => {
      const { winner, loser } = await rematchAsked(pair, game);
      return { clicker: winner, other: loser };
    },
    "rematch-asked-of-me": async (pair) => {
      const { winner, loser } = await rematchAsked(pair, game);
      return { clicker: loser, other: winner };
    },
    "rematch-declined": async (pair) => {
      const { winner, loser } = await rematchAsked(pair, game);
      await control(loser.page, "room.request.decline").click();
      await phaseIs(winner, "finished", "none");
      await expect(winner.page.locator("main").getByText(/declined the rematch\.$/)).toBeVisible();
      return { clicker: winner, other: loser };
    },
    // The one asked went to the home page without pressing Leave (CC-207): the asker sees where they are.
    "rematch-asked-away": async (pair) => {
      const { winner, loser } = await rematchAsked(pair, game);
      await loser.page.locator('[data-cc-control="header.home"]').click();
      await expect(winner.page.getByText("is on another page. They have been told.")).toBeVisible();
      return { clicker: winner, other: loser };
    },
    // The one asked closed their browser (CC-207): the asker is told at once, with ways to play on.
    "rematch-asked-offline": async (pair) => {
      const { winner, loser } = await finishWith(pair, game);
      await loser.leave();
      await control(winner.page, "room.rematch.ask").click();
      await phaseIs(winner, "finished", "outgoing");
      await expect(control(winner.page, "request.copy_invite")).toBeVisible();
      return { clicker: winner };
    },
    // The question reaches the one asked on the home page (CC-207). Only its own controls are pressed there.
    "rematch-asked-elsewhere": async (pair) => {
      const { winner, loser } = await rematchAsked(pair, game);
      await loser.page.locator('[data-cc-control="header.home"]').click();
      await expect(loser.page.locator(SITE_REQUESTS)).toBeVisible();
      return { clicker: loser, other: winner, scope: SITE_REQUESTS };
    },
  };
  if (game.draw !== undefined) {
    states.draw = async (pair) => {
      const { first, second } = await startMatch(pair, game);
      await game.draw(first, second);
      await phaseIs(first, "finished");
      await phaseIs(second, "finished");
      return { clicker: first, other: second };
    };
  }
  if (game.request !== undefined) {
    states["request-asked"] = async (pair) => {
      const { first, second } = await startMatch(pair, game);
      await game.request(first, second);
      return { clicker: first, other: second };
    };
    states["request-asked-of-me"] = async (pair) => {
      const { first, second } = await startMatch(pair, game);
      await game.request(first, second);
      return { clicker: second, other: first };
    };
  }
  return states;
}

/**
 * The computer character on each game's page (CC-221), and how a visitor brings a game against it to the same result
 * every time, so a state built again shows the same controls: a loss or a draw, never a win (a win also offers to
 * save progress). Pip plays at Unbeatable for that.
 */
const COMPUTER = Object.freeze({
  tictactoe: {
    name: "Pip",
    level: "Unbeatable",
    async finish(player) {
      for (let turn = 0; turn < 12; turn++) {
        await expect(phaseOf(player)).toHaveAttribute("data-cc-phase", /my-turn|finished/, {
          timeout: 10_000,
        });
        if ((await phaseOf(player).getAttribute("data-cc-phase")) === "finished") return;
        await player.page
          .getByRole("grid", { name: "Tic-Tac-Toe board" })
          .getByRole("gridcell", { name: /: empty$/ })
          .first()
          .click();
        await expect(phaseOf(player)).not.toHaveAttribute("data-cc-phase", "my-turn");
      }
    },
  },
  rps: {
    name: "Rocky",
    // Rocky's throws cannot be known, so the visitor plays rematches until one is lost.
    async finish(player) {
      // Rocky may have thrown already, then the round is over at once: each round waits for the rounds list to grow.
      const rounds = () => player.page.getByRole("list", { name: "Rounds" }).getByRole("listitem").count();
      for (let game = 0; game < 12; game++) {
        for (let round = 0; round < 30; round++) {
          await expect(phaseOf(player)).toHaveAttribute("data-cc-phase", /my-turn|finished/, {
            timeout: 10_000,
          });
          if ((await phaseOf(player).getAttribute("data-cc-phase")) === "finished") break;
          const before = await rounds();
          await hand(player, /Rock/).click();
          await expect.poll(rounds, { timeout: 10_000 }).toBeGreaterThan(before);
        }
        await expect(player.page.locator("#result-heading")).toHaveText(/^You (won|lost)/);
        if ((await player.page.locator("#result-heading").textContent()).startsWith("You lost")) return;
        await control(player.page, "room.rematch.ask").click();
        await expect(phaseOf(player)).toHaveAttribute("data-cc-phase", "my-turn", { timeout: 10_000 });
      }
      throw new Error("Rocky never won a game");
    },
  },
  chess: {
    name: "Queen Vee",
    // A move each first, whichever colour the visitor got, so the move list always has moves to step through.
    async opening(player) {
      const white =
        (await square(player, "a8").boundingBox()).y < (await square(player, "a1").boundingBox()).y;
      await square(player, white ? "e2" : "e7").click();
      await square(player, white ? "e4" : "e5").click();
      await expect(phaseOf(player)).toHaveAttribute("data-cc-phase", "their-turn");
      await expect(phaseOf(player)).toHaveAttribute("data-cc-phase", "my-turn", { timeout: 10_000 });
    },
    async finish(player) {
      await control(player.page, "chess.resign").click();
      await control(player.page, "chess.resign.confirm").click();
    },
  },
});

/** Alice plays the game's computer character from its page, at the state's level, and it is her turn. */
async function startVsComputer(pair, gameId) {
  const { alice } = pair;
  await alice.page.goto(`/games/${GAMES[gameId].slug}`);
  const { level } = COMPUTER[gameId];
  if (level !== undefined) {
    await alice.page.getByRole("group", { name: "Level" }).getByRole("button", { name: level }).click();
  }
  await control(alice.page, "lobby.play_computer").click();
  await expect(phaseOf(alice)).toHaveAttribute("data-cc-phase", "my-turn", { timeout: 15_000 });
  await GAMES[gameId].ready?.(alice, alice);
  await COMPUTER[gameId].opening?.(alice);
  return alice;
}

/**
 * The states of a game against the game's computer character (CC-138, CC-221): its page with the level pick, the
 * visitor's turn (with the lock in Rock Paper Scissors, CC-225), and the result. Only Alice is in the room.
 */
export function computerStatesFor(gameId) {
  const computer = COMPUTER[gameId];
  return {
    "computer lobby": async (pair) => {
      await pair.alice.page.goto(`/games/${GAMES[gameId].slug}`);
      await expect(pair.alice.page.getByRole("button", { name: `Play ${computer.name}` })).toBeVisible();
      return { clicker: pair.alice };
    },
    "computer my-turn": async (pair) => ({ clicker: await startVsComputer(pair, gameId) }),
    "computer finished": async (pair) => {
      const alice = await startVsComputer(pair, gameId);
      await computer.finish(alice);
      await phaseIs(alice, "finished");
      return { clicker: alice };
    },
  };
}
