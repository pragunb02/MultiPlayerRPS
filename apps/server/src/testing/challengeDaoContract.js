import { expect, it } from "vitest";
import { CHALLENGE_STATES } from "@classicade/shared";
import { DuplicateKey } from "../persistence/errors.js";

const T0 = new Date(Date.UTC(2026, 9, 20, 12));
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
const DAY_SECONDS = 24 * 60 * 60;
const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

let counter = 0;
/**
 * A challenge record as the accessor writes it, open for a day, with a fresh id and a place for open challenges of
 * its own unless they are given.
 */
export const challengeRecord = ({ fromId = RIYA, toId, seconds = 0, challengeId, openSlot } = {}) => ({
  challengeId: challengeId ?? `c${String(++counter).padStart(19, "0")}`,
  openSlot: openSlot ?? counter,
  fromId,
  fromName: "Riya",
  fromPublic: true,
  ...(toId !== undefined && { toId, toName: "Arjun" }),
  gameId: "chess",
  options: { timeControl: "5+0" },
  state: CHALLENGE_STATES.OPEN,
  createdAt: at(seconds),
  expiresAt: at(seconds + DAY_SECONDS),
  deleteAt: at(seconds + 2 * DAY_SECONDS),
});

/**
 * Behaviour every challenge DAO must have (CC-139): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/challengeDao.js").createChallengeDao>>} createDao
 */
export function runChallengeDaoContract(createDao) {
  it("stores a challenge and reads it back, with empty defaults for what is not known yet", async () => {
    const dao = await createDao();
    const challenge = challengeRecord();

    const stored = await dao.insert(challenge);

    expect(stored).toEqual({
      ...challenge,
      toId: "",
      toName: "",
      acceptedBy: "",
      acceptedName: "",
      roomCode: "",
      laterBy: [],
    });
    expect(await dao.get(challenge.challengeId)).toEqual(stored);
  });

  it("refuses a second challenge with the same id, and throws for an unknown one", async () => {
    const dao = await createDao();
    const challenge = challengeRecord();
    await dao.insert(challenge);

    await expect(dao.insert(challengeRecord({ challengeId: challenge.challengeId }))).rejects.toThrow(
      DuplicateKey,
    );
    await expect(dao.get("nobody00000000000000")).rejects.toThrow(RangeError);
  });

  it("lists a player's own challenges and the ones sent to them, newest first", async () => {
    const dao = await createDao();
    const older = await dao.insert(challengeRecord({ toId: ARJUN, seconds: 1 }));
    const newer = await dao.insert(challengeRecord({ seconds: 2 }));
    const theirs = await dao.insert(challengeRecord({ fromId: ARJUN, toId: RIYA, seconds: 3 }));

    expect((await dao.listFrom(RIYA)).map((doc) => doc.challengeId)).toEqual([
      newer.challengeId,
      older.challengeId,
    ]);
    expect((await dao.listTo(RIYA)).map((doc) => doc.challengeId)).toEqual([theirs.challengeId]);
    expect(await dao.listTo(GUEST)).toEqual([]);
  });

  it("lets one player take an open challenge, and nobody after them", async () => {
    const dao = await createDao();
    const { challengeId } = await dao.insert(challengeRecord());

    const first = await dao.claim({
      challengeId,
      acceptedBy: GUEST,
      acceptedName: "Guest-T001",
      at: at(5),
      staleBefore: at(5 - 30),
    });
    const second = await dao.claim({
      challengeId,
      acceptedBy: ARJUN,
      acceptedName: "Arjun",
      at: at(6),
      staleBefore: at(6 - 30),
    });

    expect([first, second]).toEqual([true, false]);
    expect(await dao.get(challengeId)).toMatchObject({
      state: CHALLENGE_STATES.ACCEPTED,
      acceptedBy: GUEST,
      acceptedName: "Guest-T001",
      endedAt: at(5),
    });
  });

  it("never lets anyone take a challenge after it expired", async () => {
    const dao = await createDao();
    const { challengeId } = await dao.insert(challengeRecord());

    expect(
      await dao.claim({
        challengeId,
        acceptedBy: GUEST,
        acceptedName: "G",
        at: at(DAY_SECONDS),
        staleBefore: at(DAY_SECONDS - 30),
      }),
    ).toBe(false);
    expect(
      await dao.end({
        challengeId,
        state: CHALLENGE_STATES.WITHDRAWN,
        at: at(DAY_SECONDS),
        staleBefore: at(DAY_SECONDS - 30),
      }),
    ).toBe(false);
  });

  it("opens a taken challenge again only while it has no room, and only for the one who took it", async () => {
    const dao = await createDao();
    const { challengeId } = await dao.insert(challengeRecord());
    await dao.claim({
      challengeId,
      acceptedBy: GUEST,
      acceptedName: "G",
      at: at(5),
      staleBefore: at(5 - 30),
    });

    expect(await dao.release({ challengeId, acceptedBy: ARJUN })).toBe(false);
    expect(await dao.release({ challengeId, acceptedBy: GUEST })).toBe(true);
    const open = await dao.get(challengeId);
    expect(open).toMatchObject({ state: CHALLENGE_STATES.OPEN, acceptedBy: "", acceptedName: "" });
    expect(open.endedAt).toBeUndefined();

    await dao.claim({
      challengeId,
      acceptedBy: ARJUN,
      acceptedName: "Arjun",
      at: at(6),
      staleBefore: at(6 - 30),
    });
    expect(await dao.setRoom({ challengeId, acceptedBy: GUEST, roomCode: "AB2CD3" })).toBe(false);
    expect(await dao.setRoom({ challengeId, acceptedBy: ARJUN, roomCode: "AB2CD3" })).toBe(true);
    expect(await dao.setRoom({ challengeId, acceptedBy: ARJUN, roomCode: "ZZ2CD3" })).toBe(false);
    expect(await dao.release({ challengeId, acceptedBy: ARJUN })).toBe(false);
    expect((await dao.get(challengeId)).roomCode).toBe("AB2CD3");
  });

  it("ends an open challenge once, as declined or withdrawn", async () => {
    const dao = await createDao();
    const { challengeId } = await dao.insert(challengeRecord({ toId: ARJUN }));

    expect(
      await dao.end({ challengeId, state: CHALLENGE_STATES.DECLINED, at: at(9), staleBefore: at(9 - 30) }),
    ).toBe(true);
    expect(
      await dao.end({ challengeId, state: CHALLENGE_STATES.WITHDRAWN, at: at(10), staleBefore: at(10 - 30) }),
    ).toBe(false);
    expect(await dao.get(challengeId)).toMatchObject({ state: CHALLENGE_STATES.DECLINED, endedAt: at(9) });
  });

  it("notes each player who moved a challenge to their inbox once", async () => {
    const dao = await createDao();
    const { challengeId } = await dao.insert(challengeRecord({ toId: ARJUN }));

    expect(await dao.addLater({ challengeId, playerId: ARJUN })).toBe(true);
    expect(await dao.addLater({ challengeId, playerId: ARJUN })).toBe(false);
    await dao.addLater({ challengeId, playerId: RIYA });

    expect((await dao.get(challengeId)).laterBy).toEqual([ARJUN, RIYA]);
  });

  it("moves every mention of a guest to their account", async () => {
    const dao = await createDao();
    const made = await dao.insert(challengeRecord({ fromId: GUEST }));
    const sent = await dao.insert(challengeRecord({ fromId: RIYA, toId: GUEST }));
    await dao.addLater({ challengeId: sent.challengeId, playerId: GUEST });
    const taken = await dao.insert(challengeRecord({ fromId: RIYA }));
    await dao.claim({
      challengeId: taken.challengeId,
      acceptedBy: GUEST,
      acceptedName: "G",
      at: at(1),
      staleBefore: at(1 - 30),
    });
    await dao.insert(challengeRecord({ fromId: RIYA }));

    const moved = await dao.movePlayer({ from: GUEST, to: ARJUN });

    expect(moved).toBe(4);
    expect((await dao.get(made.challengeId)).fromId).toBe(ARJUN);
    expect(await dao.get(sent.challengeId)).toMatchObject({ toId: ARJUN, laterBy: [ARJUN] });
    expect((await dao.get(taken.challengeId)).acceptedBy).toBe(ARJUN);
    expect(await dao.movePlayer({ from: GUEST, to: ARJUN })).toBe(0);
  });

  it("deletes every challenge a player made, was sent or took, and nobody else's", async () => {
    const dao = await createDao();
    await dao.insert(challengeRecord({ fromId: GUEST }));
    await dao.insert(challengeRecord({ fromId: RIYA, toId: GUEST }));
    const taken = await dao.insert(challengeRecord({ fromId: RIYA }));
    await dao.claim({
      challengeId: taken.challengeId,
      acceptedBy: GUEST,
      acceptedName: "G",
      at: at(1),
      staleBefore: at(1 - 30),
    });
    const kept = await dao.insert(challengeRecord({ fromId: RIYA, toId: ARJUN }));

    expect(await dao.deleteInvolving(GUEST)).toBe(3);
    expect(await dao.deleteInvolving(GUEST)).toBe(0);
    expect((await dao.listFrom(RIYA)).map((doc) => doc.challengeId)).toEqual([kept.challengeId]);
  });
  it("lets someone take a challenge whose hold is stale, and never one held a moment ago", async () => {
    const dao = await createDao();
    const { challengeId } = await dao.insert(challengeRecord());
    await dao.claim({ challengeId, acceptedBy: GUEST, acceptedName: "G", at: at(5), staleBefore: at(-25) });

    const early = await dao.claim({
      challengeId,
      acceptedBy: ARJUN,
      acceptedName: "Arjun",
      at: at(20),
      staleBefore: at(-10),
    });
    const late = await dao.claim({
      challengeId,
      acceptedBy: ARJUN,
      acceptedName: "Arjun",
      at: at(40),
      staleBefore: at(10),
    });

    expect([early, late]).toEqual([false, true]);
    expect(await dao.get(challengeId)).toMatchObject({ acceptedBy: ARJUN, endedAt: at(40) });
  });

  it("ends a challenge whose hold is stale, and drops the hold", async () => {
    const dao = await createDao();
    const { challengeId } = await dao.insert(challengeRecord());
    await dao.claim({ challengeId, acceptedBy: GUEST, acceptedName: "G", at: at(5), staleBefore: at(-25) });

    expect(
      await dao.end({ challengeId, state: CHALLENGE_STATES.WITHDRAWN, at: at(40), staleBefore: at(10) }),
    ).toBe(true);
    expect(await dao.get(challengeId)).toMatchObject({
      state: CHALLENGE_STATES.WITHDRAWN,
      acceptedBy: "",
      acceptedName: "",
    });
  });

  it("deletes one challenge by its id", async () => {
    const dao = await createDao();
    const { challengeId } = await dao.insert(challengeRecord());

    expect(await dao.remove(challengeId)).toBe(true);
    expect(await dao.remove(challengeId)).toBe(false);
    await expect(dao.get(challengeId)).rejects.toThrow(RangeError);
  });

  it("keeps one challenge in each place of a sender, and the same place free for anyone else (CC-337)", async () => {
    const dao = await createDao();
    await dao.insert(challengeRecord({ openSlot: 0 }));

    const results = await Promise.allSettled([
      dao.insert(challengeRecord({ openSlot: 1 })),
      dao.insert(challengeRecord({ openSlot: 1 })),
    ]);

    await expect(dao.insert(challengeRecord({ openSlot: 0 }))).rejects.toMatchObject({
      constructor: DuplicateKey,
      field: "openSlot",
    });
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected").reason.field).toBe("openSlot");
    expect((await dao.insert(challengeRecord({ fromId: ARJUN, openSlot: 0 }))).openSlot).toBe(0);
    const taken = await dao.insert(challengeRecord({ openSlot: 2 }));
    await expect(
      dao.insert(challengeRecord({ challengeId: taken.challengeId, openSlot: 3 })),
    ).rejects.toMatchObject({ field: "challengeId" });
  });

  it("lets go of the places of challenges that can never be open again, and keeps every other one", async () => {
    const dao = await createDao();
    const open = await dao.insert(challengeRecord({ openSlot: 0 }));
    const declined = await dao.insert(challengeRecord({ openSlot: 1 }));
    const withdrawn = await dao.insert(challengeRecord({ openSlot: 2 }));
    const holding = await dao.insert(challengeRecord({ openSlot: 3 }));
    const roomMade = await dao.insert(challengeRecord({ openSlot: 4 }));
    const expired = await dao.insert(challengeRecord({ seconds: -DAY_SECONDS, openSlot: 5 }));
    const others = await dao.insert(challengeRecord({ fromId: ARJUN, seconds: -DAY_SECONDS, openSlot: 0 }));
    const stale = at(1 - 30);
    await dao.end({
      challengeId: declined.challengeId,
      state: CHALLENGE_STATES.DECLINED,
      at: at(1),
      staleBefore: stale,
    });
    await dao.end({
      challengeId: withdrawn.challengeId,
      state: CHALLENGE_STATES.WITHDRAWN,
      at: at(1),
      staleBefore: stale,
    });
    for (const { challengeId } of [holding, roomMade]) {
      await dao.claim({ challengeId, acceptedBy: GUEST, acceptedName: "G", at: at(1), staleBefore: stale });
    }
    await dao.setRoom({ challengeId: roomMade.challengeId, acceptedBy: GUEST, roomCode: "AB2CD3" });

    expect(await dao.freeSlots({ fromId: RIYA, at: at(2), recentBefore: at(-DAY_SECONDS * 2) })).toBe(4);
    expect(await dao.freeSlots({ fromId: RIYA, at: at(2), recentBefore: at(-DAY_SECONDS * 2) })).toBe(0);

    const slotOf = async ({ challengeId }) => (await dao.get(challengeId)).openSlot;
    expect(
      await Promise.all([open, declined, withdrawn, holding, roomMade, expired, others].map(slotOf)),
    ).toEqual([0, undefined, undefined, 3, undefined, undefined, 0]);
    expect((await dao.insert(challengeRecord({ openSlot: 1 }))).openSlot).toBe(1);
  });

  it("moves a guest's places to their account, except a place the account holds already", async () => {
    const dao = await createDao();
    const kept = await dao.insert(challengeRecord({ fromId: GUEST, openSlot: 1 }));
    const clash = await dao.insert(challengeRecord({ fromId: GUEST, openSlot: 0 }));
    const own = await dao.insert(challengeRecord({ fromId: ARJUN, openSlot: 0 }));

    expect(await dao.movePlayer({ from: GUEST, to: ARJUN })).toBe(2);

    expect(await dao.get(kept.challengeId)).toMatchObject({ fromId: ARJUN, openSlot: 1 });
    expect(await dao.get(clash.challengeId)).toMatchObject({ fromId: ARJUN });
    expect((await dao.get(clash.challengeId)).openSlot).toBeUndefined();
    expect((await dao.get(own.challengeId)).openSlot).toBe(0);
  });

  it("keeps one recent challenge from a sender to each person, and lets go of marks made before a moment", async () => {
    const dao = await createDao();
    const first = await dao.insert({ ...challengeRecord({ toId: ARJUN }), recentTo: true });

    const results = await Promise.allSettled([
      dao.insert({ ...challengeRecord({ toId: ARJUN, seconds: 1 }), recentTo: true }),
      dao.insert({ ...challengeRecord({ toId: ARJUN, seconds: 1 }), recentTo: true }),
    ]);

    expect(results.map((result) => result.reason?.field)).toEqual(["recentTo", "recentTo"]);
    expect((await dao.insert(challengeRecord({ toId: ARJUN, seconds: 2 }))).recentTo).toBeUndefined();
    expect((await dao.insert({ ...challengeRecord({ toId: GUEST }), recentTo: true })).recentTo).toBe(true);
    expect(
      (await dao.insert({ ...challengeRecord({ fromId: GUEST, toId: ARJUN }), recentTo: true })).recentTo,
    ).toBe(true);
    expect(await dao.freeSlots({ fromId: RIYA, at: at(3), recentBefore: at(-1) })).toBe(0);
    expect(await dao.freeSlots({ fromId: RIYA, at: at(3), recentBefore: at(0) })).toBe(2);
    expect((await dao.get(first.challengeId)).recentTo).toBeUndefined();
    expect(
      (await dao.insert({ ...challengeRecord({ toId: ARJUN, seconds: 3 }), recentTo: true })).recentTo,
    ).toBe(true);
  });

  it("moves a guest's marks to their account, except a mark the account holds already", async () => {
    const dao = await createDao();
    const fromGuest = await dao.insert({ ...challengeRecord({ fromId: GUEST, toId: RIYA }), recentTo: true });
    const clash = await dao.insert({ ...challengeRecord({ fromId: GUEST, toId: ARJUN }), recentTo: true });
    await dao.insert({
      ...challengeRecord({ fromId: "user_aaaaaaaaaaaaaaaaaaaaaaaa", toId: ARJUN }),
      recentTo: true,
    });
    const toGuest = await dao.insert({ ...challengeRecord({ toId: GUEST }), recentTo: true });
    await dao.insert({ ...challengeRecord({ toId: "user_aaaaaaaaaaaaaaaaaaaaaaaa" }), recentTo: true });

    expect(await dao.movePlayer({ from: GUEST, to: "user_aaaaaaaaaaaaaaaaaaaaaaaa" })).toBe(3);

    expect(await dao.get(fromGuest.challengeId)).toMatchObject({ recentTo: true });
    const moved = await dao.get(clash.challengeId);
    expect(moved.recentTo).toBeUndefined();
    expect(moved.openSlot).toBe(clash.openSlot);
    const sent = await dao.get(toGuest.challengeId);
    expect(sent).toMatchObject({ toId: "user_aaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(sent.recentTo).toBeUndefined();
  });
}
