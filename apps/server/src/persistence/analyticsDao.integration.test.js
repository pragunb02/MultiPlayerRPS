import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchDoc, playerId, transferDoc } from "../testing/analyticsFixtures.js";
import { captureLogger } from "../testing/captureLogger.js";
import { createEmptyAnalyticsDao } from "../testing/emptyAnalyticsDao.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { createAnalyticsDao } from "./analyticsDao.js";
import { connectDatabase } from "./database.js";

let mongo;
const databases = [];
let counter = 0;

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await mongo?.stop();
});

async function open() {
  const database = await connectDatabase({
    uri: mongo.uri(`analytics-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const insert = (name, docs) => database.connection.collection(name).insertMany(docs);
  return { dao: createAnalyticsDao({ connection: database.connection }), insert };
}

const OCTOBER = { from: new Date("2026-09-30T18:30:00.000Z"), to: new Date("2026-10-31T18:30:00.000Z") };
const byDay = (rows) => [...rows].sort((a, b) => a.day.localeCompare(b.day));
const G1 = playerId("guest", 1);
const G2 = playerId("guest", 2);
const U1 = playerId("user", 1);
const U2 = playerId("user", 2);
const BOT = playerId("bot", 1);

describe("analytics DAO (integration)", () => {
  it("answers exactly like the empty double on an empty database", async () => {
    const { dao } = await open();
    const empty = createEmptyAnalyticsDao();

    expect(await dao.listPlayerActivity()).toEqual(await empty.listPlayerActivity());
    expect(await dao.listPlayerDays(OCTOBER)).toEqual(await empty.listPlayerDays(OCTOBER));
    expect(await dao.getMatchFacts(OCTOBER)).toEqual(await empty.getMatchFacts(OCTOBER));
    expect(await dao.listSignups(OCTOBER)).toEqual(await empty.listSignups(OCTOBER));
    expect(await dao.listAchievementUnlocks(OCTOBER)).toEqual(await empty.listAchievementUnlocks(OCTOBER));
    expect(await dao.listQuestCompletions(OCTOBER)).toEqual(await empty.listQuestCompletions(OCTOBER));
    expect(await dao.listLeaderboardSizes({ periods: ["all"] })).toEqual(
      await empty.listLeaderboardSizes({ periods: ["all"] }),
    );
  });

  it("groups each player's matches by India day, without ids, and leaves bots out as players", async () => {
    const { dao, insert } = await open();
    await insert("matches", [
      // 23:59:59 India time on 16 October, and the first second of 17 October.
      matchDoc({ playerIds: [G1, U1], endedAt: "2026-10-16T18:29:59.000Z" }),
      matchDoc({
        playerIds: [G1, U1],
        endedAt: "2026-10-16T18:30:00.000Z",
        notCounted: [{ playerId: G1, reason: "hourly-limit" }],
      }),
      matchDoc({ playerIds: [G1, BOT], endedAt: "2026-10-17T10:00:00.000Z" }),
      matchDoc({ playerIds: [U1, G2], endedAt: "2026-10-17T11:00:00.000Z", judged: false }),
    ]);

    const players = await dao.listPlayerActivity();
    const sorted = [...players].sort((a, b) => a.kind.localeCompare(b.kind) || a.days.length - b.days.length);

    expect(sorted).toEqual([
      { kind: "guest", days: [{ day: "2026-10-17", matches: 1, counted: 1, vsPerson: 1 }] },
      {
        kind: "guest",
        days: [
          { day: "2026-10-16", matches: 1, counted: 1, vsPerson: 1 },
          { day: "2026-10-17", matches: 2, counted: 1, vsPerson: 1 },
        ],
      },
      {
        kind: "user",
        days: [
          { day: "2026-10-16", matches: 1, counted: 1, vsPerson: 1 },
          { day: "2026-10-17", matches: 2, counted: 2, vsPerson: 2 },
        ],
      },
    ]);
  });

  it("lists each player's India days of counted play in a range, with their last such day before it", async () => {
    const { dao, insert } = await open();
    await insert("matches", [
      // 23:59:59 India time on 16 October, and the first second of 17 October.
      matchDoc({ playerIds: [G1, U1], endedAt: "2026-10-16T18:29:59.000Z" }),
      matchDoc({ playerIds: [G1, BOT], endedAt: "2026-10-16T18:30:00.000Z" }),
      matchDoc({ playerIds: [U1, G1], endedAt: "2026-10-16T05:00:00.000Z" }),
      matchDoc({
        playerIds: [U1, U2],
        endedAt: "2026-10-05T10:00:00.000Z",
        notCounted: [{ playerId: U2, reason: "hourly-limit" }],
      }),
      // Before the range: G1's last counted day is 20 September, because the 25th did not count for them.
      matchDoc({ playerIds: [G1, G2], endedAt: "2026-09-10T10:00:00.000Z" }),
      matchDoc({ playerIds: [G1, G2], endedAt: "2026-09-20T10:00:00.000Z" }),
      matchDoc({
        playerIds: [G1, U2],
        endedAt: "2026-09-25T10:00:00.000Z",
        notCounted: [{ playerId: G1, reason: "hourly-limit" }],
      }),
      // After the range.
      matchDoc({ playerIds: [U1, G2], endedAt: "2026-11-01T03:00:00.000Z", judged: false }),
    ]);

    const players = await dao.listPlayerDays(OCTOBER);

    expect([...players].sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: "guest", days: ["2026-09-20", "2026-10-16", "2026-10-17"] },
      { kind: "user", days: ["2026-10-05", "2026-10-16"] },
    ]);
    expect(JSON.stringify(players)).not.toMatch(/guest_|user_|bot_/);
  });

  it("totals a range's matches by day, game, hour, who played, length, rematches and fair play", async () => {
    const { dao, insert } = await open();
    await insert("matches", [
      matchDoc({
        gameId: "rps",
        roomCode: "AAAAAA",
        playerIds: [U1, U2],
        endedAt: "2026-10-05T14:45:00.000Z",
        seconds: 30,
      }),
      matchDoc({
        gameId: "rps",
        roomCode: "AAAAAA",
        playerIds: [U2, U1],
        endedAt: "2026-10-05T14:50:00.000Z",
        seconds: 40,
      }),
      matchDoc({
        gameId: "chess",
        roomCode: "BBBBBB",
        playerIds: [G1, U1],
        endedAt: "2026-10-06T03:00:00.000Z",
        seconds: 600,
        notCounted: [
          { playerId: G1, reason: "ended-too-soon" },
          { playerId: U1, reason: "ended-too-soon" },
        ],
      }),
      matchDoc({
        gameId: "tictactoe",
        playerIds: [G1, G2],
        endedAt: "2026-10-06T03:10:00.000Z",
        judged: false,
      }),
      matchDoc({ gameId: "tictactoe", playerIds: [G1, BOT], endedAt: "2026-10-06T03:20:00.000Z" }),
      matchDoc({ gameId: "rps", playerIds: [U1, U2], endedAt: "2026-11-01T03:00:00.000Z" }),
    ]);

    const facts = await dao.getMatchFacts(OCTOBER);

    expect(
      byDay(facts.byDayGame)
        .map(({ day, gameId, matches }) => `${day} ${gameId} ${matches}`)
        .sort(),
    ).toEqual(["2026-10-05 rps 2", "2026-10-06 chess 1", "2026-10-06 tictactoe 2"]);
    // 14:45 UTC on Monday is 20:15 India time. 03:00 UTC on Tuesday is 08:30.
    expect(facts.byHour).toEqual(
      expect.arrayContaining([
        { weekday: 1, hour: 20, matches: 2 },
        { weekday: 2, hour: 8, matches: 3 },
      ]),
    );
    expect(facts.mix).toEqual(
      expect.arrayContaining([
        { mix: "accounts", withBot: false, matches: 2 },
        { mix: "mixed", withBot: false, matches: 1 },
        { mix: "guests", withBot: false, matches: 1 },
        { mix: "guests", withBot: true, matches: 1 },
      ]),
    );
    expect(facts.mix).toHaveLength(4);
    expect(facts.durations).toEqual(
      expect.arrayContaining([
        { gameId: "rps", seconds: 30, matches: 1 },
        { gameId: "rps", seconds: 40, matches: 1 },
        { gameId: "chess", seconds: 600, matches: 1 },
        { gameId: "tictactoe", seconds: 60, matches: 2 },
      ]),
    );
    expect(facts.rooms).toEqual(
      expect.arrayContaining([
        { gameId: "rps", matches: 2, rematches: 1 },
        { gameId: "chess", matches: 1, rematches: 0 },
        { gameId: "tictactoe", matches: 2, rematches: 0 },
      ]),
    );
    expect(facts.judgedSeats).toBe(8);
    expect(facts.notCounted).toEqual([{ reason: "ended-too-soon", seats: 2 }]);
    expect(JSON.stringify(facts)).not.toMatch(/guest_|user_|bot_|AAAAAA/);
  });

  it("counts sign ups, unlocks, quests and board sizes per India day, inside the range only", async () => {
    const { dao, insert } = await open();
    await insert("player_transfers", [
      transferDoc({ number: 1, createdAt: "2026-10-02T19:00:00.000Z" }),
      transferDoc({ number: 2, createdAt: "2026-10-03T10:00:00.000Z", matches: 0 }),
      transferDoc({ number: 3, createdAt: "2026-10-03T11:00:00.000Z", done: false }),
      transferDoc({ number: 4, createdAt: "2026-09-30T18:29:00.000Z" }),
    ]);
    await insert("accounts", [
      {
        username: "a",
        usernameKey: "a",
        email: "a@x.in",
        passwordHash: "h",
        createdAt: new Date("2026-10-03T00:00:00.000Z"),
      },
    ]);
    await insert("player_achievements", [
      {
        playerId: U1,
        achievementId: "first-win",
        unlockedAt: new Date("2026-10-03T00:00:00.000Z"),
        matchId: "m",
      },
      {
        playerId: U2,
        achievementId: "first-win",
        unlockedAt: new Date("2026-10-04T00:00:00.000Z"),
        matchId: "m",
      },
      {
        playerId: U2,
        achievementId: "wins-10",
        unlockedAt: new Date("2026-08-04T00:00:00.000Z"),
        matchId: "m",
      },
    ]);
    const quest = (id, completedAt) => ({ id, completedAt });
    await insert("player_quests", [
      {
        playerId: U1,
        day: "2026-10-03",
        items: [quest("play-3", Date.parse("2026-10-03T05:00:00.000Z")), quest("win-1", null)],
        expiresAt: new Date("2026-10-11T00:00:00.000Z"),
      },
      {
        playerId: U2,
        day: "2026-10-03",
        items: [quest("play-3", Date.parse("2026-10-03T06:00:00.000Z"))],
        expiresAt: new Date(),
      },
    ]);
    await insert("leaderboard_entries", [
      { board: "xp", period: "all", playerId: U1 },
      { board: "xp", period: "all", playerId: U2 },
      { board: "xp", period: "2026-W41", playerId: U1 },
      { board: "xp", period: "2026-W30", playerId: U1 },
    ]);

    const signups = await dao.listSignups(OCTOBER);

    // 19:00 UTC on 2 October is already 3 October in India.
    expect(signups.transfers).toEqual([{ day: "2026-10-03", transfers: 3, withMatches: 1 }]);
    expect(signups.accounts).toEqual([{ day: "2026-10-03", accounts: 1, legacy: 0 }]);
    expect(await dao.listAchievementUnlocks(OCTOBER)).toEqual([{ achievementId: "first-win", players: 2 }]);
    expect(await dao.listQuestCompletions(OCTOBER)).toEqual([{ questId: "play-3", completions: 2 }]);
    expect(await dao.listLeaderboardSizes({ periods: ["all", "2026-W41"] })).toEqual(
      expect.arrayContaining([
        { board: "xp", period: "all", entries: 2 },
        { board: "xp", period: "2026-W41", entries: 1 },
      ]),
    );
  });

  it("counts a legacy player's first login apart from new accounts, and not as a converted guest", async () => {
    const { dao, insert } = await open();
    const account = (number, email) => ({
      _id: new Types.ObjectId(playerId("user", 900_000 + number).slice(5)),
      username: `p${number}`,
      usernameKey: `p${number}`,
      email,
      passwordHash: "h",
      createdAt: new Date("2026-10-17T06:00:00.000Z"),
    });
    // The legacy app stored emails as typed. The new account keeps the email in lower case.
    await insert("users", [{ username: "Old", email: "Old@X.in", password: "legacy-hash" }]);
    await insert("accounts", [account(1, "new@x.in"), account(2, "old@x.in")]);
    await insert("player_transfers", [
      transferDoc({ number: 1, createdAt: "2026-10-17T06:00:00.000Z" }),
      transferDoc({ number: 2, createdAt: "2026-10-17T06:00:00.000Z" }),
    ]);

    const signups = await dao.listSignups(OCTOBER);

    expect(signups.accounts).toEqual([{ day: "2026-10-17", accounts: 1, legacy: 1 }]);
    expect(signups.transfers).toEqual([{ day: "2026-10-17", transfers: 1, withMatches: 1 }]);
    expect(JSON.stringify(signups)).not.toMatch(/@|user_|guest_/);
  });
});
