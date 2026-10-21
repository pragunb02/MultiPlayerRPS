import { describe, expect, it } from "vitest";
import { CHALLENGE_STATES } from "@classicade/shared";
import { createInMemoryChallengeDao } from "../testing/inMemoryChallengeDao.js";
import { DuplicateKey } from "../persistence/errors.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { createChallengeAccessor } from "./challengeAccessor.js";

const RIYA = "user_0123456789abcdef01234567";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";
const T0 = Date.UTC(2026, 9, 20, 12);
const SLOTS = Object.freeze({ openSlots: 3, recentMs: 600_000 });

const accessor = () => createChallengeAccessor({ challengeDao: createInMemoryChallengeDao() });
const fresh = (fields = {}) => ({
  challengeId: "0123456789abcdefghjk",
  fromId: RIYA,
  fromName: "Riya",
  fromPublic: true,
  toId: "",
  toName: "",
  gameId: "chess",
  options: { timeControl: "5+0" },
  createdAt: T0,
  expiresAt: T0 + 1000,
  deleteAt: T0 + 2000,
  ...fields,
});

describe("challenge accessor", () => {
  it("needs a DAO", () => {
    expect(() => createChallengeAccessor({})).toThrow(TypeError);
  });

  it("stores an open challenge and gives it back frozen, with times in milliseconds", async () => {
    const challenges = accessor();

    const stored = await challenges.add(fresh(), SLOTS);

    expect(stored).toEqual({
      challengeId: "0123456789abcdefghjk",
      fromId: RIYA,
      fromName: "Riya",
      fromPublic: true,
      toId: "",
      toName: "",
      gameId: "chess",
      options: { timeControl: "5+0" },
      state: CHALLENGE_STATES.OPEN,
      createdAt: T0,
      expiresAt: T0 + 1000,
      endedAt: 0,
      acceptedBy: "",
      acceptedName: "",
      roomCode: "",
      laterBy: [],
    });
    expect(
      Object.isFrozen(stored) && Object.isFrozen(stored.options) && Object.isFrozen(stored.laterBy),
    ).toBe(true);
    expect(await challenges.get(stored.challengeId)).toEqual(stored);
  });

  it("answers NotFoundError for a challenge storage does not have", async () => {
    await expect(accessor().get("nobody00000000000000")).rejects.toThrow(NotFoundError);
  });

  it("passes any other storage failure through", async () => {
    const broken = createChallengeAccessor({
      challengeDao: {
        get: async () => {
          throw new Error("down");
        },
      },
    });

    await expect(broken.get("x")).rejects.toThrow("down");
  });

  it("takes, answers, lists, moves and removes challenges through storage", async () => {
    const challenges = accessor();
    const { challengeId } = await challenges.add(fresh(), SLOTS);

    expect(
      await challenges.claim({
        challengeId,
        acceptedBy: GUEST,
        acceptedName: "G",
        at: T0 + 1,
        staleBefore: T0,
      }),
    ).toBe(true);
    expect((await challenges.get(challengeId)).endedAt).toBe(T0 + 1);
    expect(await challenges.release({ challengeId, acceptedBy: GUEST })).toBe(true);
    expect(
      await challenges.claim({
        challengeId,
        acceptedBy: GUEST,
        acceptedName: "G",
        at: T0 + 2,
        staleBefore: T0,
      }),
    ).toBe(true);
    expect(await challenges.setRoom({ challengeId, acceptedBy: GUEST, roomCode: "AB2CD3" })).toBe(true);
    expect(
      await challenges.end({ challengeId, state: CHALLENGE_STATES.WITHDRAWN, at: T0 + 3, staleBefore: T0 }),
    ).toBe(false);
    expect(await challenges.addLater({ challengeId, playerId: RIYA })).toBe(true);
    expect((await challenges.listFrom(RIYA)).map((each) => each.roomCode)).toEqual(["AB2CD3"]);
    expect(await challenges.listTo(RIYA)).toEqual([]);
    expect(await challenges.movePlayer({ from: GUEST, to: "user_ffffffffffffffffffffffff" })).toBe(1);
    expect(await challenges.removeInvolving(RIYA)).toBe(1);
    const other = await challenges.add(fresh({ challengeId: "0123456789abcdefghjm" }), SLOTS);
    expect(await challenges.remove(other.challengeId)).toBe(true);
  });

  it("stores each open challenge of a sender in a place of its own, and refuses one when every place is held (CC-337)", async () => {
    const challenges = accessor();
    const ids = ["0123456789abcdefghj0", "0123456789abcdefghj1", "0123456789abcdefghj2"];

    const made = await Promise.allSettled(
      ids.map((challengeId) => challenges.add(fresh({ challengeId }), { openSlots: 2, recentMs: 600_000 })),
    );

    expect(made.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(made[2].reason).toBeInstanceOf(ConflictError);
    expect(made[2].reason.details).toEqual({ field: "openSlot", openSlots: 2 });
    expect(made[0].value).not.toHaveProperty("openSlot");
    // Withdrawn, the first lets go of its place for the next one.
    await challenges.end({
      challengeId: ids[0],
      state: CHALLENGE_STATES.WITHDRAWN,
      at: T0 + 1,
      staleBefore: T0,
    });
    expect(
      (
        await challenges.add(fresh({ challengeId: ids[2], createdAt: T0 + 2 }), {
          openSlots: 2,
          recentMs: 600_000,
        })
      ).challengeId,
    ).toBe(ids[2]);
  });

  it("passes on a duplicate id, which is not a full place", async () => {
    const challenges = accessor();
    await challenges.add(fresh(), SLOTS);

    await expect(challenges.add(fresh(), SLOTS)).rejects.toMatchObject({
      constructor: DuplicateKey,
      field: "challengeId",
    });
  });

  it("keeps one recent challenge to each person, and lets go of its mark once it is old (CC-337)", async () => {
    const challenges = accessor();
    const toArjun = (challengeId, createdAt) =>
      fresh({ challengeId, toId: "user_ffffffffffffffffffffffff", toName: "Arjun", createdAt });
    await challenges.add(toArjun("0123456789abcdefghj0", T0), SLOTS);

    const refused = await challenges.add(toArjun("0123456789abcdefghj1", T0 + 1), SLOTS).catch((err) => err);

    expect(refused).toBeInstanceOf(ConflictError);
    expect(refused.details).toEqual({ field: "recentTo" });
    expect(refused.cause).toMatchObject({ constructor: DuplicateKey, field: "recentTo" });
    const later = await challenges.add(toArjun("0123456789abcdefghj1", T0 + 600_000), SLOTS);
    expect(later).not.toHaveProperty("recentTo");
  });
});
