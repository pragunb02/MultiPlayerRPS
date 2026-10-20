import { describe, expect, it } from "vitest";
import { CHALLENGE_STATES } from "@classicade/shared";
import { createInMemoryChallengeDao } from "../testing/inMemoryChallengeDao.js";
import { NotFoundError } from "../utils/errors.js";
import { createChallengeAccessor } from "./challengeAccessor.js";

const RIYA = "user_0123456789abcdef01234567";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";
const T0 = Date.UTC(2026, 9, 20, 12);

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

    const stored = await challenges.add(fresh());

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
    const { challengeId } = await challenges.add(fresh());

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
    const other = await challenges.add(fresh({ challengeId: "0123456789abcdefghjm" }));
    expect(await challenges.remove(other.challengeId)).toBe(true);
  });
});
