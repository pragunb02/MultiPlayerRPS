import { describe, expect, it } from "vitest";
import {
  createInMemoryFriendLinkDao,
  createInMemoryFriendRequestDao,
  createInMemoryFriendshipDao,
} from "../testing/inMemoryFriendDaos.js";
import { NotFoundError } from "../utils/errors.js";
import { createFriendAccessor, FRIEND_REQUEST_STATUS } from "./friendAccessor.js";

const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const MEERA = "user_aaaaaaaaaaaaaaaaaaaaaaaa";
const T0 = Date.UTC(2026, 9, 20, 12);

function accessor(overrides = {}) {
  return createFriendAccessor({
    friendshipDao: createInMemoryFriendshipDao(),
    friendRequestDao: createInMemoryFriendRequestDao(),
    friendLinkDao: createInMemoryFriendLinkDao(),
    ...overrides,
  });
}

const request = (senderId, recipientId, at = T0) => ({
  requestId: `00000000-0000-4000-9000-${senderId.slice(-6)}${recipientId.slice(-6)}`,
  senderId,
  recipientId,
  via: "game",
  status: "pending",
  createdAt: at,
  notifiedAt: at,
  expiresAt: at + 60_000,
});

describe("friend accessor (CC-052)", () => {
  it("needs its three stores", () => {
    expect(() => createFriendAccessor({})).toThrow(/friendshipDao/);
  });

  it("stores a pair once whoever asked, and answers each side's friend", async () => {
    const friends = accessor();

    expect(await friends.befriend({ a: ARJUN, b: RIYA, at: T0 })).toBe(true);
    expect(await friends.befriend({ a: RIYA, b: ARJUN, at: T0 + 1 })).toBe(false);
    await friends.befriend({ a: MEERA, b: RIYA, at: T0 + 2 });

    expect(await friends.areFriends({ a: RIYA, b: ARJUN })).toBe(true);
    expect(await friends.areFriends({ a: ARJUN, b: MEERA })).toBe(false);
    expect(await friends.friendsOf(RIYA)).toEqual([
      { friendId: ARJUN, since: T0 },
      { friendId: MEERA, since: T0 + 2 },
    ]);
    expect(Object.isFrozen((await friends.friendsOf(RIYA))[0])).toBe(true);
    expect(await friends.countFriends(RIYA)).toBe(2);
    expect(await friends.unfriend({ a: RIYA, b: ARJUN })).toBe(true);
    expect(await friends.unfriend({ a: RIYA, b: ARJUN })).toBe(false);
  });

  it("passes on a store failure that is not a repeated pair", async () => {
    const failing = {
      ...createInMemoryFriendshipDao(),
      insert: async () => Promise.reject(new Error("down")),
    };

    await expect(
      accessor({ friendshipDao: failing }).befriend({ a: RIYA, b: ARJUN, at: T0 }),
    ).rejects.toThrow("down");
  });

  it("stores a request as given, and answers the same pair's request when asked again", async () => {
    const friends = accessor();

    const first = await friends.addRequest(request(RIYA, ARJUN));
    const again = await friends.addRequest({ ...request(RIYA, ARJUN, T0 + 5), requestId: "other" });

    expect(first).toEqual({
      created: true,
      request: { ...request(RIYA, ARJUN), status: FRIEND_REQUEST_STATUS.PENDING },
    });
    expect(again).toEqual({ created: false, request: first.request });
    expect(Object.isFrozen(first.request)).toBe(true);
  });

  it("passes on a store failure when adding a request", async () => {
    const failing = {
      ...createInMemoryFriendRequestDao(),
      insert: async () => Promise.reject(new Error("down")),
    };

    await expect(accessor({ friendRequestDao: failing }).addRequest(request(RIYA, ARJUN))).rejects.toThrow(
      "down",
    );
  });

  it("reads requests by pair and by id, and says not found for none", async () => {
    const friends = accessor();
    const { request: sent } = await friends.addRequest(request(RIYA, ARJUN));

    expect(await friends.getRequest({ senderId: RIYA, recipientId: ARJUN })).toEqual(sent);
    await expect(friends.getRequest({ senderId: ARJUN, recipientId: RIYA })).rejects.toThrow(NotFoundError);
    expect(await friends.getLiveRequest({ requestId: sent.requestId, now: T0 })).toEqual(sent);
    await expect(friends.getLiveRequest({ requestId: sent.requestId, now: T0 + 60_000 })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("passes on a read failure that is not a missing request", async () => {
    const failing = {
      ...createInMemoryFriendRequestDao(),
      getByPair: async () => Promise.reject(new Error("down")),
    };

    await expect(
      accessor({ friendRequestDao: failing }).getRequest({ senderId: RIYA, recipientId: ARJUN }),
    ).rejects.toThrow("down");
  });

  it("changes a request by status, with times in ms, and lists both directions", async () => {
    const friends = accessor();
    const { request: sent } = await friends.addRequest(request(RIYA, ARJUN));
    await friends.addRequest(request(MEERA, ARJUN, T0 + 1));

    expect(
      await friends.updateRequest({
        requestId: sent.requestId,
        statuses: [FRIEND_REQUEST_STATUS.PENDING],
        set: { status: FRIEND_REQUEST_STATUS.DECLINED, notifiedAt: T0 + 3 },
      }),
    ).toBe(true);
    expect(
      await friends.updateRequest({
        requestId: sent.requestId,
        statuses: [FRIEND_REQUEST_STATUS.PENDING],
        set: {},
      }),
    ).toBe(false);

    expect(await friends.sentBy({ senderId: RIYA, statuses: ["declined"], now: T0 })).toEqual([
      { ...sent, status: "declined", notifiedAt: T0 + 3 },
    ]);
    expect(
      (await friends.sentTo({ recipientId: ARJUN, statuses: ["pending"], now: T0, limit: 5 })).map(
        (r) => r.senderId,
      ),
    ).toEqual([MEERA]);
    expect(await friends.removeRequestsBetween({ a: ARJUN, b: RIYA })).toBe(1);
  });

  it("keeps links by their token's hash, takes each once, and keeps the newest few", async () => {
    const friends = accessor();
    const link = (hash, at) => ({
      tokenHash: hash.repeat(64),
      creatorId: RIYA,
      createdAt: at,
      expiresAt: at + 1000,
    });

    expect(await friends.addLink(link("a", T0))).toEqual(link("a", T0));
    await friends.addLink(link("b", T0 + 1));
    expect(await friends.getLiveLink({ tokenHash: "a".repeat(64), now: T0 })).toEqual(link("a", T0));
    expect(
      (await friends.linksBy({ creatorId: RIYA, now: T0 + 1 })).map((each) => each.tokenHash[0]),
    ).toEqual(["b", "a"]);
    expect(await friends.takeLink({ tokenHash: "a".repeat(64), now: T0 })).toEqual(link("a", T0));
    await expect(friends.takeLink({ tokenHash: "a".repeat(64), now: T0 })).rejects.toThrow(NotFoundError);
    await expect(friends.getLiveLink({ tokenHash: "b".repeat(64), now: T0 + 1001 })).rejects.toThrow(
      NotFoundError,
    );
    expect(await friends.keepNewestLinks({ creatorId: RIYA, keep: 0 })).toBe(1);
  });

  it("removes everything of a player on either side", async () => {
    const friends = accessor();
    await friends.befriend({ a: RIYA, b: ARJUN, at: T0 });
    await friends.addRequest(request(MEERA, RIYA));
    await friends.addLink({ tokenHash: "a".repeat(64), creatorId: RIYA, createdAt: T0, expiresAt: T0 + 1 });

    expect(await friends.removeInvolving(RIYA)).toEqual({
      friendships: 1,
      friendRequests: 1,
      friendLinks: 1,
    });
    expect(await friends.removeInvolving(RIYA)).toEqual({
      friendships: 0,
      friendRequests: 0,
      friendLinks: 0,
    });
  });
});
