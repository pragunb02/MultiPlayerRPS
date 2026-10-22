import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { FRIEND_EVENTS } from "../../domain/friends/friendComponent.js";
import { PRESENCE_EVENTS } from "../../domain/friends/presenceTracker.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { connectFriendPushes } from "./friendPushes.js";

const RIYA = "user_aaaaaaaaaaaaaaaaaaaaaaaa";
const ARJUN = "user_dddddddddddddddddddddddd";

/** The browser session of a player's tab in these tests. */
const sessionOf = (playerId) => `session of ${playerId}`;

/**
 * A Socket.IO server that records what it sent to each channel, with one tab open for each of the `online` players
 * only, in their session. A test may change `online` to open or close tabs.
 */
function fakeIo(online = []) {
  const sent = [];
  return {
    sent,
    online,
    in: (channel) => ({
      fetchSockets: async () =>
        online
          .filter((id) => channel === `player:${id}`)
          .map((id) => ({ data: { sessionId: sessionOf(id) } })),
    }),
    to: (channel) => ({ emit: (event, payload) => sent.push({ channel, event, payload }) }),
  };
}

/** Lets every promise started by an event settle. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

function setup({ online = [RIYA, ARJUN], friendComponent = {}, presence = {}, clock = { now: 1 } } = {}) {
  const io = fakeIo(online);
  const domainEvents = new EventEmitter();
  const { logger, entries } = captureLogger();
  const tabs = connectFriendPushes({
    io,
    domainEvents,
    friendComponent: {
      viewFor: async ({ playerId }) => ({ friends: [], for: playerId }),
      presenceAudience: async () => ({ handle: "hhhhhhhhhhhhhhh1", presence: "online", friendIds: [ARJUN] }),
      ...friendComponent,
    },
    presence: { connected: async () => undefined, disconnected: () => undefined, ...presence },
    logger,
    now: () => clock.now,
  });
  return { io, domainEvents, entries, tabs };
}

describe("friend pushes (CC-052)", () => {
  it("pushes each changed view to the player's own tabs once, and reads nothing for a player with none", async () => {
    const viewFor = vi.fn(async ({ playerId }) => ({ friends: [], for: playerId }));
    const { io, domainEvents } = setup({ online: [RIYA], friendComponent: { viewFor } });

    domainEvents.emit(FRIEND_EVENTS.CHANGED, { playerIds: [RIYA, ARJUN, RIYA] });
    await settled();

    expect(io.sent).toEqual([
      {
        channel: `player:${RIYA}`,
        event: SOCKET_EVENTS.FRIENDS_UPDATED,
        payload: { friends: [], for: RIYA },
      },
    ]);
    expect(viewFor).toHaveBeenCalledTimes(1);
  });

  it("pushes a new request to its recipient only", async () => {
    const { io, domainEvents } = setup();
    const request = { requestId: "r", displayName: "RiyaTest", via: "game", ringAt: 1 };

    domainEvents.emit(FRIEND_EVENTS.REQUESTED, { recipientId: ARJUN, request });
    await settled();

    expect(io.sent).toEqual([
      { channel: `player:${ARJUN}`, event: SOCKET_EVENTS.FRIEND_REQUESTED, payload: request },
    ]);
  });

  it("pushes a presence change to each friend, as a handle and a presence only", async () => {
    const { io, domainEvents } = setup();

    domainEvents.emit(PRESENCE_EVENTS.CHANGED, { playerId: RIYA });
    await settled();

    expect(io.sent).toEqual([
      {
        channel: `player:${ARJUN}`,
        event: SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED,
        payload: { handle: "hhhhhhhhhhhhhhh1", presence: "online" },
      },
    ]);
  });

  it("never pushes what friends already see, so a player who appears offline shows nothing (ADR-066.6)", async () => {
    let shown = "offline";
    const { io, domainEvents } = setup({
      friendComponent: {
        presenceAudience: async () => ({ handle: "hhhhhhhhhhhhhhh1", presence: shown, friendIds: [ARJUN] }),
      },
    });

    for (const next of ["offline", "offline", "online", "online", "offline"]) {
      shown = next;
      domainEvents.emit(PRESENCE_EVENTS.CHANGED, { playerId: RIYA });
      await settled();
    }

    expect(io.sent.map((sent) => sent.payload.presence)).toEqual(["offline", "online", "offline"]);
  });

  it("logs a push that fails and sends nothing", async () => {
    const down = async () => Promise.reject(new Error("database down"));
    const { io, domainEvents, entries } = setup({
      friendComponent: { viewFor: down, presenceAudience: down },
    });

    domainEvents.emit(FRIEND_EVENTS.CHANGED, { playerIds: [RIYA] });
    domainEvents.emit(PRESENCE_EVENTS.CHANGED, { playerId: RIYA });
    await settled();

    expect(io.sent).toEqual([]);
    expect(entries.map((entry) => entry.msg)).toEqual(
      expect.arrayContaining(["pushing a friends view failed", "pushing a presence change failed"]),
    );
  });

  it("tells the presence tracker of tabs, and logs a failure to record one", async () => {
    const seen = [];
    const { tabs, entries } = setup({
      presence: {
        connected: async ({ playerId }) =>
          playerId === ARJUN ? Promise.reject(new Error("down")) : seen.push(playerId),
        disconnected: ({ playerId }) => seen.push(`closed ${playerId}`),
      },
    });

    tabs.tabOpened(RIYA);
    tabs.tabOpened(ARJUN);
    tabs.tabClosed(RIYA);
    await settled();

    expect(seen).toEqual([RIYA, `closed ${RIYA}`]);
    expect(entries.map((entry) => entry.msg)).toContain("recording a player's presence failed");
  });

  describe("a request whose ring a browser may have missed (CC-341)", () => {
    const RING = { requestId: "r1", displayName: "RiyaTest", via: "game", ringAt: 1 };
    const tabOf = () => {
      const emitted = [];
      return { emitted, socket: { emit: (event, payload) => emitted.push({ event, payload }) } };
    };

    it("is sent to a tab that connects when no tab of its browser was connected as it rang, to that tab only", async () => {
      const missedRings = vi.fn(async () => [RING]);
      const { io, domainEvents, tabs } = setup({ online: [], friendComponent: { missedRings } });
      domainEvents.emit(FRIEND_EVENTS.REQUESTED, { recipientId: ARJUN, request: RING });
      await settled();
      const tab = tabOf();

      io.online.push(ARJUN);
      tabs.tellMissed({ socket: tab.socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
      await settled();

      expect(missedRings).toHaveBeenCalledWith({ playerId: ARJUN, now: 1 });
      expect(tab.emitted).toEqual([{ event: SOCKET_EVENTS.FRIEND_REQUESTED, payload: RING }]);
    });

    it("is not sent again to a browser that heard it, so a reload shows it once", async () => {
      const { domainEvents, tabs } = setup({
        online: [ARJUN],
        friendComponent: { missedRings: async () => [RING] },
      });
      domainEvents.emit(FRIEND_EVENTS.REQUESTED, { recipientId: ARJUN, request: RING });
      await settled();
      const reloaded = tabOf();

      tabs.tellMissed({ socket: reloaded.socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
      await settled();

      expect(reloaded.emitted).toEqual([]);
    });

    it("is sent once to a browser that missed it: its next tabs and reloads do not get it again", async () => {
      const { tabs } = setup({ online: [], friendComponent: { missedRings: async () => [RING] } });
      const first = tabOf();
      const second = tabOf();

      tabs.tellMissed({ socket: first.socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
      await settled();
      tabs.tellMissed({ socket: second.socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
      await settled();

      expect(first.emitted).toHaveLength(1);
      expect(second.emitted).toEqual([]);
    });

    it("is sent again when it rings again, and to another browser of the player's", async () => {
      const again = { ...RING, ringAt: 2 };
      const rings = [RING];
      const { tabs } = setup({ online: [], friendComponent: { missedRings: async () => rings } });
      tabs.tellMissed({ socket: tabOf().socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
      await settled();
      const phone = tabOf();
      tabs.tellMissed({ socket: phone.socket, playerId: ARJUN, sessionId: "another browser" });
      await settled();
      rings.splice(0, 1, again);
      const later = tabOf();
      tabs.tellMissed({ socket: later.socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
      await settled();

      expect(phone.emitted.map(({ payload }) => payload)).toEqual([RING]);
      expect(later.emitted.map(({ payload }) => payload)).toEqual([again]);
    });

    it("forgets what each browser heard once the ring is too old to be sent again", async () => {
      const clock = { now: 1 };
      const { tabs } = setup({ online: [], clock, friendComponent: { missedRings: async () => [RING] } });
      tabs.tellMissed({ socket: tabOf().socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
      await settled();
      expect(tabs.remembered()).toBe(1);

      clock.now = 1 + 15 * 60 * 1000;
      tabs.tellMissed({ socket: tabOf().socket, playerId: ARJUN, sessionId: "another browser" });
      await settled();

      expect(tabs.remembered()).toBe(1);
    });
  });

  it("still pushes a request when it cannot tell who is connected, and logs that", async () => {
    const { io, domainEvents, entries } = setup();
    io.in = () => ({ fetchSockets: async () => Promise.reject(new Error("down")) });
    const request = { requestId: "r", displayName: "RiyaTest", via: "game", ringAt: 1 };

    domainEvents.emit(FRIEND_EVENTS.REQUESTED, { recipientId: ARJUN, request });
    await settled();

    expect(io.sent).toEqual([
      { channel: `player:${ARJUN}`, event: SOCKET_EVENTS.FRIEND_REQUESTED, payload: request },
    ]);
    expect(entries.map((entry) => entry.msg)).toContain("pushing who heard a friend request failed");
  });

  it("logs a failure to read the missed requests and sends nothing", async () => {
    const { tabs, entries } = setup({
      friendComponent: { missedRings: async () => Promise.reject(new Error("down")) },
    });
    const socket = { emit: vi.fn() };

    tabs.tellMissed({ socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
    await settled();

    expect(socket.emit).not.toHaveBeenCalled();
    expect(entries.map((entry) => entry.msg)).toContain("pushing missed friend requests failed");
  });
});
