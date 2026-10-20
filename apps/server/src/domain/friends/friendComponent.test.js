import { describe, expect, it } from "vitest";
import {
  FRIEND_ANSWERS,
  FRIEND_LINK_MAKER_NAME,
  FRIEND_PRESENCE,
  FRIEND_REQUEST_RESULTS,
  isFriendLinkToken,
} from "@classicade/shared";
import { createFriendAccessor } from "../../data/friendAccessor.js";
import { createPrivacyAccessor } from "../../data/privacyAccessor.js";
import { createProfileAccessor } from "../../data/profileAccessor.js";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import {
  createInMemoryFriendLinkDao,
  createInMemoryFriendRequestDao,
  createInMemoryFriendshipDao,
  createInMemoryPrivacyDao,
} from "../../testing/inMemoryFriendDaos.js";
import { createInMemoryProfileDao } from "../../testing/inMemoryProfileDao.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { createCoPlayers } from "../players/coPlayers.js";
import { createSeatIds } from "../rooms/seatIds.js";
import { PRESENCE_EVENTS } from "./presenceTracker.js";
import { createFriendComponent, FRIEND_EVENTS } from "./friendComponent.js";

// CC-052, ADR-066. Riya and Arjun are adult accounts, Kabir a minor's account and Meena an account of unknown
// age. Every room here is joined by a link unless it says it came from quick match.
const RIYA = "user_aaaaaaaaaaaaaaaaaaaaaaaa";
const ARJUN = "user_dddddddddddddddddddddddd";
const KABIR = "user_bbbbbbbbbbbbbbbbbbbbbbbb";
const MEENA = "user_cccccccccccccccccccccccc";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";
const NAMES = new Map([
  [RIYA, "RiyaTest"],
  [ARJUN, "ArjunTest"],
  [KABIR, "KabirTest"],
  [MEENA, "MeenaTest"],
  [GUEST, "Guest-T001"],
]);
const ADULTS = new Set([RIYA, ARJUN]);
const T0 = Date.UTC(2026, 9, 20, 12);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SEAT_IDS = createSeatIds({ secret: "seat-secret-for-tests-only-0123456789abcdef" });
const MATCH_ID = "11111111-2222-4333-8444-555555555555";

/** A room both players sit in, by code, as the room accessor answers it. */
const roomOf = (code, playerIds, extra = {}) => ({
  code,
  createdAt: T0,
  seats: playerIds.map((playerId) => ({ playerId, displayName: NAMES.get(playerId) })),
  ...extra,
});

/** Every string anywhere in a value. */
const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? [...Object.keys(value), ...Object.values(value)].flatMap(stringsIn)
      : [];

function setup({ rooms = [], blocked = [], limits, deleted = [], failing = [], matchMark } = {}) {
  const byCode = new Map(rooms.map((room) => [room.code, room]));
  let handles = 0;
  let requests = 0;
  let tokens = 0;
  const profileAccessor = createProfileAccessor({
    profileDao: createInMemoryProfileDao(),
    newHandle: () => `${++handles}`.padStart(16, "h"),
  });
  const statuses = new Map();
  const blocks = new Set(blocked.map(([a, b]) => `${a} ${b}`));
  const announced = [];
  const friendAccessor = createFriendAccessor({
    friendshipDao: createInMemoryFriendshipDao(),
    friendRequestDao: createInMemoryFriendRequestDao(),
    friendLinkDao: createInMemoryFriendLinkDao(),
  });
  const friends = createFriendComponent({
    // A store whose named reads fail as a database that is down would.
    friendAccessor: {
      ...friendAccessor,
      ...Object.fromEntries(
        failing.map((name) => [name, async () => Promise.reject(new Error("database down"))]),
      ),
    },
    privacyAccessor: createPrivacyAccessor({ privacyDao: createInMemoryPrivacyDao() }),
    profiles: profileAccessor,
    coPlayers: createCoPlayers({
      rooms: {
        async getByCode(code) {
          if (!byCode.has(code)) throw new NotFoundError("no room");
          return byCode.get(code);
        },
      },
      matches: {
        async meetingFor({ matchId, playerId }) {
          if (matchId !== MATCH_ID || ![RIYA, MEENA].includes(playerId)) throw new NotFoundError("no match");
          return {
            players: [RIYA, MEENA].map((id) => ({ playerId: id, displayName: NAMES.get(id) })),
            ...(matchMark !== undefined && { quickMatch: matchMark }),
          };
        },
      },
      transfers: { listFrom: async () => [] },
      seatIds: SEAT_IDS,
    }),
    blocks: {
      blockedWith: async ({ playerId }) =>
        new Set(
          [...blocks].flatMap((pair) => {
            const [a, b] = pair.split(" ");
            return a === playerId ? [b] : b === playerId ? [a] : [];
          }),
        ),
    },
    accounts: {
      usernamesOf: async ({ playerIds }) =>
        new Map(
          playerIds
            .filter((id) => id.startsWith("user_") && !deleted.includes(id))
            .map((id) => [id, NAMES.get(id)]),
        ),
    },
    ages: { adultsAmong: async ({ playerIds }) => new Set(playerIds.filter((id) => ADULTS.has(id))) },
    presence: { statusOf: (playerId) => statuses.get(playerId) ?? FRIEND_PRESENCE.OFFLINE },
    events: { emit: (name, payload) => announced.push({ name, ...payload }) },
    newRequestId: () => `00000000-0000-4000-9000-${String(++requests).padStart(12, "0")}`,
    newToken: () => `${++tokens}`.padStart(22, "T"),
    ...(limits !== undefined && { limits }),
  });
  /** The seat of `playerId` in a room, as the page names it. */
  const seatIn = (code, playerId) => {
    const room = byCode.get(code);
    const seat = room.seats.findIndex((each) => each.playerId === playerId);
    return { roomCode: code, seat, seatId: SEAT_IDS.seatIdOf(room, playerId) };
  };
  const ask = (from, to, code = "ROOM22", now = T0) =>
    friends.sendRequest({ playerId: from, target: seatIn(code, to), now });
  const view = (playerId, now = T0) => friends.viewFor({ playerId, now });
  const handleOf = async (playerId) =>
    (await profileAccessor.getOrCreateMany({ playerIds: [playerId], at: T0 })).get(playerId).handle;
  const block = (a, b) => blocks.add(`${a} ${b}`);
  const unblock = (a, b) => blocks.delete(`${a} ${b}`);
  const events = (name) => announced.filter((event) => event.name === name);
  return {
    friends,
    ask,
    view,
    handleOf,
    statuses,
    block,
    unblock,
    events,
    announced,
    seatIn,
    profileAccessor,
  };
}

const shared = (...extra) => [roomOf("ROOM22", [RIYA, ARJUN]), roomOf("ROOM33", [RIYA, KABIR]), ...extra];

describe("friendComponent: who can have friends (CC-052)", () => {
  it("needs every source it reads", () => {
    expect(() => createFriendComponent({})).toThrow(/friendAccessor/);
  });

  it("tells a guest to save their progress, whatever they try", async () => {
    const { friends } = setup({ rooms: [roomOf("GUEST2", [GUEST, RIYA])] });
    const target = {
      roomCode: "GUEST2",
      seat: 1,
      seatId: SEAT_IDS.seatIdOf(roomOf("GUEST2", [GUEST, RIYA]), RIYA),
    };

    for (const attempt of [
      () => friends.viewFor({ playerId: GUEST, now: T0 }),
      () => friends.sendRequest({ playerId: GUEST, target, now: T0 }),
      () => friends.answerRequest({ playerId: GUEST, requestId: "x", answer: "accept", now: T0 }),
      () => friends.cancelRequest({ playerId: GUEST, requestId: "x", now: T0 }),
      () => friends.removeFriend({ playerId: GUEST, handle: "hhhhhhhhhhhhhhh1" }),
      () => friends.setAppearOffline({ playerId: GUEST, appearOffline: true, now: T0 }),
      () => friends.makeLink({ playerId: GUEST, now: T0 }),
      () => friends.useLink({ playerId: GUEST, token: "T".repeat(22), now: T0 }),
    ]) {
      await expect(attempt()).rejects.toThrow(new ForbiddenError("Save your progress to add friends"));
    }
  });

  it("refuses to ask a guest one played with, saying why", async () => {
    const { ask } = setup({ rooms: [roomOf("ROOM22", [RIYA, GUEST])] });

    await expect(ask(RIYA, GUEST)).rejects.toThrow(
      new ConflictError("Guest-T001 needs to save their progress before you can be friends"),
    );
  });

  it("refuses anyone the player did not play with, with one message", async () => {
    const { friends } = setup({ rooms: [roomOf("ROOM22", [ARJUN, KABIR])] });

    for (const target of [
      { roomCode: "ROOM22", seat: 1, seatId: SEAT_IDS.seatIdOf(roomOf("ROOM22", [ARJUN, KABIR]), KABIR) },
      { roomCode: "NONE22", seat: 0, seatId: "A".repeat(22) },
      { matchId: "99999999-2222-4333-8444-555555555555", seat: 0 },
    ]) {
      await expect(friends.sendRequest({ playerId: RIYA, target, now: T0 })).rejects.toThrow(
        new NotFoundError("You can only add someone you played with"),
      );
    }
  });
});

describe("friendComponent: asking and answering (CC-052)", () => {
  it("sends a request to someone the player sat with, which they see and are told about", async () => {
    const { ask, view, events } = setup({ rooms: shared() });

    expect(await ask(RIYA, ARJUN)).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });

    expect((await view(ARJUN)).incoming).toEqual([
      { requestId: expect.any(String), displayName: "RiyaTest", via: "game", sentAt: T0 },
    ]);
    expect((await view(RIYA)).outgoing).toEqual([
      { requestId: expect.any(String), displayName: "ArjunTest", sentAt: T0 },
    ]);
    expect(events(FRIEND_EVENTS.REQUESTED)).toEqual([
      {
        name: FRIEND_EVENTS.REQUESTED,
        recipientId: ARJUN,
        request: { requestId: expect.any(String), displayName: "RiyaTest", via: "game" },
      },
    ]);
    expect(events(FRIEND_EVENTS.CHANGED)).toEqual([
      { name: FRIEND_EVENTS.CHANGED, playerIds: [RIYA, ARJUN] },
    ]);
  });

  it("sends a request from match history, to the other player of a match marked as met by a link", async () => {
    const { friends, view } = setup({ matchMark: false });

    await friends.sendRequest({ playerId: RIYA, target: { matchId: MATCH_ID, seat: 1 }, now: T0 });

    expect((await view(MEENA)).incoming.map((request) => request.displayName)).toEqual(["RiyaTest"]);
  });

  it("treats a match that does not say how the two met as quick match, for a pair with a minor (ADR-051.7)", async () => {
    const { friends, view, events } = setup();

    expect(
      await friends.sendRequest({ playerId: RIYA, target: { matchId: MATCH_ID, seat: 1 }, now: T0 }),
    ).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });

    expect((await view(MEENA)).incoming).toEqual([]);
    expect((await view(RIYA)).outgoing.map((request) => request.displayName)).toEqual(["MeenaTest"]);
    expect(events(FRIEND_EVENTS.REQUESTED)).toEqual([]);
  });

  it("answers the same when asked again, and tells the recipient only once", async () => {
    const { ask, view, events } = setup({ rooms: shared() });

    await ask(RIYA, ARJUN);
    expect(await ask(RIYA, ARJUN, "ROOM22", T0 + MINUTE)).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });

    expect((await view(ARJUN)).incoming).toHaveLength(1);
    expect(events(FRIEND_EVENTS.REQUESTED)).toHaveLength(1);
  });

  it("makes the two friends at once when the other asked first", async () => {
    const { ask, view, handleOf, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);

    expect(await ask(ARJUN, RIYA, "ROOM22", T0 + 5)).toEqual({ result: FRIEND_REQUEST_RESULTS.FRIENDS });

    const riya = await view(RIYA);
    expect(riya.friends).toEqual([
      {
        handle: await handleOf(ARJUN),
        displayName: "ArjunTest",
        presence: FRIEND_PRESENCE.OFFLINE,
        since: T0 + 5,
        profile: await handleOf(ARJUN),
      },
    ]);
    expect(riya.outgoing).toEqual([]);
    expect((await view(ARJUN)).incoming).toEqual([]);
    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([ARJUN, RIYA]);
    expect(await ask(RIYA, ARJUN)).toEqual({ result: FRIEND_REQUEST_RESULTS.FRIENDS });
  });

  it("accepts a request: both are friends and the request is gone", async () => {
    const { ask, view, friends, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const [{ requestId }] = (await view(ARJUN)).incoming;

    expect(
      await friends.answerRequest({ playerId: ARJUN, requestId, answer: FRIEND_ANSWERS.ACCEPT, now: T0 + 1 }),
    ).toEqual({ result: FRIEND_REQUEST_RESULTS.FRIENDS });

    expect((await view(ARJUN)).friends.map((friend) => friend.displayName)).toEqual(["RiyaTest"]);
    expect((await view(RIYA)).friends.map((friend) => friend.displayName)).toEqual(["ArjunTest"]);
    expect((await view(RIYA)).outgoing).toEqual([]);
    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([RIYA, ARJUN]);
  });

  it("declines quietly: the request leaves the recipient's view and the sender's never changes", async () => {
    const { ask, view, friends, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const before = await view(RIYA);
    const [{ requestId }] = (await view(ARJUN)).incoming;

    expect(
      await friends.answerRequest({
        playerId: ARJUN,
        requestId,
        answer: FRIEND_ANSWERS.DECLINE,
        now: T0 + 1,
      }),
    ).toEqual({ result: "declined" });

    expect((await view(ARJUN)).incoming).toEqual([]);
    expect(await view(RIYA)).toEqual(before);
    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([ARJUN]);
    expect(await ask(RIYA, ARJUN, "ROOM22", T0 + 2)).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });
    expect((await view(ARJUN)).incoming).toEqual([]);
  });

  it("keeps a declined request declined when its sender cancels and sends it again: no ring, nothing shown", async () => {
    const { ask, view, friends, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const [{ requestId }] = (await view(ARJUN)).incoming;
    await friends.answerRequest({ playerId: ARJUN, requestId, answer: FRIEND_ANSWERS.DECLINE, now: T0 + 1 });

    await friends.cancelRequest({ playerId: RIYA, requestId, now: T0 + 2 });
    expect(await ask(RIYA, ARJUN, "ROOM22", T0 + 20 * MINUTE)).toEqual({
      result: FRIEND_REQUEST_RESULTS.SENT,
    });

    expect((await view(ARJUN, T0 + 20 * MINUTE)).incoming).toEqual([]);
    expect((await view(RIYA, T0 + 20 * MINUTE)).outgoing.map((request) => request.displayName)).toEqual([
      "ArjunTest",
    ]);
    expect(events(FRIEND_EVENTS.REQUESTED)).toHaveLength(1);
  });

  it("lets only one of two answers at the same moment win", async () => {
    const { ask, view, friends } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const [{ requestId }] = (await view(ARJUN)).incoming;

    const answers = await Promise.allSettled([
      friends.answerRequest({ playerId: ARJUN, requestId, answer: FRIEND_ANSWERS.ACCEPT, now: T0 }),
      friends.answerRequest({ playerId: ARJUN, requestId, answer: FRIEND_ANSWERS.DECLINE, now: T0 }),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(answers.find((answer) => answer.status === "rejected").reason).toEqual(
      new NotFoundError("This request is no longer open"),
    );
  });

  it("refuses an answer that is neither accept nor decline", async () => {
    const { friends } = setup();

    await expect(
      friends.answerRequest({ playerId: RIYA, requestId: "x", answer: "maybe", now: T0 }),
    ).rejects.toThrow(ValidationError);
  });

  it("answers one not found for a request that is not the player's to answer now", async () => {
    const { ask, view, friends } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const [{ requestId }] = (await view(ARJUN)).incoming;
    const answer = (playerId, id, now = T0) =>
      friends.answerRequest({ playerId, requestId: id, answer: FRIEND_ANSWERS.ACCEPT, now });

    for (const attempt of [
      () => answer(RIYA, requestId),
      () => answer(KABIR, requestId),
      () => answer(ARJUN, "00000000-0000-4000-9000-999999999999"),
      () => answer(ARJUN, requestId, T0 + 31 * DAY),
    ]) {
      await expect(attempt()).rejects.toThrow(new NotFoundError("This request is no longer open"));
    }
    await friends.answerRequest({ playerId: ARJUN, requestId, answer: FRIEND_ANSWERS.DECLINE, now: T0 });
    await expect(answer(ARJUN, requestId)).rejects.toThrow(NotFoundError);
  });

  it("lets a request run out after 30 days, and a request that ran out does not make friends", async () => {
    const { ask, view } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);

    expect((await view(ARJUN, T0 + 30 * DAY)).incoming).toEqual([]);
    expect((await view(RIYA, T0 + 30 * DAY)).outgoing).toEqual([]);
    expect(await ask(ARJUN, RIYA, "ROOM22", T0 + 30 * DAY)).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });
    expect((await view(RIYA, T0 + 30 * DAY)).incoming.map((request) => request.displayName)).toEqual([
      "ArjunTest",
    ]);
  });

  it("sends again a request that ran out, as a fresh one", async () => {
    const { ask, view, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);

    await ask(RIYA, ARJUN, "ROOM22", T0 + 31 * DAY);

    expect((await view(ARJUN, T0 + 31 * DAY)).incoming).toEqual([
      expect.objectContaining({ displayName: "RiyaTest", sentAt: T0 + 31 * DAY }),
    ]);
    expect(events(FRIEND_EVENTS.REQUESTED)).toHaveLength(2);
  });
});

describe("friendComponent: blocks and the minors' rule are silent (ADR-053, ADR-066.4)", () => {
  it.each([
    ["the sender blocked the recipient", [RIYA, ARJUN]],
    ["the recipient blocked the sender", [ARJUN, RIYA]],
  ])("answers 'sent' when %s, and the recipient never hears of it", async (_case, pair) => {
    const { ask, view, events } = setup({ rooms: shared(), blocked: [pair] });

    expect(await ask(RIYA, ARJUN)).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });

    expect((await view(RIYA)).outgoing.map((request) => request.displayName)).toEqual(["ArjunTest"]);
    expect((await view(ARJUN)).incoming).toEqual([]);
    expect(events(FRIEND_EVENTS.REQUESTED)).toEqual([]);
    expect(events(FRIEND_EVENTS.CHANGED)).toEqual([{ name: FRIEND_EVENTS.CHANGED, playerIds: [RIYA] }]);
  });

  it("hides a request from before the block, which nobody can then accept, and never makes friends across it", async () => {
    const { ask, view, block, friends } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const [{ requestId }] = (await view(ARJUN)).incoming;

    block(ARJUN, RIYA);

    expect((await view(ARJUN)).incoming).toEqual([]);
    await expect(
      friends.answerRequest({ playerId: ARJUN, requestId, answer: FRIEND_ANSWERS.ACCEPT, now: T0 }),
    ).rejects.toThrow(new NotFoundError("This request is no longer open"));
    expect(await ask(ARJUN, RIYA)).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });
    expect((await view(ARJUN)).friends).toEqual([]);
  });

  it("declines the pending requests of a pair one blocks, so they never come back after an unblock", async () => {
    const { ask, view, block, unblock, friends } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);

    block(ARJUN, RIYA);
    await friends.playersBlocked({ blockerId: ARJUN, blockedId: RIYA, now: T0 + 1 });
    unblock(ARJUN, RIYA);

    expect((await view(ARJUN)).incoming).toEqual([]);
    expect((await view(RIYA)).outgoing.map((request) => request.displayName)).toEqual(["ArjunTest"]);
  });

  it("ends the friendship both ways when one blocks the other, and says so only to their own views", async () => {
    const { ask, view, block, friends, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);

    block(RIYA, ARJUN);
    expect((await view(ARJUN)).friends).toEqual([]);
    await friends.playersBlocked({ blockerId: RIYA, blockedId: ARJUN, now: T0 });
    await friends.playersBlocked({ blockerId: RIYA, blockedId: ARJUN, now: T0 });

    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([RIYA, ARJUN]);
    expect(events(FRIEND_EVENTS.CHANGED).filter((event) => event.playerIds.length === 2)).toHaveLength(3);
  });

  it("answers 'sent' to a quick match stranger when either is not surely an adult, and never delivers it", async () => {
    const { ask, view, events } = setup({
      rooms: [
        roomOf("QUICK1", [RIYA, KABIR], { quickMatch: true }),
        roomOf("QUICK2", [RIYA, ARJUN], { quickMatch: true }),
      ],
    });

    expect(await ask(RIYA, KABIR, "QUICK1")).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });
    expect(await ask(KABIR, RIYA, "QUICK1")).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });
    expect((await view(KABIR)).incoming).toEqual([]);
    expect((await view(RIYA)).incoming).toEqual([]);
    expect((await view(KABIR)).friends).toEqual([]);

    await ask(RIYA, ARJUN, "QUICK2");
    expect((await view(ARJUN)).incoming).toHaveLength(1);
    expect(events(FRIEND_EVENTS.REQUESTED).map((event) => event.recipientId)).toEqual([ARJUN]);
  });

  it("lets a minor befriend someone met in a room joined by a link, and shows them safety tips", async () => {
    const { ask, view } = setup({ rooms: shared() });

    await ask(RIYA, KABIR, "ROOM33");
    await ask(KABIR, RIYA, "ROOM33");

    const kabir = await view(KABIR);
    expect(kabir.friends.map((friend) => friend.displayName)).toEqual(["RiyaTest"]);
    expect(kabir.safetyTips).toBe(true);
    expect((await view(RIYA)).safetyTips).toBe(false);
    // A minor's profile is never linked, as on the boards (ADR-065.2), but the friend still has the handle.
    expect((await view(RIYA)).friends[0]).not.toHaveProperty("profile");
    expect((await view(RIYA)).friends[0].handle).toMatch(/^h+\d+$/);
  });
});

describe("friendComponent: limits (ADR-066.8)", () => {
  it("lets a player have at most so many requests waiting, declined ones included", async () => {
    const rooms = [
      roomOf("ROOM22", [RIYA, ARJUN]),
      roomOf("ROOM33", [RIYA, KABIR]),
      roomOf("ROOM44", [RIYA, MEENA]),
    ];
    const { ask, view, friends } = setup({ rooms, limits: { maxWaiting: 2 } });
    await ask(RIYA, ARJUN);
    await ask(RIYA, KABIR, "ROOM33");
    const [{ requestId }] = (await view(KABIR)).incoming;
    await friends.answerRequest({ playerId: KABIR, requestId, answer: FRIEND_ANSWERS.DECLINE, now: T0 });

    await expect(ask(RIYA, MEENA, "ROOM44")).rejects.toThrow(
      new ConflictError("You have 2 requests waiting. Cancel one, or wait for an answer."),
    );
    expect(await ask(RIYA, ARJUN)).toEqual({ result: FRIEND_REQUEST_RESULTS.SENT });
  });

  it("lets a player have at most so many friends, checked on their own count only", async () => {
    const rooms = [
      roomOf("ROOM22", [RIYA, ARJUN]),
      roomOf("ROOM33", [RIYA, KABIR]),
      roomOf("ROOM44", [ARJUN, MEENA]),
    ];
    const { ask, view, friends } = setup({ rooms, limits: { maxFriends: 1 } });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);
    await ask(MEENA, ARJUN, "ROOM44");

    await expect(ask(RIYA, KABIR, "ROOM33")).rejects.toThrow(
      new ConflictError("You have 1 friends. Remove one to add another."),
    );
    const [{ requestId }] = (await view(ARJUN)).incoming;
    await expect(
      friends.answerRequest({ playerId: ARJUN, requestId, answer: FRIEND_ANSWERS.ACCEPT, now: T0 }),
    ).rejects.toThrow(ConflictError);
  });

  it("shows a recipient only the newest waiting requests", async () => {
    const rooms = [roomOf("ROOM22", [RIYA, ARJUN]), roomOf("ROOM44", [MEENA, ARJUN])];
    const { ask, view } = setup({ rooms, limits: { incomingShown: 1 } });
    await ask(RIYA, ARJUN);
    await ask(MEENA, ARJUN, "ROOM44", T0 + 1);

    expect((await view(ARJUN)).incoming.map((request) => request.displayName)).toEqual(["MeenaTest"]);
  });
});

describe("friendComponent: cancelling and removing (CC-052)", () => {
  it("cancels a waiting request: it leaves both views, and sending again rings only after 15 minutes", async () => {
    const { ask, view, friends, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const [{ requestId }] = (await view(RIYA)).outgoing;

    await friends.cancelRequest({ playerId: RIYA, requestId, now: T0 + 1 });

    expect((await view(RIYA)).outgoing).toEqual([]);
    expect((await view(ARJUN)).incoming).toEqual([]);
    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([RIYA, ARJUN]);
    await ask(RIYA, ARJUN, "ROOM22", T0 + 2);
    expect((await view(ARJUN)).incoming).toHaveLength(1);
    expect(events(FRIEND_EVENTS.REQUESTED)).toHaveLength(1);

    await friends.cancelRequest({ playerId: RIYA, requestId, now: T0 + 3 });
    await ask(RIYA, ARJUN, "ROOM22", T0 + 15 * MINUTE);
    expect(events(FRIEND_EVENTS.REQUESTED)).toHaveLength(2);
  });

  it("cancels a declined request without telling the recipient anything", async () => {
    const { ask, view, friends, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const [{ requestId }] = (await view(ARJUN)).incoming;
    await friends.answerRequest({ playerId: ARJUN, requestId, answer: FRIEND_ANSWERS.DECLINE, now: T0 });

    await friends.cancelRequest({ playerId: RIYA, requestId, now: T0 + 1 });

    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([RIYA]);
    expect((await view(RIYA)).outgoing).toEqual([]);
  });

  it("cancels only the player's own waiting requests", async () => {
    const { ask, view, friends } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    const [{ requestId }] = (await view(RIYA)).outgoing;
    const cancel = (playerId, id) => friends.cancelRequest({ playerId, requestId: id, now: T0 });

    await expect(cancel(ARJUN, requestId)).rejects.toThrow(
      new NotFoundError("This request is no longer open"),
    );
    await expect(cancel(RIYA, "00000000-0000-4000-9000-999999999999")).rejects.toThrow(NotFoundError);
    await cancel(RIYA, requestId);
    await expect(cancel(RIYA, requestId)).rejects.toThrow(NotFoundError);
  });

  it("removes a friend by handle for both, and the same not found for anyone who is not a friend", async () => {
    const { ask, view, friends, handleOf, block, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);
    await ask(RIYA, KABIR, "ROOM33");
    await ask(KABIR, RIYA, "ROOM33");
    const remove = async (playerId, handle) => friends.removeFriend({ playerId, handle });

    await remove(RIYA, await handleOf(ARJUN));

    expect((await view(ARJUN)).friends).toEqual([]);
    expect((await view(RIYA)).friends.map((friend) => friend.displayName)).toEqual(["KabirTest"]);
    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([RIYA, ARJUN]);
    block(KABIR, RIYA);
    for (const handle of [
      await handleOf(ARJUN),
      await handleOf(KABIR),
      await handleOf(MEENA),
      "zzzzzzzzzzzzzzzz",
    ]) {
      await expect(remove(RIYA, handle)).rejects.toThrow(new NotFoundError("No such friend"));
    }
  });

  it("finds a friend's player id by handle, for invites (part 2)", async () => {
    const { ask, friends, handleOf } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);

    expect(await friends.friendByHandle({ playerId: RIYA, handle: await handleOf(ARJUN) })).toBe(ARJUN);
  });
});

describe("friendComponent: presence (ADR-066.6)", () => {
  it("shows each friend's presence from the tracker, and offline for one who chose to appear offline", async () => {
    const { ask, view, friends, statuses, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);
    await ask(RIYA, KABIR, "ROOM33");
    await ask(KABIR, RIYA, "ROOM33");
    statuses.set(ARJUN, FRIEND_PRESENCE.PLAYING);
    statuses.set(KABIR, FRIEND_PRESENCE.ONLINE);

    expect((await view(RIYA)).friends.map((friend) => friend.presence)).toEqual(["playing", "online"]);

    expect(await friends.setAppearOffline({ playerId: KABIR, appearOffline: true, now: T0 })).toEqual({
      appearOffline: true,
    });
    expect((await view(RIYA)).friends.map((friend) => friend.presence)).toEqual(["playing", "offline"]);
    expect((await view(KABIR)).settings).toEqual({ appearOffline: true });
    expect(events(PRESENCE_EVENTS.CHANGED)).toEqual([{ name: PRESENCE_EVENTS.CHANGED, playerId: KABIR }]);
    await friends.setAppearOffline({ playerId: KABIR, appearOffline: false, now: T0 });
    expect((await view(KABIR)).settings).toEqual({ appearOffline: false });
  });

  it("refuses an Appear offline that is not true or false", async () => {
    const { friends } = setup();

    await expect(friends.setAppearOffline({ playerId: RIYA, appearOffline: "yes", now: T0 })).rejects.toThrow(
      ValidationError,
    );
  });

  it("names who should hear of a player's presence: their friends only, without anyone blocked", async () => {
    const { ask, friends, handleOf, statuses, block } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);
    await ask(RIYA, KABIR, "ROOM33");
    await ask(KABIR, RIYA, "ROOM33");
    statuses.set(RIYA, FRIEND_PRESENCE.ONLINE);
    block(RIYA, KABIR);

    expect(await friends.presenceAudience({ playerId: RIYA, now: T0 })).toEqual({
      handle: await handleOf(RIYA),
      presence: FRIEND_PRESENCE.ONLINE,
      friendIds: [ARJUN],
    });
    await friends.setAppearOffline({ playerId: RIYA, appearOffline: true, now: T0 });
    expect((await friends.presenceAudience({ playerId: RIYA, now: T0 })).presence).toBe(
      FRIEND_PRESENCE.OFFLINE,
    );
    for (const playerId of [MEENA, GUEST]) {
      expect(await friends.presenceAudience({ playerId, now: T0 })).toEqual({
        handle: "",
        presence: "",
        friendIds: [],
      });
    }
  });
});

describe("friendComponent: friend links (ADR-066.3)", () => {
  it("makes a one-use link that lasts 7 days, with a token that is never a player id", async () => {
    const { friends } = setup();

    const link = await friends.makeLink({ playerId: RIYA, now: T0 });

    expect(link).toEqual({ token: expect.any(String), expiresAt: T0 + 7 * DAY });
    expect(isFriendLinkToken(link.token)).toBe(true);
    expect(await friends.linkInvite({ token: link.token, viewerId: "", now: T0 })).toEqual({
      displayName: "RiyaTest",
    });
    expect(await friends.linkInvite({ token: link.token, viewerId: RIYA, now: T0 })).toEqual({
      displayName: "RiyaTest",
      own: true,
    });
    await expect(friends.linkInvite({ token: link.token, viewerId: "", now: T0 + 7 * DAY })).rejects.toThrow(
      new NotFoundError("This friend link has run out or was used already"),
    );
  });

  it("names a maker who is not surely an adult as 'A ClassiCade player' to whoever holds the link", async () => {
    const { friends, view } = setup();
    const { token } = await friends.makeLink({ playerId: KABIR, now: T0 });

    expect(await friends.linkInvite({ token, viewerId: ARJUN, now: T0 })).toEqual({
      displayName: FRIEND_LINK_MAKER_NAME,
    });
    await friends.useLink({ playerId: ARJUN, token, now: T0 });

    expect((await view(ARJUN)).outgoing.map((request) => request.displayName)).toEqual([
      FRIEND_LINK_MAKER_NAME,
    ]);
    expect((await view(KABIR)).incoming).toEqual([
      expect.objectContaining({ displayName: "ArjunTest", via: "link" }),
    ]);
  });

  it("uses the link up and sends its maker a request, who accepts it", async () => {
    const { friends, view, events } = setup();
    const { token } = await friends.makeLink({ playerId: RIYA, now: T0 });

    expect(await friends.useLink({ playerId: MEENA, token, now: T0 + 1 })).toEqual({
      result: FRIEND_REQUEST_RESULTS.SENT,
    });

    await expect(friends.useLink({ playerId: KABIR, token, now: T0 + 2 })).rejects.toThrow(
      new NotFoundError("This friend link has run out or was used already"),
    );
    const [request] = (await view(RIYA)).incoming;
    expect(request).toEqual(expect.objectContaining({ displayName: "MeenaTest", via: "link" }));
    expect(events(FRIEND_EVENTS.REQUESTED).at(-1).request.via).toBe("link");
    await friends.answerRequest({
      playerId: RIYA,
      requestId: request.requestId,
      answer: "accept",
      now: T0 + 3,
    });
    expect((await view(MEENA)).friends.map((friend) => friend.displayName)).toEqual(["RiyaTest"]);
  });

  it("does not use up the link for its maker or for a friend already", async () => {
    const { friends, ask } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);
    const { token } = await friends.makeLink({ playerId: RIYA, now: T0 });

    await expect(friends.useLink({ playerId: RIYA, token, now: T0 })).rejects.toThrow(
      new ConflictError("This is your own friend link. Send it to a friend."),
    );
    expect(await friends.useLink({ playerId: ARJUN, token, now: T0 })).toEqual({
      result: FRIEND_REQUEST_RESULTS.FRIENDS,
    });
    expect(await friends.linkInvite({ token, viewerId: "", now: T0 })).toEqual({ displayName: "RiyaTest" });
  });

  it("answers 'sent' for a link into a block, uses it up, and never tells the maker", async () => {
    const { friends, view, events } = setup({ blocked: [[RIYA, MEENA]] });
    const { token } = await friends.makeLink({ playerId: RIYA, now: T0 });

    expect(await friends.useLink({ playerId: MEENA, token, now: T0 })).toEqual({
      result: FRIEND_REQUEST_RESULTS.SENT,
    });

    expect((await view(RIYA)).incoming).toEqual([]);
    expect((await view(MEENA)).outgoing.map((request) => request.displayName)).toEqual(["RiyaTest"]);
    expect(events(FRIEND_EVENTS.REQUESTED)).toEqual([]);
    await expect(friends.linkInvite({ token, viewerId: "", now: T0 })).rejects.toThrow(NotFoundError);
  });

  it("keeps the link for a player at a limit: it is used up only once the request can go", async () => {
    const rooms = [roomOf("ROOM22", [MEENA, ARJUN])];
    const { friends, ask } = setup({ rooms, limits: { maxWaiting: 1 } });
    await ask(MEENA, ARJUN);
    const { token } = await friends.makeLink({ playerId: RIYA, now: T0 });

    await expect(friends.useLink({ playerId: MEENA, token, now: T0 })).rejects.toThrow(ConflictError);

    expect(await friends.linkInvite({ token, viewerId: "", now: T0 })).toEqual({ displayName: "RiyaTest" });
    expect(await friends.useLink({ playerId: KABIR, token, now: T0 })).toEqual({
      result: FRIEND_REQUEST_RESULTS.SENT,
    });
  });

  it("keeps a player's newest links only, and a deleted maker's link leads nowhere", async () => {
    const { friends } = setup({ limits: { linksKept: 1 }, deleted: [ARJUN] });
    const first = await friends.makeLink({ playerId: RIYA, now: T0 });
    const second = await friends.makeLink({ playerId: RIYA, now: T0 + 1 });
    const arjuns = await friends.makeLink({ playerId: ARJUN, now: T0 });

    await expect(friends.linkInvite({ token: first.token, viewerId: "", now: T0 })).rejects.toThrow(
      NotFoundError,
    );
    await expect(friends.useLink({ playerId: MEENA, token: first.token, now: T0 })).rejects.toThrow(
      NotFoundError,
    );
    expect(await friends.linkInvite({ token: second.token, viewerId: "", now: T0 })).toEqual({
      displayName: "RiyaTest",
    });
    await expect(friends.linkInvite({ token: arjuns.token, viewerId: "", now: T0 })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("friendComponent: deletion and export (CC-035)", () => {
  it("exports the player's friends, sent requests, open links and switch, by name and date, never an id", async () => {
    const { friends, ask } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);
    await ask(RIYA, KABIR, "ROOM33");
    await friends.makeLink({ playerId: RIYA, now: T0 });
    await friends.setAppearOffline({ playerId: RIYA, appearOffline: true, now: T0 });

    const exported = await friends.exportPlayer({ playerId: RIYA, now: T0 });

    expect(exported).toEqual({
      friends: [{ displayName: "ArjunTest", since: new Date(T0).toISOString() }],
      requestsSent: [{ displayName: "KabirTest", sentAt: new Date(T0).toISOString() }],
      friendLinks: [{ madeAt: new Date(T0).toISOString(), worksUntil: new Date(T0 + 7 * DAY).toISOString() }],
      appearOffline: true,
    });
    expect(stringsIn(exported).filter(hasPlayerIdShape)).toEqual([]);
  });

  it("never exports the name of a link maker not surely an adult who has not accepted yet (ADR-028.7)", async () => {
    const { friends } = setup();
    const { token } = await friends.makeLink({ playerId: KABIR, now: T0 });
    await friends.useLink({ playerId: ARJUN, token, now: T0 });

    const exported = await friends.exportPlayer({ playerId: ARJUN, now: T0 });

    expect(exported.requestsSent).toEqual([
      { displayName: FRIEND_LINK_MAKER_NAME, sentAt: new Date(T0).toISOString() },
    ]);
    expect(JSON.stringify(exported)).not.toContain("KabirTest");
  });

  it("erases everything of the player on either side, and their friends see them gone", async () => {
    const { friends, ask, view, events } = setup({ rooms: shared() });
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);
    await ask(KABIR, RIYA, "ROOM33");
    await friends.makeLink({ playerId: RIYA, now: T0 });
    await friends.setAppearOffline({ playerId: RIYA, appearOffline: true, now: T0 });

    expect(await friends.erasePlayer({ playerId: RIYA })).toEqual({
      erased: { friendships: 1, friendRequests: 1, friendLinks: 1, privacy: 1 },
    });

    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([ARJUN]);
    expect((await view(ARJUN)).friends).toEqual([]);
    expect((await view(KABIR)).outgoing).toEqual([]);
    expect(await friends.erasePlayer({ playerId: RIYA })).toEqual({
      erased: { friendships: 0, friendRequests: 0, friendLinks: 0, privacy: 0 },
    });
    expect(events(FRIEND_EVENTS.CHANGED).at(-1).playerIds).toEqual([ARJUN]);
  });

  it("leaves out a deleted account the stores still name, until it is erased", async () => {
    const { ask, view } = setup({ rooms: shared(), deleted: [ARJUN] });
    await ask(RIYA, ARJUN);
    await ask(KABIR, RIYA, "ROOM33");

    expect((await view(RIYA)).outgoing).toEqual([]);
  });
});

describe("friendComponent: avatars, failures and races (CC-052)", () => {
  it("shows the avatar each person picked, beside their name", async () => {
    const { ask, view, profileAccessor } = setup({ rooms: shared() });
    await profileAccessor.update({ playerId: RIYA, set: { avatar: "rocket" }, at: T0 });
    await profileAccessor.update({ playerId: ARJUN, set: { avatar: "retired-avatar" }, at: T0 });

    await ask(RIYA, ARJUN);

    expect((await view(ARJUN)).incoming[0].avatar).toBe("rocket");
    expect((await view(RIYA)).outgoing[0]).not.toHaveProperty("avatar");
  });

  it.each([["getRequest"], ["getLiveRequest"]])(
    "passes on a store that fails in %s, as it is",
    async (name) => {
      const { ask, friends } = setup({ rooms: shared(), failing: [name] });

      const attempt =
        name === "getRequest"
          ? ask(RIYA, ARJUN)
          : friends.answerRequest({
              playerId: ARJUN,
              requestId: "x",
              answer: FRIEND_ANSWERS.ACCEPT,
              now: T0,
            });

      await expect(attempt).rejects.toThrow("database down");
    },
  );

  it("uses a link once when two press Add friend at the same moment", async () => {
    const { friends, view } = setup();
    const { token } = await friends.makeLink({ playerId: RIYA, now: T0 });

    const results = await Promise.allSettled([
      friends.useLink({ playerId: MEENA, token, now: T0 }),
      friends.useLink({ playerId: KABIR, token, now: T0 }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected").reason).toEqual(
      new NotFoundError("This friend link has run out or was used already"),
    );
    expect((await view(RIYA)).incoming).toHaveLength(1);
  });
});

describe("friendComponent: no player id ever leaves (ADR-057, CC-297)", () => {
  it("names nobody by player id in any view, push or answer", async () => {
    const { ask, view, friends, announced, statuses } = setup({ rooms: shared() });
    statuses.set(ARJUN, FRIEND_PRESENCE.ONLINE);
    await ask(RIYA, ARJUN);
    await ask(ARJUN, RIYA);
    await ask(RIYA, KABIR, "ROOM33");
    const { token } = await friends.makeLink({ playerId: KABIR, now: T0 });
    const answers = [
      await view(RIYA),
      await view(ARJUN),
      await view(KABIR),
      await friends.linkInvite({ token, viewerId: "", now: T0 }),
      await friends.useLink({ playerId: ARJUN, token, now: T0 }),
      await view(ARJUN),
    ];
    // The pushes name their recipients for the gateway, which never sends those ids.
    const pushed = announced.map(({ request }) => request ?? {});

    expect(stringsIn([answers, pushed]).filter(hasPlayerIdShape)).toEqual([]);
  });
});
