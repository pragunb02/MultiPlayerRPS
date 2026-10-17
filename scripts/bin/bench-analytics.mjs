// Measures how long the owner console's database reads take on a large history (CC-233). Run with
// `node scripts/bin/bench-analytics.mjs`. It starts a throwaway MongoDB, creates the real indexes, seeds seeded
// random matches (MATCHES, default 50000) among PLAYERS players (default 8000) over the last DAYS days (default
// 180), with guest transfers, accounts and achievements, then times each read and one whole uncached report.
import { performance } from "node:perf_hooks";

import { MongoMemoryServer } from "mongodb-memory-server";

import { createSeededRng } from "../../packages/games/src/rng.js";
import { createAnalyticsAccessor } from "../../apps/server/src/data/analyticsAccessor.js";
import { createAnalyticsComponent } from "../../apps/server/src/domain/analytics/analyticsComponent.js";
import { createAnalyticsRange } from "../../apps/server/src/models/analyticsRange.js";
import { createAccountDao } from "../../apps/server/src/persistence/accountDao.js";
import { createAchievementDao } from "../../apps/server/src/persistence/achievementDao.js";
import { createAnalyticsDao } from "../../apps/server/src/persistence/analyticsDao.js";
import { connectDatabase } from "../../apps/server/src/persistence/database.js";
import { createLeaderboardDao } from "../../apps/server/src/persistence/leaderboardDao.js";
import { createMatchDao } from "../../apps/server/src/persistence/matchDao.js";
import { createPlayerTransferDao } from "../../apps/server/src/persistence/playerTransferDao.js";
import { createQuestDao } from "../../apps/server/src/persistence/questDao.js";
import { matchDoc, playerId, transferDoc } from "../../apps/server/src/testing/analyticsFixtures.js";
import { addDays, dayOf, startOfDay } from "../../apps/server/src/utils/indiaTime.js";
import { createLogger } from "../../apps/server/src/utils/logger.js";
import { createTtlCache } from "../../apps/server/src/utils/ttlCache.js";

const MATCHES = Number(process.env.MATCHES ?? 50_000);
const PLAYERS = Number(process.env.PLAYERS ?? 8000);
const DAYS = Number(process.env.DAYS ?? 180);
const RUNS = 5;
const GAMES = ["rps", "tictactoe", "chess"];
const HOUR_MS = 60 * 60 * 1000;

const rng = createSeededRng(233);
const pick = (list) => list[Math.floor(rng() * list.length)];
const today = dayOf(Date.now());

/** A player id. Most players are guests, and a few play far more than the rest. */
const ids = Array.from({ length: PLAYERS }, (_, index) =>
  playerId(index % 5 < 3 ? "guest" : "user", index + 1),
);
const busy = () => ids[Math.floor(rng() ** 2.5 * ids.length)];

function seedMatches() {
  return Array.from({ length: MATCHES }, () => {
    const day = addDays(today, -Math.floor(rng() * DAYS));
    // Evenings in India are busiest, so the hours lean towards 19:00 to 23:00.
    const hour = rng() < 0.5 ? 19 + Math.floor(rng() * 5) : Math.floor(rng() * 24);
    const endedAt = new Date(startOfDay(day) + hour * HOUR_MS + Math.floor(rng() * HOUR_MS));
    const first = busy();
    const second = busy();
    return matchDoc({
      gameId: pick(GAMES),
      roomCode: `R${Math.floor(rng() * MATCHES * 0.6)}`,
      playerIds: [first, second === first ? ids[(ids.indexOf(first) + 1) % ids.length] : second],
      endedAt,
      seconds: 20 + Math.floor(rng() * 600),
      notCounted: rng() < 0.05 ? [{ playerId: first, reason: "ended-too-soon" }] : [],
    });
  });
}

async function timeIt(label, work) {
  const times = [];
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    await work();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  process.stdout.write(
    `${label.padEnd(36)} median ${times[RUNS >> 1].toFixed(0).padStart(5)} ms   slowest ${times[RUNS - 1].toFixed(0).padStart(5)} ms\n`,
  );
}

const mongo = await MongoMemoryServer.create();
const database = await connectDatabase({
  uri: `${mongo.getUri()}bench`,
  logger: createLogger({ level: "warn" }),
});
try {
  const { connection } = database;
  const daos = [
    createMatchDao,
    createPlayerTransferDao,
    createAccountDao,
    createAchievementDao,
    createQuestDao,
    createLeaderboardDao,
  ];
  await Promise.all(daos.map((create) => create({ connection }).ensureIndexes()));

  const docs = seedMatches();
  for (let start = 0; start < docs.length; start += 5000) {
    await connection.collection("matches").insertMany(docs.slice(start, start + 5000));
  }
  await connection.collection("player_transfers").insertMany(
    Array.from({ length: Math.floor(PLAYERS / 20) }, (_, number) =>
      transferDoc({
        number,
        createdAt: new Date(startOfDay(addDays(today, -Math.floor(rng() * DAYS))) + 12 * HOUR_MS),
      }),
    ),
  );
  await connection.collection("player_achievements").insertMany(
    ids.slice(0, PLAYERS / 2).map((id, index) => ({
      playerId: id,
      achievementId: pick(["first-match", "first-win", "wins-10"]),
      unlockedAt: new Date(startOfDay(addDays(today, -(index % DAYS)))),
      matchId: "m",
    })),
  );
  process.stdout.write(`Seeded ${MATCHES} matches among ${PLAYERS} players over ${DAYS} days.\n\n`);

  const dao = createAnalyticsDao({ connection });
  const range = createAnalyticsRange({ from: addDays(today, -29), to: today, bucket: "day" });
  const moments = { from: new Date(startOfDay(range.from)), to: new Date(startOfDay(addDays(range.to, 1))) };
  await timeIt("listPlayerActivity (every match)", () => dao.listPlayerActivity());
  await timeIt("getMatchFacts (30 days)", () => dao.getMatchFacts(moments));
  const yearMoments = { from: new Date(startOfDay(addDays(today, -364))), to: moments.to };
  await timeIt("getMatchFacts (365 days)", () => dao.getMatchFacts(yearMoments));
  await timeIt("listSignups (30 days)", () => dao.listSignups(moments));
  await timeIt("listAchievementUnlocks (30 days)", () => dao.listAchievementUnlocks(moments));
  await timeIt("listQuestCompletions (30 days)", () => dao.listQuestCompletions(moments));
  await timeIt("listLeaderboardSizes", () => dao.listLeaderboardSizes({ periods: ["all"] }));
  const fresh = () =>
    createAnalyticsComponent({
      analyticsAccessor: createAnalyticsAccessor({ analyticsDao: dao }),
      cache: createTtlCache({ ttlMs: 1, maxEntries: 1 }),
    });
  await timeIt("whole report, 30 days by day", () => fresh().getReport({ range, now: Date.now() }));
  const year = createAnalyticsRange({ from: addDays(today, -364), to: today, bucket: "week" });
  await timeIt("whole report, 365 days by week", () => fresh().getReport({ range: year, now: Date.now() }));
  const cached = fresh();
  await cached.getReport({ range, now: 0 });
  await timeIt("cached report", () => cached.getReport({ range, now: 0 }));

  const plan = await connection.collection("matches").find(betweenEndedAt(moments)).explain("queryPlanner");
  process.stdout.write(
    `\nRange reads use: ${JSON.stringify(plan.queryPlanner.winningPlan).match(/IXSCAN|COLLSCAN/)?.[0]}\n`,
  );
} finally {
  await database.close();
  await mongo.stop();
}

function betweenEndedAt({ from, to }) {
  return { endedAt: { $gte: from, $lt: to } };
}
