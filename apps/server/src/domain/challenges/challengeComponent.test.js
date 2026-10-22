import { describe, expect, it } from "vitest";
import {
  CHALLENGE_LIMIT_REASONS,
  CHALLENGE_REFUSALS,
  CHALLENGE_STATES,
  isChallengeId,
} from "@classicade/shared";
import { createChallengeAccessor } from "../../data/challengeAccessor.js";
import { safetyFromAdults } from "../../testing/fakeSafety.js";
import { createInMemoryChallengeDao } from "../../testing/inMemoryChallengeDao.js";
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors.js";
import { CHALLENGE_EVENTS, createChallengeComponent, stateAt } from "./challengeComponent.js";

const RIYA = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
const ARJUN = Object.freeze({ kind: "user", id: "user_ffffffffffffffffffffffff", displayName: "Arjun" });
const GUEST = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000001",
  displayName: "Guest-T001",
});
const CARA = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000002",
  displayName: "Guest-T002",
});
const T0 = Date.UTC(2026, 9, 20, 12);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const CHESS = Object.freeze({ timeControl: "5+0" });

/** Riya is an adult account. Everyone named in `to` targets is found by that name. */
function setup({ blocked = [], adults = [RIYA.id], rooms: roomOverrides = {}, named = true } = {}) {
  const emitted = [];
  const madeRooms = [];
  let ids = 0;
  const dao = { ...createInMemoryChallengeDao() };
  const accessor = createChallengeAccessor({ challengeDao: dao });
  const rooms = {
    checkOptions: ({ gameId, options }) => {
      if (gameId !== "chess") throw new ValidationError("That game is not available");
      return { timeControl: "5+0", ...options };
    },
    createChallengeRoom: async (input) => {
      madeRooms.push(input);
      return { code: `ROOM0${madeRooms.length}`, gameId: input.gameId };
    },
    ...roomOverrides,
  };
  const people = [RIYA, ARJUN, GUEST, CARA];
  const challenges = createChallengeComponent({
    challengeAccessor: accessor,
    rooms,
    blocks: {
      blockedWith: async ({ playerId }) =>
        new Set(blocked.flatMap(([a, b]) => (a === playerId ? [b] : b === playerId ? [a] : []))),
    },
    safety: safetyFromAdults(({ playerIds }) => playerIds.filter((id) => adults.includes(id))),
    events: { emit: (event, payload) => emitted.push({ event, ...payload }) },
    ...(named && {
      recipients: {
        resolve: async ({ target }) => {
          const person = people.find((each) => each.displayName === target);
          if (person === undefined) throw new NotFoundError("We couldn't find that player");
          return { id: person.id, displayName: person.displayName };
        },
      },
    }),
    newId: () => `c${String(++ids).padStart(19, "0")}`,
  });
  const make = (fields = {}) =>
    challenges.create({ from: RIYA, gameId: "chess", options: CHESS, now: T0, ...fields });
  const accept = (id, player = GUEST, now = T0 + MINUTE) =>
    challenges.accept({ challengeId: id, player, network: "net-g", now });
  return { challenges, make, accept, emitted, madeRooms, dao, accessor };
}

describe("challengeComponent: making a challenge (CC-139)", () => {
  it("needs its collaborators", () => {
    expect(() => createChallengeComponent({})).toThrow(TypeError);
  });

  it("makes a link anyone can take, open for a day, and tells only its creator", async () => {
    const { make, emitted } = setup();

    const view = await make();

    expect(view).toEqual({
      id: "c0000000000000000001",
      gameId: "chess",
      options: { timeControl: "5+0" },
      createdAt: T0,
      fromName: "Riya",
      own: true,
      forYou: false,
      took: false,
      later: false,
      state: CHALLENGE_STATES.OPEN,
      expiresAt: T0 + DAY,
    });
    expect(emitted.map(({ event, playerIds }) => ({ event, playerIds }))).toEqual([
      { event: CHALLENGE_EVENTS.CHANGED, playerIds: [RIYA.id] },
    ]);
  });

  it("gets a real random id by default", async () => {
    const challenges = createChallengeComponent({
      challengeAccessor: createChallengeAccessor({ challengeDao: createInMemoryChallengeDao() }),
      rooms: { checkOptions: () => ({}), createChallengeRoom: async () => ({}) },
      blocks: { blockedWith: async () => new Set() },
      safety: safetyFromAdults(() => []),
      events: { emit() {} },
    });

    const view = await challenges.create({ from: GUEST, gameId: "rps", options: {}, now: T0 });

    expect(isChallengeId(view.id)).toBe(true);
  });

  it("refuses a game or options the room would refuse", async () => {
    const { make } = setup();

    await expect(make({ gameId: "ludo" })).rejects.toThrow(ValidationError);
  });

  it("allows 3 open challenges per sender, and an expired or withdrawn one no longer counts", async () => {
    const { make, challenges } = setup();
    const first = await make();
    await make();
    await make();

    const refused = await make().catch((err) => err);
    expect(refused).toBeInstanceOf(ConflictError);
    expect(refused.details).toEqual({ reason: CHALLENGE_LIMIT_REASONS.OPEN, limit: 3 });

    await challenges.withdraw({ challengeId: first.id, playerId: RIYA.id, now: T0 + 1 });
    await expect(make({ now: T0 + 2 })).resolves.toMatchObject({ state: CHALLENGE_STATES.OPEN });
    await expect(make({ now: T0 + DAY })).resolves.toMatchObject({ state: CHALLENGE_STATES.OPEN });
  });
});

describe("challengeComponent: a challenge to one person (ready for CC-052)", () => {
  it("names nobody until CC-052 says who may be named", async () => {
    const { make } = setup({ named: false });

    await expect(make({ to: "Arjun" })).rejects.toThrow(NotFoundError);
  });

  it("is delivered to that person, who sees it is for them, and its creator sees their name", async () => {
    const { make, challenges, emitted } = setup();

    const own = await make({ to: "Arjun" });
    const theirs = await challenges.view({ challengeId: own.id, viewerId: ARJUN.id, now: T0 + 1 });

    expect(own).toMatchObject({ toName: "Arjun", forYou: false });
    expect(theirs).toMatchObject({ forYou: true, own: false, fromName: "Riya" });
    expect(theirs.toName).toBeUndefined();
    expect(emitted.at(-1).playerIds).toEqual([RIYA.id, ARJUN.id]);
  });

  it("refuses yourself, and a second one to the same person within 10 minutes", async () => {
    const { make } = setup();
    await expect(make({ to: "Riya" })).rejects.toThrow(ValidationError);
    await make({ to: "Arjun" });

    const soon = await make({ to: "Arjun", now: T0 + 9 * MINUTE }).catch((err) => err);

    expect(soon).toBeInstanceOf(ConflictError);
    expect(soon.details).toEqual({ reason: CHALLENGE_LIMIT_REASONS.SAME_PERSON, retryAt: T0 + 10 * MINUTE });
    await expect(make({ to: "Arjun", now: T0 + 10 * MINUTE })).resolves.toMatchObject({ toName: "Arjun" });
    await expect(make({ to: "Guest-T001", now: T0 + 1 })).resolves.toMatchObject({ toName: "Guest-T001" });
  });

  it("can be declined only by that person, once, and its creator hears it", async () => {
    const { make, challenges, emitted } = setup();
    const { id } = await make({ to: "Arjun" });

    await expect(challenges.decline({ challengeId: id, playerId: GUEST.id, now: T0 + 1 })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      challenges.decline({ challengeId: id, playerId: GUEST.id, now: T0 + 1 }),
    ).rejects.toMatchObject({
      details: { reason: CHALLENGE_REFUSALS.NOT_FOR_YOU },
    });
    const declined = await challenges.decline({ challengeId: id, playerId: ARJUN.id, now: T0 + 2 });

    expect(declined.state).toBe(CHALLENGE_STATES.DECLINED);
    expect(emitted.at(-1).playerIds).toEqual([RIYA.id, ARJUN.id]);
    const again = await challenges
      .decline({ challengeId: id, playerId: ARJUN.id, now: T0 + 3 })
      .catch((e) => e);
    expect(again).toBeInstanceOf(GoneError);
    expect(again.details).toEqual({ state: CHALLENGE_STATES.DECLINED });
  });

  it("cannot be declined when it is a link for anyone", async () => {
    const { make, challenges } = setup();
    const { id } = await make();

    await expect(challenges.decline({ challengeId: id, playerId: GUEST.id, now: T0 + 1 })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("can be taken only by that person", async () => {
    const { make, accept } = setup();
    const { id } = await make({ to: "Arjun" });

    await expect(accept(id, GUEST)).rejects.toThrow(ForbiddenError);
    await expect(accept(id, GUEST)).rejects.toMatchObject({
      details: { reason: CHALLENGE_REFUSALS.NOT_FOR_YOU },
    });
    await expect(accept(id, ARJUN)).resolves.toMatchObject({ room: { code: "ROOM01" } });
  });

  it("answers a lost race to decline with how it ended", async () => {
    const { make, challenges, dao } = setup();
    const { id } = await make({ to: "Arjun" });
    const end = dao.end;
    dao.end = async (input) => {
      await end({ ...input, state: CHALLENGE_STATES.WITHDRAWN });
      return false;
    };

    const lost = await challenges
      .decline({ challengeId: id, playerId: ARJUN.id, now: T0 + 1 })
      .catch((e) => e);

    expect(lost.details).toEqual({ state: CHALLENGE_STATES.WITHDRAWN });
  });
});

describe("challengeComponent: names on a link (ADR-028.7)", () => {
  it("shows the creator's name to anyone only for an adult account", async () => {
    const { challenges } = setup({ adults: [RIYA.id] });
    const adult = await challenges.create({ from: RIYA, gameId: "chess", options: {}, now: T0 });
    const guest = await challenges.create({ from: GUEST, gameId: "chess", options: {}, now: T0 });
    const unknownAge = await challenges.create({ from: ARJUN, gameId: "chess", options: {}, now: T0 });

    const seen = async (id, viewerId = CARA.id) =>
      (await challenges.view({ challengeId: id, viewerId, now: T0 + 1 })).fromName;

    expect(await seen(adult.id)).toBe("Riya");
    expect(await seen(guest.id)).toBe("");
    expect(await seen(unknownAge.id, "")).toBe("");
    expect(await seen(guest.id, GUEST.id)).toBe("Guest-T001");
  });
});

describe("challengeComponent: what a challenge shows over its day", () => {
  it("is expired from the moment its day is over, without anything sweeping", async () => {
    const { make, challenges, accept } = setup();
    const { id } = await make();

    const view = await challenges.view({ challengeId: id, viewerId: GUEST.id, now: T0 + DAY });

    expect(view.state).toBe(CHALLENGE_STATES.EXPIRED);
    expect(view.expiresAt).toBeUndefined();
    const late = await accept(id, GUEST, T0 + DAY).catch((err) => err);
    expect(late).toBeInstanceOf(GoneError);
    expect(late.details).toEqual({ state: CHALLENGE_STATES.EXPIRED });
    expect(late.message).toBe("This challenge has expired");
  });

  it("gives each player named in an event their own view of the challenge", async () => {
    const { make, challenges, emitted } = setup();
    await make({ to: "Arjun" });
    const { challenge, playerIds } = emitted.at(-1);

    const views = playerIds.map((playerId) => challenges.viewFor(challenge, playerId, T0 + 1));

    expect(views.map(({ own, forYou }) => ({ own, forYou }))).toEqual([
      { own: true, forYou: false },
      { own: false, forYou: true },
    ]);
  });

  it("answers NotFoundError for a challenge that does not exist", async () => {
    const { challenges } = setup();

    await expect(
      challenges.view({ challengeId: "nobody00000000000000", viewerId: "", now: T0 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("works out the state of a stored challenge at a moment", () => {
    const stored = { state: CHALLENGE_STATES.OPEN, expiresAt: T0 };
    expect(stateAt(stored, T0 - 1)).toBe(CHALLENGE_STATES.OPEN);
    expect(stateAt(stored, T0)).toBe(CHALLENGE_STATES.EXPIRED);
    expect(stateAt({ state: CHALLENGE_STATES.DECLINED, expiresAt: T0 }, T0 + 1)).toBe(
      CHALLENGE_STATES.DECLINED,
    );
  });
});

describe("challengeComponent: taking a challenge", () => {
  it("makes a room with the challenger, the taker and the challenge's options", async () => {
    const { make, accept, madeRooms } = setup();
    const { id } = await make();

    const taken = await accept(id);

    expect(madeRooms).toEqual([
      {
        challenger: { id: RIYA.id, displayName: "Riya" },
        accepter: GUEST,
        network: "net-g",
        earlierNetworks: [],
        gameId: "chess",
        options: { timeControl: "5+0" },
        now: T0 + MINUTE,
      },
    ]);
    expect(taken.room).toEqual({ code: "ROOM01", gameId: "chess" });
    expect(taken.challenge).toMatchObject({
      state: CHALLENGE_STATES.ACCEPTED,
      took: true,
      room: { code: "ROOM01", gameId: "chess" },
    });
    expect(taken.challenge.acceptedName).toBeUndefined();
  });

  it("tells its creator who took it and where to go, and anyone else only that it was taken", async () => {
    const { make, accept, challenges, emitted } = setup();
    const { id } = await make();
    await accept(id);

    const own = await challenges.view({ challengeId: id, viewerId: RIYA.id, now: T0 + 2 * MINUTE });
    const other = await challenges.view({ challengeId: id, viewerId: CARA.id, now: T0 + 2 * MINUTE });

    expect(own).toMatchObject({ acceptedName: "Guest-T001", room: { code: "ROOM01" } });
    expect(other.state).toBe(CHALLENGE_STATES.ACCEPTED);
    expect(other.room).toBeUndefined();
    expect(other.acceptedName).toBeUndefined();
    expect(emitted.at(-1).playerIds).toEqual([RIYA.id, GUEST.id]);
  });

  it("can be taken by one person only, and never by its creator", async () => {
    const { make, accept } = setup();
    const { id } = await make();

    await expect(accept(id, RIYA)).rejects.toThrow(ForbiddenError);
    await expect(accept(id, RIYA)).rejects.toMatchObject({ details: { reason: CHALLENGE_REFUSALS.OWN } });
    await accept(id, GUEST);
    const second = await accept(id, CARA).catch((err) => err);

    expect(second).toBeInstanceOf(GoneError);
    expect(second.details).toEqual({ state: CHALLENGE_STATES.ACCEPTED });
  });

  it("is open again when its room cannot be made, and the reason reaches the taker", async () => {
    const full = new ConflictError("You already have 3 rooms waiting");
    const { make, accept, challenges } = setup({
      rooms: {
        createChallengeRoom: async () => {
          throw full;
        },
      },
    });
    const { id } = await make();

    await expect(accept(id)).rejects.toBe(full);
    expect((await challenges.view({ challengeId: id, viewerId: CARA.id, now: T0 + 2 })).state).toBe(
      CHALLENGE_STATES.OPEN,
    );
  });

  it("answers a lost race with how it ended, or try again when it is open once more", async () => {
    const { make, accept, dao } = setup();
    const { id } = await make();
    dao.claim = async () => false;

    await expect(accept(id)).rejects.toThrow(ConflictError);
    await expect(accept(id)).rejects.toMatchObject({ details: { reason: CHALLENGE_REFUSALS.BEING_TAKEN } });
    await dao.end({ challengeId: id, state: CHALLENGE_STATES.WITHDRAWN, at: new Date(T0 + 1) });
    const lost = await accept(id).catch((err) => err);
    expect(lost).toBeInstanceOf(GoneError);
  });
});

describe("challengeComponent: withdrawing", () => {
  it("lets only its creator take it back while it is open", async () => {
    const { make, challenges } = setup();
    const { id } = await make();

    await expect(challenges.withdraw({ challengeId: id, playerId: GUEST.id, now: T0 + 1 })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      challenges.withdraw({ challengeId: id, playerId: GUEST.id, now: T0 + 1 }),
    ).rejects.toMatchObject({
      details: { reason: CHALLENGE_REFUSALS.NOT_YOURS },
    });
    const withdrawn = await challenges.withdraw({ challengeId: id, playerId: RIYA.id, now: T0 + 2 });
    expect(withdrawn.state).toBe(CHALLENGE_STATES.WITHDRAWN);

    const again = await challenges
      .withdraw({ challengeId: id, playerId: RIYA.id, now: T0 + 3 })
      .catch((e) => e);
    expect(again).toBeInstanceOf(GoneError);
    const taken = await setup().make();
    expect(taken.state).toBe(CHALLENGE_STATES.OPEN);
  });

  it("answers a lost race to withdraw with how it ended", async () => {
    const { make, challenges, dao, accept } = setup();
    const { id } = await make();
    dao.end = async () => {
      await accept(id);
      return false;
    };

    const lost = await challenges
      .withdraw({ challengeId: id, playerId: RIYA.id, now: T0 + 1 })
      .catch((e) => e);

    expect(lost.details).toEqual({ state: CHALLENGE_STATES.ACCEPTED });
  });
});

describe("challengeComponent: blocks never show (ADR-053)", () => {
  it("shows a blocked person exactly what an expired challenge shows, byte for byte", async () => {
    for (const [viewer, to] of [
      [GUEST, undefined],
      [ARJUN, "Arjun"],
    ]) {
      const blockedSetup = setup({ blocked: [[RIYA.id, viewer.id]] });
      const blockedView = await blockedSetup.challenges.view({
        challengeId: (await blockedSetup.make({ to })).id,
        viewerId: viewer.id,
        now: T0 + 1,
      });
      const expiredSetup = setup();
      const expiredView = await expiredSetup.challenges.view({
        challengeId: (await expiredSetup.make({ to })).id,
        viewerId: viewer.id,
        now: T0 + DAY,
      });

      expect(JSON.stringify(blockedView)).toBe(JSON.stringify(expiredView));
    }
  });

  it("gives a blocked person no time from which the challenge's age could be told", async () => {
    const { challenges, make } = setup({ blocked: [[RIYA.id, GUEST.id]] });
    const { id } = await make();

    const view = await challenges.view({ challengeId: id, viewerId: GUEST.id, now: T0 + 1 });

    expect(Object.values(view).filter((value) => typeof value === "number")).toEqual([]);
  });

  it("answers taking it exactly as an expired challenge answers", async () => {
    const { make, accept, madeRooms } = setup({ blocked: [[GUEST.id, RIYA.id]] });
    const { id } = await make();

    const refused = await accept(id).catch((err) => err);

    expect(refused).toBeInstanceOf(GoneError);
    expect(refused.message).toBe("This challenge has expired");
    expect(refused.details).toEqual({ state: CHALLENGE_STATES.EXPIRED });
    expect(madeRooms).toEqual([]);
  });

  it("never delivers a challenge to one person in a blocked pair, so it waits and expires for its sender", async () => {
    const { make, challenges, emitted } = setup({ blocked: [[RIYA.id, ARJUN.id]] });

    const own = await make({ to: "Arjun" });

    expect(emitted.at(-1).playerIds).toEqual([RIYA.id]);
    expect(await challenges.inbox({ playerId: ARJUN.id, now: T0 + 1 })).toEqual([]);
    expect(own.state).toBe(CHALLENGE_STATES.OPEN);
    const declined = await challenges
      .decline({ challengeId: own.id, playerId: ARJUN.id, now: T0 + 1 })
      .catch((e) => e);
    expect(declined.details).toEqual({ state: CHALLENGE_STATES.EXPIRED });
    const later = await challenges.later({ challengeId: own.id, playerId: ARJUN.id, now: T0 + 1 });
    expect(later).toMatchObject({ state: CHALLENGE_STATES.EXPIRED, later: false });
    expect(emitted).toHaveLength(1);
    expect((await challenges.view({ challengeId: own.id, viewerId: RIYA.id, now: T0 + DAY })).state).toBe(
      CHALLENGE_STATES.EXPIRED,
    );
  });
});

describe("challengeComponent: the inbox (CC-207, the minimal CC-147)", () => {
  it("moves a challenge to the player's inbox once, and tells only their own tabs", async () => {
    const { make, challenges, emitted } = setup();
    const { id } = await make({ to: "Arjun" });
    const before = emitted.length;

    const moved = await challenges.later({ challengeId: id, playerId: ARJUN.id, now: T0 + 1 });
    await challenges.later({ challengeId: id, playerId: ARJUN.id, now: T0 + 2 });

    expect(moved.later).toBe(true);
    expect(emitted.slice(before).map(({ playerIds }) => playerIds)).toEqual([[ARJUN.id]]);
    await expect(challenges.later({ challengeId: id, playerId: GUEST.id, now: T0 + 3 })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      challenges.later({ challengeId: id, playerId: GUEST.id, now: T0 + 3 }),
    ).rejects.toMatchObject({
      details: { reason: CHALLENGE_REFUSALS.NOT_FOR_YOU },
    });
    expect((await challenges.later({ challengeId: id, playerId: RIYA.id, now: T0 + 4 })).later).toBe(true);
  });

  it("lists open challenges, sent and received, and taken ones while their room waits, newest first", async () => {
    const { challenges, make, accept } = setup({ blocked: [[CARA.id, RIYA.id]] });
    const taken = await make({ now: T0 });
    await accept(taken.id, GUEST, T0 + 1);
    const open = await make({ now: T0 + 2 });
    const declined = await make({ to: "Arjun", now: T0 + 3 });
    await challenges.decline({ challengeId: declined.id, playerId: ARJUN.id, now: T0 + 4 });
    const received = await challenges.create({
      from: ARJUN,
      gameId: "chess",
      options: {},
      to: "Riya",
      now: T0 + 5,
    });
    await challenges.create({ from: CARA, gameId: "chess", options: {}, to: "Riya", now: T0 + 6 });

    const listed = await challenges.inbox({ playerId: RIYA.id, now: T0 + 10 });

    expect(listed.map((each) => each.id)).toEqual([received.id, open.id, taken.id]);
    expect(listed[2]).toMatchObject({
      acceptedName: "Guest-T001",
      room: { code: "ROOM01" },
      until: T0 + 1 + 30 * MINUTE,
    });
    const muchLater = await challenges.inbox({ playerId: RIYA.id, now: T0 + 31 * MINUTE });
    expect(muchLater.map((each) => each.id)).toEqual([received.id, open.id]);
    expect(await challenges.inbox({ playerId: RIYA.id, now: T0 + DAY + 10 })).toEqual([]);
  });
});

describe("challengeComponent: limits hold when challenges are made at the same moment", () => {
  it("keeps 3 of 4 challenges made at once, and stores no more", async () => {
    const { make, challenges } = setup();

    const results = await Promise.allSettled([make(), make(), make(), make()]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    const refused = results.find((result) => result.status === "rejected").reason;
    expect(refused).toBeInstanceOf(ConflictError);
    expect(refused.details.reason).toBe(CHALLENGE_LIMIT_REASONS.OPEN);
    expect(await challenges.inbox({ playerId: RIYA.id, now: T0 + 1 })).toHaveLength(3);
  });

  it("keeps one of two challenges made at once to the same person", async () => {
    const { make, challenges, emitted } = setup();

    const results = await Promise.allSettled([make({ to: "Arjun" }), make({ to: "Arjun" })]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected").reason.details.reason).toBe(
      CHALLENGE_LIMIT_REASONS.SAME_PERSON,
    );
    expect(await challenges.inbox({ playerId: ARJUN.id, now: T0 + 1 })).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });
});

describe("challengeComponent: the limit of open challenges after a guest signs in (CC-337)", () => {
  it("refuses a new one while the account is over the limit with the guest's, even with a place free", async () => {
    const { make, challenges } = setup();
    const own = [await make(), await make(), await make()];
    for (let made = 0; made < 3; made += 1) {
      await make({ from: GUEST, gameId: "chess", options: CHESS });
    }
    await challenges.transferPlayer({ from: GUEST.id, to: RIYA });
    await challenges.withdraw({ challengeId: own[0].id, playerId: RIYA.id, now: T0 + 1 });

    const refused = await make({ now: T0 + 2 }).catch((err) => err);

    expect(refused).toBeInstanceOf(ConflictError);
    expect(refused.details).toEqual({ reason: CHALLENGE_LIMIT_REASONS.OPEN, limit: 3 });
    expect(await challenges.inbox({ playerId: RIYA.id, now: T0 + 3 })).toHaveLength(5);
  });
});

describe("challengeComponent: challenges stored before CC-337, with no place or mark", () => {
  /** A challenge as stored before CC-337: open, from Riya, without `openSlot` or `recentTo`. */
  const legacy = (dao, n, fields = {}) =>
    dao.insert({
      challengeId: `old${String(n).padStart(17, "0")}`,
      fromId: RIYA.id,
      fromName: "Riya",
      fromPublic: true,
      gameId: "chess",
      options: CHESS,
      state: CHALLENGE_STATES.OPEN,
      createdAt: new Date(T0),
      expiresAt: new Date(T0 + DAY),
      deleteAt: new Date(T0 + 2 * DAY),
      ...fields,
    });

  it("counts them against the limit of open ones, so none is made while 3 are open", async () => {
    const { make, challenges, dao } = setup();
    for (const n of [1, 2, 3]) await legacy(dao, n);

    await expect(make({ now: T0 + 1 })).rejects.toMatchObject({
      details: { reason: CHALLENGE_LIMIT_REASONS.OPEN, limit: 3 },
    });
    expect(await challenges.inbox({ playerId: RIYA.id, now: T0 + 2 })).toHaveLength(3);
  });

  it("counts a recent one to the same person, and says when to try again", async () => {
    const { make, dao } = setup();
    await legacy(dao, 1, { toId: ARJUN.id, toName: "Arjun" });

    await expect(make({ to: "Arjun", now: T0 + MINUTE })).rejects.toMatchObject({
      details: { reason: CHALLENGE_LIMIT_REASONS.SAME_PERSON, retryAt: T0 + 10 * MINUTE },
    });
    expect((await make({ to: "Arjun", now: T0 + 10 * MINUTE })).forYou).toBe(false);
  });
});

describe("challengeComponent: a hold that never got its room (claim lease)", () => {
  /** Someone took it, and the process stopped before the room was recorded. */
  async function cutOff() {
    const parts = setup();
    const { id } = await parts.make();
    await parts.accessor.claim({
      challengeId: id,
      acceptedBy: CARA.id,
      acceptedName: "Guest-T002",
      at: T0 + 1,
      staleBefore: T0,
    });
    return { ...parts, id };
  }

  it("is taken for a moment, then open again once its lease is over", async () => {
    const { challenges, id, accept } = await cutOff();

    const during = await challenges.view({ challengeId: id, viewerId: GUEST.id, now: T0 + 20 * 1000 });
    expect(during.state).toBe(CHALLENGE_STATES.ACCEPTED);
    expect((await accept(id, GUEST, T0 + 20 * 1000).catch((err) => err)).details).toEqual({
      state: CHALLENGE_STATES.ACCEPTED,
    });

    const after = await challenges.view({ challengeId: id, viewerId: GUEST.id, now: T0 + 31 * 1000 });
    expect(after).toMatchObject({ state: CHALLENGE_STATES.OPEN, took: false });
    await expect(accept(id, GUEST, T0 + 31 * 1000)).resolves.toMatchObject({ room: { code: "ROOM01" } });
  });

  it("can be taken back by its creator once its lease is over, and shows in the inbox as open", async () => {
    const { challenges, id } = await cutOff();

    expect(
      (await challenges.inbox({ playerId: RIYA.id, now: T0 + 31 * 1000 })).map((each) => each.state),
    ).toEqual([CHALLENGE_STATES.OPEN]);
    const withdrawn = await challenges.withdraw({ challengeId: id, playerId: RIYA.id, now: T0 + 31 * 1000 });
    expect(withdrawn).toMatchObject({ state: CHALLENGE_STATES.WITHDRAWN, took: false });
    expect(withdrawn.acceptedName).toBeUndefined();
  });

  it("is open again when recording the room fails, and the failure reaches the taker", async () => {
    const { make, accept, challenges, dao } = setup();
    const { id } = await make();
    const down = new Error("database down");
    dao.setRoom = async () => {
      throw down;
    };

    await expect(accept(id)).rejects.toBe(down);
    expect((await challenges.view({ challengeId: id, viewerId: CARA.id, now: T0 + 2 })).state).toBe(
      CHALLENGE_STATES.OPEN,
    );
  });

  it("answers how it ended when someone took it after the lease ran out", async () => {
    const { make, accept, dao } = setup();
    const { id } = await make();
    dao.setRoom = async () => false;

    const lost = await accept(id).catch((err) => err);

    expect(lost).toBeInstanceOf(GoneError);
    expect(lost.details).toEqual({ state: CHALLENGE_STATES.ACCEPTED });
  });
});

describe("challengeComponent: a player's data", () => {
  it("moves a guest's challenges to their account", async () => {
    const { challenges } = setup();
    await challenges.create({ from: GUEST, gameId: "chess", options: {}, now: T0 });

    expect(await challenges.transferPlayer({ from: GUEST.id, to: CARA })).toEqual({
      moved: { challenges: 1 },
    });
    expect(await challenges.inbox({ playerId: CARA.id, now: T0 + 1 })).toHaveLength(1);
  });

  it("exports the challenges a player made and was sent, naming others by name only", async () => {
    const { challenges, make, accept } = setup();
    const link = await make();
    await accept(link.id);
    await make({ to: "Arjun", now: T0 + 1 });
    await challenges.create({ from: ARJUN, gameId: "chess", options: {}, to: "Riya", now: T0 + 2 });

    const rows = await challenges.exportPlayer({ playerId: RIYA.id, now: T0 + 5 });

    expect(rows).toEqual([
      expect.objectContaining({ made: true, sentTo: "Arjun", state: CHALLENGE_STATES.OPEN }),
      expect.objectContaining({
        made: true,
        takenBy: "Guest-T001",
        state: CHALLENGE_STATES.ACCEPTED,
        createdAt: new Date(T0).toISOString(),
      }),
      expect.objectContaining({ made: false, from: "Arjun", gameId: "chess" }),
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/user_|guest_/);
  });

  it("exports each challenge in the state it has now, and nothing from someone in a block with the player", async () => {
    const { challenges, make } = setup({ blocked: [[CARA.id, RIYA.id]] });
    await make();
    await challenges.create({ from: CARA, gameId: "chess", options: {}, to: "Riya", now: T0 + 1 });

    const rows = await challenges.exportPlayer({ playerId: RIYA.id, now: T0 + DAY });

    expect(rows).toEqual([expect.objectContaining({ made: true, state: CHALLENGE_STATES.EXPIRED })]);
  });

  it("erases every challenge the player made, was sent or took", async () => {
    const { challenges, make } = setup();
    await make();

    expect(await challenges.erasePlayer({ playerId: RIYA.id })).toEqual({ erased: { challenges: 1 } });
    expect(await challenges.erasePlayer({ playerId: RIYA.id })).toEqual({ erased: { challenges: 0 } });
  });
});
