import { Chess } from "chess.js";
import { CHESS_ACTIONS } from "@classicade/shared";
import { describe, expect, it } from "vitest";
import { chessEngine } from "../../chess/chessEngine.js";
import { createSeededRng, randomIndex } from "../../rng.js";
import { describeBotContract } from "../../testing/botContract.js";
import { CHESS_BOT_LEVELS, CHESS_SEARCH_LIMITS, chessBot } from "./chessBot.js";

const { BEGINNER, CLUB, STRONG } = CHESS_BOT_LEVELS;
const WHITE = "white-player";
const BLACK = "black-player";
const CTX = { now: 0 };
const SLOW = 180_000;

describeBotContract(
  chessBot,
  {
    engine: chessEngine,
    options: { timeControl: "rapid-10+0" },
    games: { [BEGINNER]: 4, [CLUB]: 2, [STRONG]: 1 },
    maxMoves: 1_000,
    replayMoves: 24,
    seed: 21,
    timeoutMs: SLOW,
  },
  { describe, it },
);

/** A new game where WHITE has the white pieces. Seed 1 gives White to the second listed player. */
const newGame = () =>
  chessEngine.init({
    players: [BLACK, WHITE],
    options: { timeControl: "rapid-10+0" },
    rng: createSeededRng(1),
  });

const apply = (state, player, raw) => {
  const validated = chessEngine.validateMove(state, player, raw, CTX);
  if (!validated.ok) {
    throw new Error(`${JSON.stringify(raw)} was refused: ${validated.message}`);
  }
  return chessEngine.applyMove(state, player, validated.value, CTX);
};

/** The game after the moves in `sans`, played through the real engine. */
function gameAfter(sans) {
  const chess = new Chess();
  return sans.reduce((state, san) => {
    const { from, to, promotion } = chess.move(san);
    const player = state.byColor[chess.turn() === "w" ? "b" : "w"];
    return apply(
      state,
      player,
      promotion ? { type: "move", from, to, promotion } : { type: "move", from, to },
    );
  }, newGame());
}

const toMove = (state) => chessEngine.activePlayers(state)[0];
const choose = (state, difficulty, seed = 1) =>
  chessBot.chooseMove({
    view: chessEngine.viewFor(state, toMove(state)),
    botId: toMove(state),
    rng: createSeededRng(seed),
    difficulty,
    history: [],
  });
const squares = ({ from, to, promotion }) => `${from}${to}${promotion ?? ""}`;

/** Plays a whole game between two levels and returns the winning level, or "draw". */
function match({ white, black, seed }) {
  const rng = createSeededRng(seed);
  const levels = { [WHITE]: white, [BLACK]: black };
  let state = newGame();
  while (chessEngine.getOutcome(state).status === "ongoing") {
    const player = toMove(state);
    const raw = chessBot.chooseMove({
      view: chessEngine.viewFor(state, player),
      botId: player,
      rng,
      difficulty: levels[player],
      history: [],
    });
    state = apply(state, player, raw);
  }
  const { winners } = chessEngine.getOutcome(state);
  return winners.length === 0 ? "draw" : levels[winners[0]];
}

/** Each pairing plays `games` games, swapping colours every game. */
const winnersOf = (stronger, weaker, games) =>
  Array.from({ length: games }, (_, seed) =>
    seed % 2 === 0
      ? match({ white: stronger, black: weaker, seed })
      : match({ white: weaker, black: stronger, seed }),
  );

describe("chessBot levels", () => {
  it("names its levels for players, weakest first", () => {
    expect(chessBot.levels.map((level) => level.name)).toEqual(["Beginner", "Club player", "Strong"]);
  });

  it("lets Strong look further than Club", () => {
    const { [CLUB]: club, [STRONG]: strong } = CHESS_SEARCH_LIMITS;

    expect(strong.maxDepth).toBeGreaterThan(club.maxDepth);
    expect(strong.maxNodes).toBeGreaterThan(club.maxNodes);
  });

  it("declines a draw the opponent offers while it is their turn, and has nothing else to answer", () => {
    const state = newGame();
    const offered = chessEngine.applyMove(state, WHITE, { type: CHESS_ACTIONS.OFFER_DRAW }, CTX);
    const view = (game) => chessEngine.viewFor(game, BLACK);

    expect(chessBot.answer({ view: view(offered), botId: BLACK })).toEqual([
      { type: CHESS_ACTIONS.DECLINE_DRAW },
    ]);
    expect(chessBot.answer({ view: view(state), botId: BLACK })).toEqual([]);
    expect(chessBot.answer({ view: view(offered), botId: WHITE })).toEqual([]);
  });

  it("refuses to choose once the game is over", () => {
    const mated = gameAfter(["f3", "e5", "g4", "Qh4#"]);
    const view = chessEngine.viewFor(mated, WHITE);

    expect(() =>
      chessBot.chooseMove({ view, botId: WHITE, rng: createSeededRng(1), difficulty: CLUB, history: [] }),
    ).toThrow(RangeError);
  });

  it("promotes with the letter the engine expects", () => {
    // A long forcing line is not needed: a game where White's pawn reaches the seventh rank.
    const state = gameAfter(["h4", "g5", "hxg5", "Nf6", "gxf6", "Rg8", "fxe7", "Rg6"]);

    expect(squares(choose(state, STRONG))).toMatch(/^e7(d8|f8)q$/);
  });

  it(
    "only ever plays moves the engine accepts, in hundreds of random positions",
    () => {
      const rng = createSeededRng(404);
      let positions = 0;
      for (let game = 0; game < 5; game += 1) {
        const chess = new Chess();
        let state = newGame();
        while (!chess.isGameOver() && state.moves.length < 60) {
          for (const level of [BEGINNER, CLUB]) {
            const raw = choose(state, level, positions);
            expect(chessEngine.validateMove(state, toMove(state), raw, CTX).ok).toBe(true);
          }
          positions += 1;
          const options = chess.moves({ verbose: true });
          const { from, to, promotion } = chess.move(options[randomIndex(rng, options.length)]);
          state = apply(
            state,
            toMove(state),
            promotion ? { type: "move", from, to, promotion } : { type: "move", from, to },
          );
        }
      }
      expect(positions).toBeGreaterThan(250);
    },
    SLOW,
  );
});

describe("chessBot finds mates", () => {
  it("Club and Strong mate in one (scholar's mate)", () => {
    const state = gameAfter(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"]);

    expect(squares(choose(state, CLUB))).toBe("h5f7");
    expect(squares(choose(state, STRONG))).toBe("h5f7");
  });

  it("Club and Strong mate in two (Légal's mate) and finish it", () => {
    for (const level of [CLUB, STRONG]) {
      let state = gameAfter(["e4", "e5", "Nf3", "d6", "Bc4", "Bg4", "Nc3", "g6", "Nxe5", "Bxd1"]);
      state = apply(state, WHITE, choose(state, level));
      expect(state.moves.at(-1).san).toBe("Bxf7+");
      state = apply(state, BLACK, { type: "move", from: "e8", to: "e7" });
      state = apply(state, WHITE, choose(state, level));

      expect(chessEngine.getOutcome(state)).toMatchObject({
        result: "win",
        winners: [WHITE],
        reason: "checkmate",
      });
    }
  });

  it("Beginner usually takes a mate in one, but not always", () => {
    const state = gameAfter(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"]);
    const mates = Array.from({ length: 100 }, (_, seed) => squares(choose(state, BEGINNER, seed))).filter(
      (move) => move === "h5f7",
    ).length;

    expect(mates).toBeGreaterThan(50);
    expect(mates).toBeLessThan(100);
  });
});

describe("chessBot strength", () => {
  // Longer runs with more seeds, and the measured move times, are in docs/tickets/CC-040.md. Tests do not
  // time moves: the budget counts positions, so time depends only on the machine (see search.test.js).
  it(
    "Strong beats Beginner in every seeded game",
    () => {
      expect(winnersOf(STRONG, BEGINNER, 3)).toEqual([STRONG, STRONG, STRONG]);
    },
    SLOW,
  );

  it(
    "Club beats Beginner in every seeded game",
    () => {
      expect(winnersOf(CLUB, BEGINNER, 4)).toEqual([CLUB, CLUB, CLUB, CLUB]);
    },
    SLOW,
  );
});
