import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { NOT_COUNTED_REASONS } from "@classicade/shared";
import { createChessRatingAccessor } from "../../data/chessRatingAccessor.js";
import { createInMemoryChessRatingDao } from "../../testing/inMemoryChessRatingDao.js";
import { ConcurrentChangeError, ConflictError } from "../../utils/errors.js";
import { CHESS_RATING_EVENTS, createChessRatingComponent } from "./chessRatingComponent.js";
import { GLICKO2, rate } from "./glicko2.js";

const DAY = 24 * 3_600_000;
const NOON = Date.UTC(2026, 9, 20, 12);
const A = "guest_a";
const B = "user_b";
const START = GLICKO2.START;

/** A recorded chess game between two people that the first won by checkmate, counted for both. */
const chessMatch = ({ matchId = "m1", players = [A, B], endedAt = NOON, ...overrides } = {}) => ({
  matchId,
  roomCode: "ABC123",
  gameId: "chess",
  players: players.map((playerId) => ({ playerId, displayName: playerId })),
  log: [],
  result: { result: "win", winners: [players[0]], reason: "checkmate" },
  startedAt: endedAt - 60_000,
  endedAt,
  credit: { notCounted: [] },
  ...overrides,
});
const againstQueenVee = (level, { matchId = `vee-${level}`, endedAt = NOON } = {}) =>
  chessMatch({ matchId, endedAt, players: [A, `bot_queen-vee_${level}`] });

/** The component over the in-memory DAO, a record of what it published, and the DAO itself. */
function setup({ dao = createInMemoryChessRatingDao() } = {}) {
  const events = new EventEmitter();
  const published = [];
  events.on(CHESS_RATING_EVENTS.UPDATED, (event) => published.push(event));
  const accessor = createChessRatingAccessor({ chessRatingDao: dao });
  const ratings = createChessRatingComponent({ chessRatingAccessor: accessor, events });
  return { ratings, accessor, published, dao };
}

/** What Glicko-2 gives two unrated players after the first beat the second. */
const winnerAfterOne = rate({ player: START, games: [{ opponent: START, score: 1 }] });
const loserAfterOne = rate({ player: START, games: [{ opponent: START, score: 0 }] });

/** A DAO whose `write` fails once for one player, like a crash between the two players' writes. */
function failingOnceFor(playerId) {
  const dao = createInMemoryChessRatingDao();
  let failed = false;
  return {
    ...dao,
    async write(input) {
      if (input.playerId === playerId && !failed) {
        failed = true;
        throw new Error("lost the database");
      }
      return dao.write(input);
    },
  };
}

describe("chess rating component", () => {
  describe("applying a match", () => {
    it("rates both players of a counted chess game, and publishes it to the room", async () => {
      const { ratings, accessor, published } = setup();

      const views = await ratings.applyMatch({ match: chessMatch() });

      const a = await accessor.get(A);
      expect(a).toMatchObject({ games: 1, lastRatedAt: NOON, revision: 1 });
      expect(a.rating).toBeCloseTo(winnerAfterOne.rating, 9);
      expect((await accessor.get(B)).rating).toBeCloseTo(loserAfterOne.rating, 9);
      expect(a.changes).toEqual([{ matchId: "m1", at: NOON, before: START, after: winnerAfterOne }]);
      const shown = (playerId, after, change) => ({
        playerId,
        rating: Math.round(after.rating),
        deviation: Math.round(after.deviation),
        games: 1,
        provisional: true,
        change,
      });
      const expected = [
        shown(A, winnerAfterOne, Math.round(winnerAfterOne.rating) - 1500),
        shown(B, loserAfterOne, Math.round(loserAfterOne.rating) - 1500),
      ];
      expect(views).toEqual(expected);
      expect(published).toEqual([{ roomCode: "ABC123", matchId: "m1", ratings: expected }]);
    });

    it("changes nothing and publishes nothing when the step runs again", async () => {
      const { ratings, accessor, published } = setup();
      await ratings.applyMatch({ match: chessMatch() });

      const again = await ratings.applyMatch({ match: chessMatch() });

      expect(again).toEqual([]);
      expect(published).toHaveLength(1);
      expect(await accessor.get(A)).toMatchObject({ games: 1, revision: 1 });
    });

    it("rates the second player against the first one's rating before the game after a crash between the writes", async () => {
      const { ratings, accessor, published } = setup({ dao: failingOnceFor(B) });
      // A has played before, so a run that forgot A's rating before this game would rate B differently.
      await ratings.applyMatch({
        match: chessMatch({ matchId: "m0", players: [A, "guest_c"], endedAt: NOON - 1 }),
      });

      await expect(ratings.applyMatch({ match: chessMatch() })).rejects.toThrow("lost the database");
      const aAfter = await accessor.get(A);
      await ratings.applyMatch({ match: chessMatch() });

      const aBefore = aAfter.changes.find((change) => change.matchId === "m1").before;
      const expectedB = rate({ player: START, games: [{ opponent: aBefore, score: 0 }] });
      expect((await accessor.get(B)).rating).toBeCloseTo(expectedB.rating, 9);
      expect(await accessor.get(A)).toEqual(aAfter);
      expect(published.at(-1).ratings.map(({ playerId }) => playerId)).toEqual([A, B]);
    });

    it("fails a game that lost a race for the same player, and rates it on the next run", async () => {
      const { ratings, accessor } = setup();
      const first = chessMatch({ matchId: "m1", players: [A, B] });
      const second = chessMatch({ matchId: "m2", players: [A, "guest_c"] });

      const outcomes = await Promise.allSettled([
        ratings.applyMatch({ match: first }),
        ratings.applyMatch({ match: second }),
      ]);

      expect(outcomes.filter(({ status }) => status === "rejected").map(({ reason }) => reason)).toEqual([
        expect.any(ConcurrentChangeError),
      ]);
      const lost = outcomes[0].status === "rejected" ? first : second;
      await ratings.applyMatch({ match: lost });
      expect(await accessor.get(A)).toMatchObject({ games: 2 });
      expect((await accessor.get(A)).changes.map(({ matchId }) => matchId).sort()).toEqual(["m1", "m2"]);
    });

    it("widens the deviation of a player who has not played for a while before rating them", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: chessMatch({ matchId: "m0", endedAt: NOON - 200 * DAY }) });
      const rested = await accessor.get(A);

      await ratings.applyMatch({ match: chessMatch({ matchId: "m1" }) });

      const before = (await accessor.get(A)).changes.find((change) => change.matchId === "m1").before;
      expect(before.rating).toBe(rested.rating);
      expect(before.deviation).toBeGreaterThan(rested.deviation);
    });

    it.each([
      ["another game", chessMatch({ gameId: "tictactoe" })],
      [
        "a game that did not count for one side",
        chessMatch({ credit: { notCounted: [{ playerId: B, reason: NOT_COUNTED_REASONS.HOURLY_LIMIT }] } }),
      ],
      ["a game with a deleted player's stand-in", chessMatch({ players: [A, "deleted_00000000"] })],
      ["a game against Queen Vee", againstQueenVee("medium")],
    ])("moves no rating for %s", async (_name, match) => {
      const { ratings, accessor, published } = setup();

      expect(await ratings.applyMatch({ match })).toEqual([]);

      expect(await accessor.get(A)).toMatchObject({ rating: 1500, games: 0 });
      expect(published).toEqual([]);
    });

    it("rates nobody when both seats are now one person, a guest who signed in to the other account", async () => {
      const { ratings, accessor } = setup();
      await accessor.markMerged({ from: A, to: B, at: NOON });

      expect(await ratings.applyMatch({ match: chessMatch() })).toEqual([]);

      expect(await accessor.get(B)).toMatchObject({ games: 0 });
    });

    it("rates a game of a guest who moved meanwhile on the account", async () => {
      const { ratings, accessor } = setup();
      await ratings.transferPlayer({ from: A, to: { id: "user_a" }, now: NOON });

      await ratings.applyMatch({ match: chessMatch() });

      expect(await accessor.get("user_a")).toMatchObject({ playerId: "user_a", games: 1 });
    });
  });

  describe("seeding from the level picked against Queen Vee", () => {
    it("starts an unrated player at the level's seed, with the full deviation", async () => {
      const { ratings, accessor } = setup();

      await ratings.applyMatch({ match: againstQueenVee("hard") });

      expect(await accessor.get(A)).toMatchObject({
        rating: 1800,
        deviation: 350,
        volatility: 0.06,
        games: 0,
        seed: { level: "hard", at: NOON },
      });
    });

    it("moves the seed to a later pick, and not to an earlier one", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: againstQueenVee("hard") });

      await ratings.applyMatch({ match: againstQueenVee("easy", { endedAt: NOON + 1 }) });
      await ratings.applyMatch({ match: againstQueenVee("medium", { endedAt: NOON - 1 }) });

      expect(await accessor.get(A)).toMatchObject({ rating: 1200, seed: { level: "easy" } });
    });

    it("writes nothing when the same game seeds again", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: againstQueenVee("hard") });

      await ratings.applyMatch({ match: againstQueenVee("hard") });

      expect((await accessor.get(A)).revision).toBe(1);
    });

    it("never moves a rating that has a rated game", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: chessMatch() });
      const rated = await accessor.get(A);

      await ratings.applyMatch({ match: againstQueenVee("hard", { endedAt: NOON + 1 }) });

      expect(await accessor.get(A)).toEqual(rated);
    });

    it("rates the first game from the seed", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: againstQueenVee("hard", { endedAt: NOON - 1 }) });

      await ratings.applyMatch({ match: chessMatch() });

      expect((await accessor.get(A)).changes[0].before).toEqual({
        rating: 1800,
        deviation: 350,
        volatility: 0.06,
      });
    });
  });

  describe("a room's ratings", () => {
    it("shows each person's rating and what the room's game changed, and skips computer players", async () => {
      const { ratings } = setup();
      await ratings.applyMatch({ match: chessMatch() });

      const views = await ratings.ratingsOf({
        gameId: "chess",
        playerIds: [A, "bot_queen-vee_easy", "guest_new"],
        matchId: "m1",
      });

      expect(views).toEqual([
        expect.objectContaining({ playerId: A, games: 1, provisional: true, change: expect.any(Number) }),
        { playerId: "guest_new", rating: 1500, deviation: 350, games: 0, provisional: true },
      ]);
    });

    it("leaves the change out for a game that did not change the rating", async () => {
      const { ratings } = setup();
      await ratings.applyMatch({ match: chessMatch() });

      const [view] = await ratings.ratingsOf({ gameId: "chess", playerIds: [A], matchId: "m-other" });

      expect(view).not.toHaveProperty("change");
    });

    it("has no ratings for a game without one", async () => {
      const { ratings } = setup();

      expect(await ratings.ratingsOf({ gameId: "rps", playerIds: [A, B], matchId: "" })).toEqual([]);
    });
  });

  describe("a guest who signs in (ADR-014)", () => {
    it("gives an account with no rating the guest's whole rating", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: chessMatch() });
      const guest = await accessor.get(A);

      const result = await ratings.transferPlayer({ from: A, to: { id: "user_a" }, now: NOON + 1 });

      expect(result).toEqual({ moved: { chessRatedGames: 1 } });
      const { revision, mergedFrom, playerId, ...rest } = await accessor.get("user_a");
      const { revision: _r, mergedFrom: _m, playerId: _p, ...guestRest } = guest;
      expect(rest).toEqual(guestRest);
      expect(mergedFrom).toEqual([A]);
    });

    it("keeps the account's own rating when it has more games, and marks the guest's changes superseded", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: chessMatch({ matchId: "u1", players: ["user_a", "guest_c"] }) });
      await ratings.applyMatch({
        match: chessMatch({ matchId: "u2", players: ["user_a", "guest_c"], endedAt: NOON + 1 }),
      });
      await ratings.applyMatch({ match: chessMatch({ matchId: "g1", players: [B, A], endedAt: NOON - 1 }) });
      const account = await accessor.get("user_a");

      const result = await ratings.transferPlayer({ from: A, to: { id: "user_a" }, now: NOON + 2 });

      expect(result).toEqual({ moved: { chessRatedGames: 0 } });
      const merged = await accessor.get("user_a");
      expect(merged).toMatchObject({ rating: account.rating, games: 2, mergedFrom: [A] });
      expect(merged.changes.map(({ matchId, superseded }) => [matchId, superseded ?? false])).toEqual([
        ["g1", true],
        ["u1", false],
        ["u2", false],
      ]);
    });

    it("keeps the account's own rating when both have as many games", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: chessMatch({ matchId: "u1", players: ["user_a", "guest_c"] }) });
      await ratings.applyMatch({ match: chessMatch({ matchId: "g1", players: [B, A] }) });
      const account = await accessor.get("user_a");

      await ratings.transferPlayer({ from: A, to: { id: "user_a" }, now: NOON + 1 });

      expect((await accessor.get("user_a")).rating).toBe(account.rating);
    });

    it("changes nothing when the move runs again", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: chessMatch() });
      await ratings.transferPlayer({ from: A, to: { id: "user_a" }, now: NOON + 1 });
      const moved = await accessor.get("user_a");

      const again = await ratings.transferPlayer({ from: A, to: { id: "user_a" }, now: NOON + 2 });

      expect(again).toEqual({ moved: { chessRatedGames: 0 } });
      expect(await accessor.get("user_a")).toEqual(moved);
    });

    it("refuses to move a guest a second account already took", async () => {
      const { ratings } = setup();
      await ratings.transferPlayer({ from: A, to: { id: "user_a" }, now: NOON });

      await expect(ratings.transferPlayer({ from: A, to: { id: "user_z" }, now: NOON })).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe("export and deletion (ADR-048)", () => {
    it("exports the rating with every change", async () => {
      const { ratings } = setup();
      await ratings.applyMatch({ match: againstQueenVee("hard", { endedAt: NOON - 1 }) });
      await ratings.applyMatch({ match: chessMatch() });

      const exported = await ratings.exportPlayer({ playerId: A });

      expect(exported).toEqual({
        rating: expect.any(Number),
        deviation: expect.any(Number),
        volatility: expect.any(Number),
        games: 1,
        provisional: true,
        seededFrom: "hard",
        changes: [
          {
            matchId: "m1",
            at: new Date(NOON).toISOString(),
            before: { rating: 1800, deviation: 350, volatility: 0.06 },
            after: expect.objectContaining({ rating: expect.any(Number) }),
          },
        ],
      });
    });

    it("exports the starting rating for a player who never played", async () => {
      const { ratings } = setup();

      expect(await ratings.exportPlayer({ playerId: A })).toEqual({
        ...START,
        games: 0,
        provisional: true,
        changes: [],
      });
    });

    it("erases the player's rating, and running it twice changes nothing", async () => {
      const { ratings, accessor } = setup();
      await ratings.applyMatch({ match: chessMatch() });

      expect(await ratings.erasePlayer({ playerId: A })).toEqual({ erased: { chessRatings: 1 } });
      expect(await ratings.erasePlayer({ playerId: A })).toEqual({ erased: { chessRatings: 0 } });
      expect(await accessor.get(A)).toMatchObject({ games: 0, revision: 0 });
      expect(await accessor.get(B)).toMatchObject({ games: 1 });
    });
  });
});
