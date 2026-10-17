import { describe, expect, it } from "vitest";
import { levelForXp } from "@classicade/shared";
import { createLeaderboardAccessor } from "../../data/leaderboardAccessor.js";
import { createMatchAccessor } from "../../data/matchAccessor.js";
import { createProgressAccessor } from "../../data/progressAccessor.js";
import { createInMemoryLeaderboardDao } from "../../testing/inMemoryLeaderboardDao.js";
import { createInMemoryMatchDao } from "../../testing/inMemoryMatchDao.js";
import { createInMemoryProgressDao } from "../../testing/inMemoryProgressDao.js";
import { NotFoundError } from "../../utils/errors.js";
import { createLeaderboardComponent } from "./leaderboardComponent.js";

const NOW = Date.parse("2026-10-16T12:00:00Z"); // Friday of 2026-W42
const NEXT_MONDAY = Date.parse("2026-10-19T00:00:00Z");
const ALICE = Object.freeze({ kind: "user", id: "user_aaaaaaaaaaaaaaaaaaaaaaaa", displayName: "alice" });
const BOB = Object.freeze({ kind: "user", id: "user_bbbbbbbbbbbbbbbbbbbbbbbb", displayName: "bob" });
const GUEST = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000001",
  displayName: "Guest-T001",
});
const PIP = Object.freeze({ kind: "bot", id: "bot_pip_easy", displayName: "Pip" });

let matchNumber = 0;
/** A recorded match: `winner` beats `loser` at `endedAt`. */
function match({ winner = ALICE, loser = BOB, gameId = "rps", endedAt = NOW, reason = "best-of-1" } = {}) {
  matchNumber += 1;
  return {
    matchId: `00000000-0000-4000-8000-${String(matchNumber).padStart(12, "0")}`,
    roomCode: "ROOM22",
    gameId,
    options: {},
    seed: 1,
    players: [winner, loser].map(({ id, displayName }) => ({ playerId: id, displayName })),
    log: reason === "forfeit" ? [{ kind: "forfeit", playerId: loser.id, at: endedAt }] : [],
    result: { result: "win", winners: [winner.id], reason },
    startedAt: endedAt - 1_000,
    endedAt,
  };
}

function setup() {
  const matchAccessor = createMatchAccessor({ matchDao: createInMemoryMatchDao() });
  const progressAccessor = createProgressAccessor({ progressDao: createInMemoryProgressDao() });
  const boards = createLeaderboardComponent({
    leaderboardAccessor: createLeaderboardAccessor({ leaderboardDao: createInMemoryLeaderboardDao() }),
    matchAccessor,
    progressAccessor,
  });
  /** Brings a player's stored XP to `xp`, as progression has done by the time the boards step runs. */
  const progressTo = async (player, xp) => {
    const { xp: before } = await progressAccessor.get(player.id);
    await progressAccessor.applyAwardOnce({
      playerId: player.id,
      key: `seed:${xp}`,
      inc: { xp: xp - before },
      at: NOW,
    });
  };
  /**
   * Records a match and applies it to the boards like the pipeline does. `xp` is each player's total XP after
   * progression applied the match.
   */
  const play = async (options, xp = []) => {
    const recorded = await matchAccessor.record(match(options));
    for (const [player, total] of xp) {
      await progressTo(player, total);
    }
    await boards.applyMatch({ match: recorded });
    return recorded;
  };
  const entries = async (boardId, now = NOW) => (await boards.getBoard({ boardId, limit: 50, now })).entries;
  return { boards, play, entries, matchAccessor, progressAccessor, progressTo };
}

describe("leaderboardComponent", () => {
  it("lists the public boards", () => {
    const { boards } = setup();

    expect(boards.listBoards()).toEqual([
      { id: "overall", name: "Overall XP", metric: "xp", period: "all" },
      { id: "weekly", name: "This week", metric: "xp", period: "week" },
      { id: "rock-paper-scissors", name: "Rock Paper Scissors", metric: "wins", period: "all" },
      { id: "tic-tac-toe", name: "Tic Tac Toe", metric: "wins", period: "all" },
      { id: "chess", name: "Chess", metric: "wins", period: "all" },
    ]);
  });

  it("puts the accounts of a match on the XP, weekly and game boards, with public fields only", async () => {
    const { play, entries } = setup();

    await play({}, [
      [ALICE, 530],
      [BOB, 10],
    ]);

    expect(await entries("overall")).toEqual([
      { rank: 1, displayName: "alice", level: 5, score: 530 },
      { rank: 2, displayName: "bob", level: 1, score: 10 },
    ]);
    expect(await entries("weekly")).toEqual([
      { rank: 1, displayName: "alice", level: 5, score: 30 },
      { rank: 2, displayName: "bob", level: 1, score: 10 },
    ]);
    expect(await entries("rock-paper-scissors")).toEqual([
      { rank: 1, displayName: "alice", level: 5, score: 1 },
    ]);
    expect(await entries("chess")).toEqual([]);
  });

  it("shows the latest XP and level, quest bonuses included (CC-089)", async () => {
    const { play, entries } = setup();

    await play({}, [[ALICE, 130]]);

    expect(await entries("overall")).toEqual([
      { rank: 1, displayName: "alice", level: levelForXp(130), score: 130 },
    ]);
    expect((await entries("weekly"))[0]).toEqual(
      expect.objectContaining({ level: levelForXp(130), score: 30 }),
    );
  });

  it("never stores or lists guests, however much they play", async () => {
    const { play, entries } = setup();

    for (let i = 0; i < 3; i++) {
      await play({ winner: GUEST, loser: BOB }, [[GUEST, 30 * (i + 1)]]);
    }

    for (const board of ["overall", "weekly", "rock-paper-scissors"]) {
      expect((await entries(board)).map((entry) => entry.displayName)).not.toContain(GUEST.displayName);
    }
    expect(await entries("rock-paper-scissors")).toEqual([]);
  });

  it("changes nothing when the same match is applied twice", async () => {
    const { boards, play, entries } = setup();
    const recorded = await play({}, [[ALICE, 30]]);

    await boards.applyMatch({ match: recorded });

    expect((await entries("weekly"))[0].score).toBe(30);
    expect((await entries("rock-paper-scissors"))[0].score).toBe(1);
  });

  it("counts wins per game, forfeit wins included", async () => {
    const { play, entries } = setup();
    await play({ gameId: "chess" }, [[ALICE, 30]]);
    await play({ gameId: "chess", reason: "forfeit" }, [[ALICE, 60]]);

    expect(await entries("chess")).toEqual([{ rank: 1, displayName: "alice", level: 2, score: 2 }]);
  });

  it("gives games outside the catalog no board, but still counts their XP", async () => {
    const { play, entries } = setup();

    await play({ gameId: "race" }, [[ALICE, 30]]);

    expect((await entries("overall")).map((e) => e.displayName)).toContain("alice");
  });

  it("leaves a player with nothing earned off the boards (a forfeit)", async () => {
    const { play, entries } = setup();

    await play({ winner: BOB, loser: ALICE, reason: "forfeit" }, [[BOB, 30]]);

    expect((await entries("overall")).map((e) => e.displayName)).toEqual(["bob"]);
    expect((await entries("weekly")).map((e) => e.displayName)).toEqual(["bob"]);
  });

  it("reads what it needs from the stored match and progress, so a retried step still counts (CC-111)", async () => {
    const { boards, matchAccessor, entries, progressTo } = setup();
    const recorded = await matchAccessor.record(match());
    await progressTo(ALICE, 30);
    await progressTo(BOB, 10);

    await boards.applyMatch({ match: recorded });

    expect(await entries("weekly")).toEqual([
      { rank: 1, displayName: "alice", level: 1, score: 30 },
      { rank: 2, displayName: "bob", level: 1, score: 10 },
    ]);
  });

  it("moves nobody up for a match that doesn't count for them, even with XP from before (CC-095)", async () => {
    const { boards, matchAccessor, entries, progressTo } = setup();
    const recorded = await matchAccessor.record(match());
    const judged = await matchAccessor.judgeOnce({
      matchId: recorded.matchId,
      credit: { notCounted: [{ playerId: ALICE.id, reason: "opponent-daily-limit" }] },
    });

    await progressTo(ALICE, 300);
    await progressTo(BOB, 10);
    await boards.applyMatch({ match: judged });

    expect((await entries("overall")).map((e) => e.displayName)).toEqual(["bob"]);
    expect(await entries("rock-paper-scissors")).toEqual([]);
  });

  it("moves nobody on any board for a game against a computer character (ADR-025)", async () => {
    const { play, entries } = setup();

    await play({ loser: PIP, gameId: "tictactoe" }, [[ALICE, 30]]);

    expect(await entries("overall")).toEqual([]);
    expect(await entries("weekly")).toEqual([]);
    expect(await entries("tic-tac-toe")).toEqual([]);
  });

  it("leaves the XP of earlier games against computers out of the overall board after a game between people (ADR-025)", async () => {
    const { play, entries, progressAccessor } = setup();
    await progressAccessor.applyMatchOnce({
      playerId: ALICE.id,
      matchId: "m-pip",
      inc: { xp: 90, unrankedXp: 90 },
      at: NOW,
    });
    await progressAccessor.applyMatchOnce({ playerId: ALICE.id, matchId: "m-bob", inc: { xp: 30 }, at: NOW });

    // Progression already stored the 120 XP, so the boards step reads it from there.
    await play({}, []);

    expect(await entries("overall")).toEqual([{ rank: 1, displayName: "alice", level: 2, score: 30 }]);
  });

  it("ranks a tie by who reached the score first", async () => {
    const { play, entries } = setup();
    await play({ winner: BOB, loser: ALICE, endedAt: NOW - 10 }, [[BOB, 30]]);
    await play({ endedAt: NOW - 5 }, [[ALICE, 30]]);

    expect((await entries("overall")).map((entry) => entry.displayName)).toEqual(["bob", "alice"]);
  });

  it("starts a new weekly board at Monday 00:00 UTC, and says when it resets", async () => {
    const { boards, play, entries } = setup();
    await play({}, [[ALICE, 30]]);

    const week = await boards.getBoard({ boardId: "weekly", limit: 50, now: NOW });

    expect(week.board).toEqual({
      id: "weekly",
      name: "This week",
      metric: "xp",
      period: "week",
      periodId: "2026-W42",
      resetsAt: NEXT_MONDAY,
    });
    expect(await entries("weekly", NEXT_MONDAY - 1)).toHaveLength(2);
    expect(await entries("weekly", NEXT_MONDAY)).toEqual([]);
    expect(await entries("overall", NEXT_MONDAY)).toHaveLength(1);
  });

  it("describes an all-time board without a reset", async () => {
    const { boards } = setup();

    expect((await boards.getBoard({ boardId: "chess", limit: 50, now: NOW })).board).toEqual({
      id: "chess",
      name: "Chess",
      metric: "wins",
      period: "all",
      periodId: "all",
    });
  });

  it("refuses unknown boards", async () => {
    const { boards } = setup();

    await expect(boards.getBoard({ boardId: "nope", limit: 50, now: NOW })).rejects.toThrow(NotFoundError);
    await expect(boards.standingFor({ boardId: "nope", viewer: ALICE, now: NOW })).rejects.toThrow(
      NotFoundError,
    );
  });

  describe("standingFor", () => {
    it("reports an account's rank and score, also outside the listed entries", async () => {
      const { boards, play } = setup();
      await play({ winner: BOB, loser: ALICE }, [
        [BOB, 90],
        [ALICE, 40],
      ]);

      const top = await boards.getBoard({ boardId: "overall", limit: 1, now: NOW });

      expect(top.entries).toHaveLength(1);
      expect(await boards.standingFor({ boardId: "overall", viewer: ALICE, now: NOW })).toEqual({
        listed: true,
        rank: 2,
        score: 40,
      });
    });

    it("tells guests they are never ranked", async () => {
      const { boards } = setup();

      expect(await boards.standingFor({ boardId: "overall", viewer: GUEST, now: NOW })).toEqual({
        listed: false,
        reason: "guest",
      });
    });

    it("tells an account without a score that it is unranked", async () => {
      const { boards } = setup();

      expect(await boards.standingFor({ boardId: "chess", viewer: ALICE, now: NOW })).toEqual({
        listed: false,
        reason: "unranked",
      });
    });

    it("passes unexpected failures through", async () => {
      const failure = new Error("disk on fire");
      const boards = createLeaderboardComponent({
        leaderboardAccessor: {
          getStanding: async () => {
            throw failure;
          },
        },
        matchAccessor: {},
        progressAccessor: {},
      });

      await expect(boards.standingFor({ boardId: "overall", viewer: ALICE, now: NOW })).rejects.toBe(failure);
    });
  });

  describe("applyBonus (quest XP)", () => {
    it("counts bonus XP for an account's overall and weekly boards, once per key", async () => {
      const { boards, entries } = setup();
      const bonus = { ...ALICE, playerId: ALICE.id, key: "quest:2026-10-16:win-1", xpGained: 20, at: NOW };

      await boards.applyBonus({ ...bonus, ranked: true, progress: { xp: 20, level: 1 } });
      await boards.applyBonus({ ...bonus, ranked: true, progress: { xp: 20, level: 1 } });

      expect(await entries("overall")).toEqual([{ rank: 1, displayName: "alice", level: 1, score: 20 }]);
      expect(await entries("weekly")).toEqual([{ rank: 1, displayName: "alice", level: 1, score: 20 }]);
    });

    it("keeps a bonus that a game against a computer character earned off both boards (ADR-025)", async () => {
      const { boards, entries } = setup();

      await boards.applyBonus({
        playerId: ALICE.id,
        displayName: ALICE.displayName,
        key: "quest:2026-10-16:win-1",
        xpGained: 60,
        ranked: false,
        progress: { xp: 60, level: 2 },
        at: NOW,
      });

      expect(await entries("overall")).toEqual([]);
      expect(await entries("weekly")).toEqual([]);
    });

    it("leaves the XP of earlier games against computers out of the overall board when a quest bonus posts it (ADR-025)", async () => {
      const { boards, entries, progressAccessor } = setup();
      // Three wins against Pip, then a quest bonus earned in a game between people.
      await progressAccessor.applyMatchOnce({
        playerId: ALICE.id,
        matchId: "m-pip",
        inc: { xp: 90, unrankedXp: 90 },
        at: NOW,
      });
      await progressAccessor.applyAwardOnce({ playerId: ALICE.id, key: "quest:q", inc: { xp: 20 }, at: NOW });

      await boards.applyBonus({
        playerId: ALICE.id,
        displayName: ALICE.displayName,
        key: "quest:q",
        xpGained: 20,
        ranked: true,
        progress: { xp: 110, level: 2 },
        at: NOW,
      });

      expect(await entries("overall")).toEqual([{ rank: 1, displayName: "alice", level: 2, score: 20 }]);
      expect(await entries("weekly")).toEqual([{ rank: 1, displayName: "alice", level: 2, score: 20 }]);
    });

    it("ignores guests", async () => {
      const { boards, entries } = setup();

      await boards.applyBonus({
        playerId: GUEST.id,
        displayName: GUEST.displayName,
        key: "quest:2026-10-16:sweep",
        xpGained: 30,
        ranked: true,
        progress: { xp: 30, level: 1 },
        at: NOW,
      });

      expect(await entries("overall")).toEqual([]);
    });
  });

  describe("transferPlayer (a guest's data moved to an account)", () => {
    it("puts the account on the boards with the carried-over XP and wins", async () => {
      const { boards, matchAccessor, progressAccessor, entries } = setup();
      // What the earlier transfer participants left behind: the guest's matches and XP are the account's now.
      await matchAccessor.record(match({ gameId: "tictactoe", endedAt: NOW - 1_000 }));
      await matchAccessor.record(match({ gameId: "tictactoe", endedAt: Date.parse("2026-10-01T00:00:00Z") }));
      await progressAccessor.applyMatchOnce({ playerId: ALICE.id, matchId: "m", inc: { xp: 560 }, at: NOW });

      const result = await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW });

      expect(result).toEqual({ moved: { leaderboardEntries: 3 } });
      expect(await entries("overall")).toEqual([{ rank: 1, displayName: "alice", level: 5, score: 560 }]);
      expect(await entries("weekly")).toEqual([{ rank: 1, displayName: "alice", level: 5, score: 30 }]);
      expect(await entries("tic-tac-toe")).toEqual([{ rank: 1, displayName: "alice", level: 5, score: 2 }]);
    });

    it("counts only the games that count for the account this week and per game (CC-095)", async () => {
      const { boards, matchAccessor, entries } = setup();
      await matchAccessor.record(match({ gameId: "tictactoe", endedAt: NOW - 2 }));
      const capped = await matchAccessor.record(match({ gameId: "tictactoe", endedAt: NOW - 1 }));
      await matchAccessor.judgeOnce({
        matchId: capped.matchId,
        credit: { notCounted: [{ playerId: ALICE.id, reason: "hourly-limit", withdrawnFrom: GUEST.id }] },
      });

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW });

      expect((await entries("weekly"))[0].score).toBe(30);
      expect((await entries("tic-tac-toe"))[0].score).toBe(1);
    });

    it("leaves games against a computer character out of this week's XP and the wins (ADR-025)", async () => {
      const { boards, matchAccessor, entries } = setup();
      await matchAccessor.record(match({ gameId: "tictactoe", endedAt: NOW - 2 }));
      await matchAccessor.record(match({ gameId: "tictactoe", endedAt: NOW - 1, loser: PIP }));

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW });

      expect((await entries("weekly"))[0].score).toBe(30);
      expect((await entries("tic-tac-toe"))[0].score).toBe(1);
    });

    it("leaves the account's XP from games against computers out of the overall board (ADR-025)", async () => {
      const { boards, progressAccessor, entries } = setup();
      await progressAccessor.applyMatchOnce({
        playerId: ALICE.id,
        matchId: "m",
        inc: { xp: 130, unrankedXp: 100 },
        at: NOW,
      });

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW });

      expect(await entries("overall")).toEqual([{ rank: 1, displayName: "alice", level: 2, score: 30 }]);
    });

    it("is idempotent", async () => {
      const { boards, matchAccessor, progressAccessor } = setup();
      await matchAccessor.record(match());
      await progressAccessor.applyMatchOnce({ playerId: ALICE.id, matchId: "m", inc: { xp: 30 }, at: NOW });
      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW });

      expect(await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW })).toEqual({
        moved: { leaderboardEntries: 0 },
      });
    });

    it("adds up this week's matches across history pages", async () => {
      const { boards, matchAccessor, entries } = setup();
      for (let i = 0; i < 101; i++) {
        await matchAccessor.record(match({ endedAt: NOW - i }));
      }

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW });

      expect((await entries("weekly"))[0].score).toBe(101 * 30);
    });

    it("changes nothing for an account that has not played", async () => {
      const { boards, entries } = setup();

      expect(await boards.transferPlayer({ from: GUEST.id, to: BOB, now: NOW })).toEqual({
        moved: { leaderboardEntries: 0 },
      });
      expect(await entries("overall")).toEqual([]);
    });
  });

  it("fails fast on missing dependencies", () => {
    expect(() => createLeaderboardComponent({ matchAccessor: {}, progressAccessor: {} })).toThrow(TypeError);
    expect(() => createLeaderboardComponent({ leaderboardAccessor: {}, progressAccessor: {} })).toThrow(
      TypeError,
    );
    expect(() => createLeaderboardComponent({ leaderboardAccessor: {}, matchAccessor: {} })).toThrow(
      TypeError,
    );
  });
});
