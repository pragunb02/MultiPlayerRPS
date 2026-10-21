import { describe, expect, it } from "vitest";
import { safetyFromAdults, safetyWithNoAdults } from "../../testing/fakeSafety.js";
import { levelForXp } from "@classicade/shared";
import { createLeaderboardAccessor } from "../../data/leaderboardAccessor.js";
import { createMatchAccessor } from "../../data/matchAccessor.js";
import { createPlayerTransferAccessor } from "../../data/playerTransferAccessor.js";
import { createProgressAccessor } from "../../data/progressAccessor.js";
import { createInMemoryLeaderboardDao } from "../../testing/inMemoryLeaderboardDao.js";
import { createInMemoryMatchDao } from "../../testing/inMemoryMatchDao.js";
import { createInMemoryPlayerTransferDao } from "../../testing/inMemoryPlayerTransferDao.js";
import { createInMemoryProgressDao } from "../../testing/inMemoryProgressDao.js";
import { createMatchComponent } from "../matches/matchComponent.js";
import { TEST_MATCH_PLAYER_IDS } from "../../testing/matchPlayerIds.js";
import { NotFoundError } from "../../utils/errors.js";
import { createLeaderboardComponent } from "./leaderboardComponent.js";

const NOW = Date.parse("2026-10-16T12:00:00Z"); // Friday of 2026-W42
const NEXT_MONDAY = Date.parse("2026-10-19T00:00:00Z");
const ALICE = Object.freeze({ kind: "user", id: "user_aaaaaaaaaaaaaaaaaaaaaaaa", displayName: "alice" });
const BOB = Object.freeze({ kind: "user", id: "user_bbbbbbbbbbbbbbbbbbbbbbbb", displayName: "bob" });
const GUEST = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000001",
  displayName: "Guest-7K2Q",
});
const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_WEEK = Date.parse("2026-10-09T12:00:00Z"); // Friday of 2026-W41
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

/**
 * `adults`: the player ids that are adults. Without it, everyone is, so names show as before CC-152.
 * `transfers`: replaces the guest transfers the boards look at (CC-291).
 */
function setup({ adults, transfers, failing = () => false, matchReads, cards, suspended } = {}) {
  const matchAccessor = createMatchAccessor({ matchDao: createInMemoryMatchDao() });
  const progressAccessor = createProgressAccessor({ progressDao: createInMemoryProgressDao() });
  const stored = createLeaderboardAccessor({ leaderboardDao: createInMemoryLeaderboardDao() });
  // `failing(write)` makes a raise fail, as a database blip would in the middle of the board step.
  const leaderboardAccessor = Object.freeze({
    ...stored,
    raiseScore: async (write) => {
      if (failing(write)) throw new Error("database blip");
      return stored.raiseScore(write);
    },
  });
  const transferAccessor = createPlayerTransferAccessor({
    playerTransferDao: createInMemoryPlayerTransferDao(),
  });
  const asked = [];
  const boards = createLeaderboardComponent({
    leaderboardAccessor,
    // `matchReads` replaces how the boards read one match, as a database blip would.
    matchAccessor: matchReads ? { ...matchAccessor, getById: matchReads } : matchAccessor,
    progressAccessor,
    transfers: transfers ?? transferAccessor,
    safety: safetyFromAdults(({ playerIds, now }) => {
      asked.push({ playerIds, now });
      return adults ?? playerIds;
    }),
    ...(cards !== undefined && { cards }),
    ...(suspended !== undefined && { hidden: { activePlayerIds: async ({ at }) => suspended(at) } }),
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
  /** When each of a player's rows ends, by board and period (undefined: never). */
  const endsOf = async (playerId) => {
    const ends = {};
    for (const board of ["xp", "wins:rps", "wins:chess"]) {
      for (const row of await leaderboardAccessor.listWithKeys({ board, playerId })) {
        ends[`${board} ${row.period}`] = row.expiresAt;
      }
    }
    return ends;
  };
  /** A guest's weekly quest bonus, as the quest subscription applies it. */
  const questBonus = (player, xp, total, key = "quest:2026-10-16:win-1", at = NOW) =>
    boards.applyBonus({
      playerId: player.id,
      displayName: player.displayName,
      key,
      xpGained: xp,
      ranked: true,
      progress: { xp: total, level: levelForXp(total) },
      at,
    });
  return {
    boards,
    play,
    entries,
    matchAccessor,
    progressAccessor,
    progressTo,
    asked,
    leaderboardAccessor,
    transferAccessor,
    endsOf,
    questBonus,
  };
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

  it("lists a guest under its server-given name on every board, beside accounts (ADR-060)", async () => {
    const { play, entries } = setup();

    await play({ winner: GUEST, loser: BOB }, [
      [GUEST, 30],
      [BOB, 10],
    ]);

    expect(await entries("overall")).toEqual([
      { rank: 1, displayName: "Guest-7K2Q", level: 1, score: 30 },
      { rank: 2, displayName: "bob", level: 1, score: 10 },
    ]);
    expect((await entries("weekly")).map((e) => [e.displayName, e.score])).toEqual([
      ["Guest-7K2Q", 30],
      ["bob", 10],
    ]);
    expect(await entries("rock-paper-scissors")).toEqual([
      { rank: 1, displayName: "Guest-7K2Q", level: 1, score: 1 },
    ]);
  });

  it("hides a guest row whose name the server did not give, as the age rule says (ADR-060)", async () => {
    const { play, entries } = setup({ adults: [] });
    const chosen = { ...GUEST, displayName: "Riya_2012" };

    await play({ winner: chosen, loser: BOB }, [[chosen, 30]]);

    expect((await entries("overall"))[0]).toEqual({
      rank: 1,
      displayName: "Hidden player",
      hidden: true,
      level: 1,
      score: 30,
    });
  });

  it("asks about ages for accounts only, and not at all for a board of guests (ADR-060)", async () => {
    const other = { ...GUEST, id: "guest_00000000-0000-4000-8000-000000000002", displayName: "Guest-ABCD" };
    const { play, entries, asked } = setup({ adults: [] });
    await play({ winner: GUEST, loser: other }, [
      [GUEST, 30],
      [other, 10],
    ]);

    expect((await entries("overall")).map((e) => e.displayName)).toEqual(["Guest-7K2Q", "Guest-ABCD"]);
    expect(asked).toEqual([]);

    await play({ winner: ALICE, loser: GUEST }, [[ALICE, 30]]);
    await entries("overall");
    expect(asked.at(-1).playerIds).toEqual([ALICE.id]);
  });

  it("moves a guest nowhere for a game that doesn't count for them (ADR-021)", async () => {
    const { boards, matchAccessor, entries, progressTo } = setup();
    const recorded = await matchAccessor.record(match({ winner: GUEST, loser: BOB }));
    const judged = await matchAccessor.judgeOnce({
      matchId: recorded.matchId,
      credit: { notCounted: [{ playerId: GUEST.id, reason: "hourly-limit" }] },
    });
    await progressTo(GUEST, 300);

    await boards.applyMatch({ match: judged });

    expect(await entries("overall")).toEqual([]);
    expect(await entries("rock-paper-scissors")).toEqual([]);
  });

  it("ends a guest's rows 30 days after its latest counted game, and an account's all time rows never (ADR-060)", async () => {
    const { play, endsOf } = setup();
    await play({ winner: GUEST, loser: ALICE, endedAt: NOW }, [
      [GUEST, 30],
      [ALICE, 10],
    ]);

    await play({ winner: ALICE, loser: GUEST, endedAt: NOW + DAY_MS }, [
      [GUEST, 40],
      [ALICE, 40],
    ]);

    const later = NOW + DAY_MS + 30 * DAY_MS;
    expect(await endsOf(GUEST.id)).toEqual({
      "xp all": later,
      "xp 2026-W42": Date.parse("2026-11-16T00:00:00Z"),
      "wins:rps all": later,
    });
    expect(await endsOf(ALICE.id)).toEqual({
      "xp all": undefined,
      "xp 2026-W42": Date.parse("2026-11-16T00:00:00Z"),
      "wins:rps all": undefined,
    });
  });

  it("writes nothing for a guest who has started moving to an account (ADR-060)", async () => {
    const { play, entries, transferAccessor } = setup();
    await transferAccessor.start({ from: GUEST.id, to: ALICE, at: NOW });

    await play({ winner: GUEST, loser: BOB }, [
      [GUEST, 30],
      [BOB, 10],
    ]);

    expect((await entries("overall")).map((e) => e.displayName)).toEqual(["bob"]);
    expect(await entries("rock-paper-scissors")).toEqual([]);
  });

  it("takes off the rows a moved guest already had when its match is applied again (ADR-060)", async () => {
    const { boards, play, leaderboardAccessor, transferAccessor } = setup();
    const won = await play({ winner: GUEST, loser: BOB }, [[GUEST, 30]]);
    await transferAccessor.start({ from: GUEST.id, to: ALICE, at: NOW });

    await boards.applyMatch({ match: won });

    expect(await leaderboardAccessor.listForPlayer(GUEST.id)).toEqual([]);
  });

  it("takes a guest's rows off when its move started while a failed write was under way (ADR-060)", async () => {
    const started = [{ from: GUEST.id, to: ALICE, status: "pending", createdAt: NOW }];
    let asks = 0;
    const { boards, matchAccessor, progressTo, leaderboardAccessor } = setup({
      transfers: { listFrom: async () => (asks++ === 0 ? [] : started), listPendingTo: async () => [] },
      failing: (write) => write.board === "wins:rps",
    });
    const recorded = await matchAccessor.record(match({ winner: GUEST, loser: BOB }));
    await progressTo(GUEST, 30);

    await expect(boards.applyMatch({ match: recorded })).rejects.toThrow("database blip");

    expect(await leaderboardAccessor.listForPlayer(GUEST.id)).toEqual([]);
  });

  it("never lists a guest whose move to an account is done, even if a row was left behind (ADR-060)", async () => {
    const { boards, play, entries, transferAccessor } = setup();
    await play({ winner: GUEST, loser: BOB }, [
      [GUEST, 30],
      [BOB, 10],
    ]);
    await transferAccessor.start({ from: GUEST.id, to: ALICE, at: NOW });
    await transferAccessor.markDone({
      from: GUEST.id,
      at: NOW,
      carriedOver: { xp: 30, matchesPlayed: 1, matches: 1 },
    });

    expect(await entries("overall")).toEqual([{ rank: 1, displayName: "bob", level: 1, score: 10 }]);
    expect(await entries("rock-paper-scissors")).toEqual([]);
    expect(await boards.standingFor({ boardId: "overall", viewer: GUEST, now: NOW })).toEqual({
      listed: false,
      reason: "unranked",
    });
  });

  it("still lists a guest whose move has only started, until its rows move (ADR-060)", async () => {
    const { play, entries, transferAccessor } = setup();
    await play({ winner: GUEST, loser: BOB }, [[GUEST, 30]]);
    await transferAccessor.start({ from: GUEST.id, to: ALICE, at: NOW });

    expect((await entries("overall")).map((e) => e.displayName)).toEqual(["Guest-7K2Q"]);
  });

  it("takes a guest's rows off again when its transfer started while the match was being written (ADR-060)", async () => {
    const started = [{ from: GUEST.id, to: ALICE, status: "pending", createdAt: NOW }];
    let asks = 0;
    const { play, entries } = setup({
      transfers: { listFrom: async () => (asks++ === 0 ? [] : started), listPendingTo: async () => [] },
    });

    await play({ winner: GUEST, loser: BOB }, [
      [GUEST, 30],
      [BOB, 10],
    ]);

    expect((await entries("overall")).map((e) => e.displayName)).toEqual(["bob"]);
    expect(await entries("weekly")).toHaveLength(1);
    expect(await entries("rock-paper-scissors")).toEqual([]);
  });

  it("asks only about moves into the accounts for a match of accounts, and nothing for a board of accounts", async () => {
    const asked = [];
    const { play, entries } = setup({
      transfers: {
        listFrom: async () => {
          throw new Error("not for accounts");
        },
        listPendingTo: async (ids) => {
          asked.push(ids);
          return [];
        },
      },
    });

    await play({}, [[ALICE, 30]]);

    expect(await entries("overall")).toHaveLength(1);
    expect(asked).toEqual([[ALICE.id, BOB.id]]);
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

  describe("suspended accounts (CC-334, ADR-078 decision 6)", () => {
    it("hides the rows of suspended accounts while it lasts, and ranks close up", async () => {
      const HOUR = 60 * 60 * 1000;
      const { boards, play, entries } = setup({
        suspended: (at) => new Set(at < NOW + HOUR ? [BOB.id] : []),
      });
      await play({ winner: BOB, loser: ALICE }, [
        [BOB, 90],
        [ALICE, 40],
      ]);

      expect((await entries("overall")).map((row) => [row.rank, row.displayName])).toEqual([[1, "alice"]]);
      expect((await boards.getBoard({ boardId: "overall", limit: 1, now: NOW })).entries).toHaveLength(1);
      expect(await boards.standingFor({ boardId: "overall", viewer: ALICE, now: NOW })).toEqual({
        listed: true,
        rank: 1,
        score: 40,
      });

      // Once it ends the rows are back, nothing was rewritten.
      expect((await entries("overall", NOW + HOUR)).map((row) => [row.rank, row.displayName])).toEqual([
        [1, "bob"],
        [2, "alice"],
      ]);
      expect(await boards.standingFor({ boardId: "overall", viewer: ALICE, now: NOW + HOUR })).toMatchObject({
        rank: 2,
      });
    });
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

    it("ranks a guest like an account (ADR-060)", async () => {
      const { boards, play } = setup();
      await play({ winner: BOB, loser: GUEST }, [
        [BOB, 90],
        [GUEST, 40],
      ]);

      expect(await boards.standingFor({ boardId: "overall", viewer: GUEST, now: NOW })).toEqual({
        listed: true,
        rank: 2,
        score: 40,
      });
    });

    it("tells a guest without a score that it is unranked", async () => {
      const { boards } = setup();

      expect(await boards.standingFor({ boardId: "overall", viewer: GUEST, now: NOW })).toEqual({
        listed: false,
        reason: "unranked",
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
        transfers: { listFrom: async () => [], listPendingTo: async () => [] },
        safety: safetyFromAdults(async () => new Set()),
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

    it("counts a guest's bonus on both boards and ends its rows 30 days later (ADR-060)", async () => {
      const { entries, endsOf, progressTo, questBonus } = setup();
      await progressTo(GUEST, 30);

      await questBonus(GUEST, 30, 30);

      expect(await entries("overall")).toEqual([{ rank: 1, displayName: "Guest-7K2Q", level: 1, score: 30 }]);
      expect(await entries("weekly")).toEqual([{ rank: 1, displayName: "Guest-7K2Q", level: 1, score: 30 }]);
      expect(await endsOf(GUEST.id)).toEqual({
        "xp all": NOW + 30 * DAY_MS,
        "xp 2026-W42": NOW + 30 * DAY_MS,
      });
    });

    it("leaves no row for a guest who has moved to an account (ADR-060)", async () => {
      const { entries, progressTo, questBonus, transferAccessor } = setup();
      await progressTo(GUEST, 30);
      await transferAccessor.start({ from: GUEST.id, to: ALICE, at: NOW });

      await questBonus(GUEST, 30, 30);

      expect(await entries("overall")).toEqual([]);
      expect(await entries("weekly")).toEqual([]);
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

    /**
     * The guest's rows before it signs up (`guestWeek` on this week's board, from matches and a quest), and what
     * the earlier transfer participants leave behind: the guest's matches under the account, the merged progress.
     */
    async function guestWhoSignsUp() {
      const ctx = setup();
      const won = await ctx.play({ winner: GUEST, loser: BOB }, [
        [GUEST, 30],
        [BOB, 10],
      ]);
      await ctx.progressTo(GUEST, 50);
      await ctx.questBonus(GUEST, 20, 50);
      // The matches participant renames the guest's match. The tests then bring the account's progress along.
      await createMatchComponent({
        matchAccessor: ctx.matchAccessor,
        matchPlayerIds: TEST_MATCH_PLAYER_IDS,
      }).transferPlayer({
        from: GUEST.id,
        to: ALICE,
      });
      const moved = await ctx.matchAccessor.getById(won.matchId);
      return { ...ctx, won, moved };
    }

    it("moves the guest's weekly XP, its quest bonus included, to the account and takes the guest off every board", async () => {
      const { boards, entries, progressTo, leaderboardAccessor } = await guestWhoSignsUp();
      await progressTo(ALICE, 50);

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      expect((await entries("overall")).map((e) => [e.displayName, e.score])).toEqual([
        ["alice", 50],
        ["bob", 10],
      ]);
      expect((await entries("weekly")).map((e) => [e.displayName, e.score])).toEqual([
        ["alice", 50],
        ["bob", 10],
      ]);
      expect((await entries("rock-paper-scissors")).map((e) => [e.displayName, e.score])).toEqual([
        ["alice", 1],
      ]);
      expect(await leaderboardAccessor.listForPlayer(GUEST.id)).toEqual([]);
    });

    it("adds the guest's week to what the account already had that week", async () => {
      const { boards, entries, progressTo, questBonus } = await guestWhoSignsUp();
      await questBonus(ALICE, 40, 40, "quest:2026-10-15:win-1", NOW - DAY_MS);
      await progressTo(ALICE, 90);

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      expect((await entries("weekly"))[0]).toEqual(
        expect.objectContaining({ displayName: "alice", score: 90 }),
      );
      expect((await entries("overall"))[0]).toEqual(
        expect.objectContaining({ displayName: "alice", score: 90 }),
      );
    });

    it("never counts the guest's match again when the boards step runs again for the account", async () => {
      const { boards, entries, moved, progressTo } = await guestWhoSignsUp();
      await progressTo(ALICE, 50);
      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      await boards.applyMatch({ match: moved });
      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 2 });

      expect((await entries("weekly"))[0]).toEqual(
        expect.objectContaining({ displayName: "alice", score: 50 }),
      );
      expect((await entries("rock-paper-scissors"))[0].score).toBe(1);
    });

    it("leaves out the guest's games that fair play withdrew when they joined the account (ADR-021)", async () => {
      const { boards, entries, matchAccessor, moved, progressTo } = await guestWhoSignsUp();
      await matchAccessor.judgeOnce({
        matchId: moved.matchId,
        credit: { notCounted: [{ playerId: ALICE.id, reason: "hourly-limit", withdrawnFrom: GUEST.id }] },
      });
      await progressTo(ALICE, 20);

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      expect((await entries("weekly")).map((e) => [e.displayName, e.score])).toEqual([
        ["alice", 20],
        ["bob", 10],
      ]);
      expect((await entries("rock-paper-scissors")).map((e) => e.displayName)).toEqual([]);
    });

    it("moves a guest's earlier week to the account's same week", async () => {
      const { boards, leaderboardAccessor, progressTo, questBonus } = setup();
      await progressTo(GUEST, 20);
      await questBonus(GUEST, 20, 20, "quest:2026-10-09:win-1", LAST_WEEK);

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW });

      expect(await leaderboardAccessor.listWithKeys({ board: "xp", playerId: ALICE.id })).toEqual([
        expect.objectContaining({
          period: "2026-W41",
          score: 20,
          expiresAt: Date.parse("2026-11-09T00:00:00Z"),
        }),
      ]);
    });

    it("counts a match once when its board step ran again for the account before the move (medium, #118)", async () => {
      // The guest's row has the match. The step then failed, the guest signed up and the matches moved, and the
      // outbox ran the step again, now for the account. Then the move's own board step runs.
      const { boards, entries, moved, progressTo, transferAccessor } = await guestWhoSignsUp();
      await transferAccessor.start({ from: GUEST.id, to: ALICE, at: NOW });
      await progressTo(ALICE, 50);

      await boards.applyMatch({ match: moved });
      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      expect((await entries("weekly")).map((e) => [e.displayName, e.score])).toEqual([
        ["alice", 50],
        ["bob", 10],
      ]);
      expect((await entries("overall"))[0]).toEqual(
        expect.objectContaining({ displayName: "alice", score: 50 }),
      );
    });

    it("leaves out of the move a match the account's week already counted (medium, #118)", async () => {
      // The same race when the step for the account ran before the move was recorded at all.
      const { boards, entries, moved, progressTo, leaderboardAccessor } = await guestWhoSignsUp();
      await leaderboardAccessor.addOnce({
        board: "xp",
        period: "2026-W42",
        playerId: ALICE.id,
        displayName: ALICE.displayName,
        level: 1,
        key: moved.matchId,
        inc: 30,
        at: NOW,
        expiresAt: NOW + 30 * DAY_MS,
      });
      await progressTo(ALICE, 50);

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      expect((await entries("weekly"))[0]).toEqual(
        expect.objectContaining({ displayName: "alice", score: 50 }),
      );
    });

    it("keeps both sides of a quest the guest and the account each completed under the same key", async () => {
      const { boards, entries, progressTo, questBonus } = setup();
      await questBonus(GUEST, 20, 20);
      await questBonus(ALICE, 20, 20);
      await progressTo(ALICE, 40);

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      expect((await entries("weekly"))[0]).toEqual(
        expect.objectContaining({ displayName: "alice", score: 40 }),
      );
    });

    it("passes an unexpected failure to read a match through, moving nothing", async () => {
      const failure = new Error("disk on fire");
      const { boards, progressTo, questBonus, leaderboardAccessor } = setup({
        matchReads: async () => {
          throw failure;
        },
      });
      await questBonus(GUEST, 20, 20);
      await questBonus(ALICE, 20, 20);
      await progressTo(ALICE, 40);

      await expect(boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 })).rejects.toBe(failure);
      expect(await leaderboardAccessor.listForPlayer(GUEST.id)).toHaveLength(2);
    });

    it("keeps both sides of a match the guest played against the same account (ADR-014)", async () => {
      const { boards, play, entries, progressTo, questBonus } = setup();
      const together = await play({ winner: GUEST, loser: ALICE }, [
        [GUEST, 30],
        [ALICE, 10],
      ]);
      await questBonus(GUEST, 20, 50);
      expect(together.players.map((p) => p.playerId)).toContain(GUEST.id);
      await progressTo(ALICE, 60);

      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      expect((await entries("weekly"))[0]).toEqual(
        expect.objectContaining({ displayName: "alice", score: 60 }),
      );
    });

    it("runs again after a crash that left the guest's rows behind, and adds nothing twice", async () => {
      const { boards, entries, leaderboardAccessor, progressTo } = await guestWhoSignsUp();
      await progressTo(ALICE, 50);
      const rows = await leaderboardAccessor.listWithKeys({ board: "xp", playerId: GUEST.id });
      await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });
      // The crash came after the weeks were added and before the guest's rows were deleted.
      for (const { period, score } of rows.filter((row) => row.period !== "all")) {
        await leaderboardAccessor.addOnce({
          board: "xp",
          period,
          playerId: GUEST.id,
          displayName: GUEST.displayName,
          level: 1,
          key: "restored",
          inc: score,
          at: NOW,
          expiresAt: NOW + DAY_MS,
        });
      }

      const again = await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 2 });

      expect(again).toEqual({ moved: { leaderboardEntries: 0 } });
      expect((await entries("weekly")).map((e) => [e.displayName, e.score])).toEqual([
        ["alice", 50],
        ["bob", 10],
      ]);
      expect(await leaderboardAccessor.listForPlayer(GUEST.id)).toEqual([]);
    });

    it("moves the guest's rows once, however often it runs", async () => {
      const { boards, entries, progressTo } = await guestWhoSignsUp();
      await progressTo(ALICE, 50);
      const first = await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 1 });

      const again = await boards.transferPlayer({ from: GUEST.id, to: ALICE, now: NOW + 2 });

      expect(first.moved.leaderboardEntries).toBeGreaterThan(0);
      expect(again).toEqual({ moved: { leaderboardEntries: 0 } });
      expect((await entries("weekly"))[0].score).toBe(50);
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
    const safety = safetyWithNoAdults();
    expect(() =>
      createLeaderboardComponent({
        leaderboardAccessor: {},
        matchAccessor: {},
        progressAccessor: {},
        safety,
      }),
    ).toThrow(TypeError);
    expect(() => createLeaderboardComponent({ matchAccessor: {}, progressAccessor: {} })).toThrow(TypeError);
    expect(() => createLeaderboardComponent({ leaderboardAccessor: {}, progressAccessor: {} })).toThrow(
      TypeError,
    );
    expect(() => createLeaderboardComponent({ leaderboardAccessor: {}, matchAccessor: {} })).toThrow(
      TypeError,
    );
  });
});

describe("leaderboardComponent and minors (CC-152)", () => {
  it("fails fast without a way to tell adults", () => {
    expect(() =>
      createLeaderboardComponent({ leaderboardAccessor: {}, matchAccessor: {}, progressAccessor: {} }),
    ).toThrow(TypeError);
  });

  it("shows the name of an adult and hides the name of a minor or an unknown age, keeping rank and score", async () => {
    const { play, entries, asked } = setup({ adults: [ALICE.id] });
    await play({ winner: ALICE, loser: BOB }, [
      [ALICE, 60],
      [BOB, 10],
    ]);

    const listed = await entries("overall");

    expect(listed).toEqual([
      { rank: 1, displayName: "alice", level: 2, score: 60 },
      { rank: 2, displayName: "Hidden player", hidden: true, level: 1, score: 10 },
    ]);
    expect(asked.at(-1)).toEqual({ playerIds: [ALICE.id, BOB.id], now: NOW });
  });

  it("asks nothing about ages for an empty board", async () => {
    const { entries, asked } = setup({ adults: [] });

    expect(await entries("overall")).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("leaderboardComponent: avatars and profile links (CC-034)", () => {
  /** Cards as profileCards answers them: an avatar for everyone asked, a handle for the adults. */
  const fakeCards = (adults) => {
    const asked = [];
    return {
      asked,
      cardsFor: async ({ playerIds, now }) => {
        asked.push({ playerIds, now });
        return new Map(
          playerIds.map((id) => [
            id,
            { avatar: "owl", ...(adults.includes(id) && { profile: `handle-of-${id.slice(-1)}` }) },
          ]),
        );
      },
    };
  };

  it("puts the avatar beside every row, a hidden one too, and the profile link only beside a name shown", async () => {
    // Even if the cards offered a link for the hidden row, the board leaves it out (owner, ADR-065).
    const cards = fakeCards([ALICE.id, BOB.id]);
    const { play, entries } = setup({ adults: [ALICE.id], cards });
    await play({ winner: ALICE, loser: BOB }, [
      [ALICE, 60],
      [BOB, 10],
    ]);
    await play({ winner: GUEST, loser: ALICE, endedAt: NOW + 1 }, [
      [GUEST, 30],
      [ALICE, 70],
    ]);

    expect(await entries("overall")).toEqual([
      { rank: 1, displayName: "alice", avatar: "owl", profile: "handle-of-a", level: 2, score: 70 },
      { rank: 2, displayName: "Guest-7K2Q", avatar: "owl", level: 1, score: 30 },
      { rank: 3, displayName: "Hidden player", hidden: true, avatar: "owl", level: 1, score: 10 },
    ]);
    expect(cards.asked.at(-1)).toEqual({ playerIds: [ALICE.id, GUEST.id, BOB.id], now: NOW });
  });

  it("shows the avatar of hidden rows with no link, and nothing for a player without a card", async () => {
    const cards = {
      cardsFor: async () => new Map([[ALICE.id, { avatar: "fox" }]]),
    };
    const { play, entries } = setup({ adults: [], cards });
    await play({ winner: ALICE, loser: BOB }, [
      [ALICE, 60],
      [BOB, 10],
    ]);

    expect(await entries("overall")).toEqual([
      { rank: 1, displayName: "Hidden player", hidden: true, avatar: "fox", level: 2, score: 60 },
      { rank: 2, displayName: "Hidden player", hidden: true, level: 1, score: 10 },
    ]);
  });

  it("shows a hidden row without an avatar when its card has none", async () => {
    const cards = { cardsFor: async () => new Map([[BOB.id, {}]]) };
    const { play, entries } = setup({ adults: [], cards });
    await play({ winner: ALICE, loser: BOB }, [
      [ALICE, 60],
      [BOB, 10],
    ]);

    expect((await entries("overall"))[1]).toEqual({
      rank: 2,
      displayName: "Hidden player",
      hidden: true,
      level: 1,
      score: 10,
    });
  });

  it("asks for no cards for an empty board", async () => {
    const cards = fakeCards([]);
    const { entries } = setup({ adults: [], cards });

    expect(await entries("overall")).toEqual([]);
    expect(cards.asked).toEqual([]);
  });

  it("fails fast with cards that cannot answer", () => {
    expect(() =>
      createLeaderboardComponent({
        leaderboardAccessor: {},
        matchAccessor: {},
        progressAccessor: {},
        transfers: { listFrom: async () => [], listPendingTo: async () => [] },
        safety: safetyFromAdults(async () => new Set()),
        cards: {},
      }),
    ).toThrow(/cards.cardsFor/);
  });
});

describe("leaderboardComponent and deleted accounts (CC-035)", () => {
  it("exports a player's rows on every board without their id, then erases them", async () => {
    const { boards, play } = setup();
    await play({ winner: ALICE, loser: BOB }, [
      [ALICE, 30],
      [BOB, 10],
    ]);

    const exported = await boards.exportPlayer({ playerId: ALICE.id });

    expect(exported).toEqual(
      expect.arrayContaining([
        {
          board: "xp",
          period: "all",
          displayName: "alice",
          level: 1,
          score: 30,
          updatedAt: new Date(NOW).toISOString(),
        },
        expect.objectContaining({ board: "wins:rps", period: "all", score: 1 }),
      ]),
    );
    expect(JSON.stringify(exported)).not.toContain(ALICE.id);
    const { erased } = await boards.erasePlayer({ playerId: ALICE.id });
    expect(erased.leaderboardEntries).toBe(exported.length);
    expect(await boards.exportPlayer({ playerId: ALICE.id })).toEqual([]);
  });
});
