import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHALLENGE_LIMIT_REASONS, CHALLENGE_LIMITS, CHALLENGE_STATES } from "@classicade/shared";
import { createChallengeAccessor } from "./data/challengeAccessor.js";
import { createChallengeComponent } from "./domain/challenges/challengeComponent.js";
import { createChallengeDao } from "./persistence/challengeDao.js";
import { connectDatabase } from "./persistence/database.js";
import { captureLogger } from "./testing/captureLogger.js";
import { safetyFromAdults } from "./testing/fakeSafety.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { ConflictError } from "./utils/errors.js";

// CC-337: the limit of open challenges per sender holds on the real MongoDB DAO, for challenges made in the same
// millisecond, one after another or all at once.
const RIYA = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
const T0 = Date.UTC(2026, 9, 20, 12);
const LIMIT = CHALLENGE_LIMITS.openPerSender;

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

/**
 * The challenge component on a new MongoDB database. Each new id sorts before the last one, so a challenge made in
 * the same millisecond as an older one always sorts ahead of it by id.
 */
async function setup() {
  const database = await connectDatabase({
    uri: mongo.uri(`challenge-limit-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const challengeDao = createChallengeDao({ connection: database.connection });
  await challengeDao.ensureIndexes();
  let ids = 99_999;
  const challenges = createChallengeComponent({
    challengeAccessor: createChallengeAccessor({ challengeDao }),
    rooms: {
      checkOptions: ({ options }) => ({ timeControl: "5+0", ...options }),
      createChallengeRoom: async () => ({ code: "ROOM01", gameId: "chess" }),
    },
    blocks: { blockedWith: async () => new Set() },
    safety: safetyFromAdults(() => [RIYA.id]),
    events: { emit: () => {} },
    newId: () => `c${String(ids--).padStart(19, "0")}`,
  });
  const make = (now = T0) => challenges.create({ from: RIYA, gameId: "chess", options: {}, now });
  const openCount = async (now) =>
    (await challenges.inbox({ playerId: RIYA.id, now })).filter(
      (challenge) => challenge.state === CHALLENGE_STATES.OPEN,
    ).length;
  return { challenges, make, openCount };
}

describe("the limit of open challenges on MongoDB (integration, CC-337)", () => {
  it("refuses a fourth challenge made in the same millisecond as the first three", async () => {
    const { make, openCount } = await setup();
    for (let made = 0; made < LIMIT; made += 1) {
      await make();
    }

    const fourth = await make().catch((err) => err);

    expect(fourth).toBeInstanceOf(ConflictError);
    expect(fourth.details).toEqual({ reason: CHALLENGE_LIMIT_REASONS.OPEN, limit: LIMIT });
    expect(await openCount(T0 + 1)).toBe(LIMIT);
  });

  it("keeps exactly the limit of many challenges made at once, however their reads and writes interleave", async () => {
    const { make, openCount } = await setup();
    await make();

    const results = await Promise.allSettled(Array.from({ length: 12 }, () => make()));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(LIMIT - 1);
    for (const { reason } of results.filter((result) => result.status === "rejected")) {
      expect(reason).toBeInstanceOf(ConflictError);
      expect(reason.details.reason).toBe(CHALLENGE_LIMIT_REASONS.OPEN);
    }
    expect(await openCount(T0 + 1)).toBe(LIMIT);
  });

  it("frees a place when a challenge is taken back or expires", async () => {
    const { challenges, make, openCount } = await setup();
    const [first] = [await make(), await make(), await make()];

    await challenges.withdraw({ challengeId: first.id, playerId: RIYA.id, now: T0 + 1 });
    const last = await make(T0 + 2);
    await expect(make(T0 + 3)).rejects.toThrow(ConflictError);
    // A day on, all of them have expired.
    const dayLater = last.expiresAt;
    await Promise.all([make(dayLater), make(dayLater), make(dayLater)]);

    expect(await openCount(dayLater)).toBe(LIMIT);
    await expect(make(dayLater)).rejects.toThrow(ConflictError);
    expect(await openCount(dayLater)).toBe(LIMIT);
  });
});
