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
 * A tab's socket as the server holds it. A live page answers each push that asks for an answer; `dead` stands for
 * a socket whose browser went away and that has not timed out yet, which never answers (CC-341).
 */
function fakeTab(sessionId, { dead = false } = {}) {
  const emitted = [];
  return {
    emitted,
    data: { sessionId },
    timeout: (ms) => ({
      emit: (event, payload, answered) => {
        emitted.push({ event, payload, ms });
        setImmediate(() => (dead ? answered(new Error("operation has timed out")) : answered(null)));
      },
    }),
    emit: (event, payload) => emitted.push({ event, payload }),
  };
}

/**
 * A Socket.IO server that records what it sent to each channel, with one tab open for each of the `online` players
 * only, in their session. A test may put its own tabs in `tabs`.
 */
function fakeIo(online = []) {
  const sent = [];
  const tabs = new Map(online.map((id) => [id, [fakeTab(sessionOf(id))]]));
  return {
    sent,
    tabs,
    in: (channel) => ({
      fetchSockets: async () => [...tabs].flatMap(([id, list]) => (channel === `player:${id}` ? list : [])),
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

  it("pushes a new request to each tab of its recipient only, asking each to answer", async () => {
    const { io, domainEvents } = setup();
    const request = { requestId: "r", displayName: "RiyaTest", via: "game", ringAt: 1 };

    domainEvents.emit(FRIEND_EVENTS.REQUESTED, { recipientId: ARJUN, request });
    await settled();

    expect(io.tabs.get(ARJUN)[0].emitted).toEqual([
      { event: SOCKET_EVENTS.FRIEND_REQUESTED, payload: request, ms: 10_000 },
    ]);
    expect(io.tabs.get(RIYA)[0].emitted).toEqual([]);
    expect(io.sent).toEqual([]);
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
    const ring = (domainEvents) =>
      domainEvents.emit(FRIEND_EVENTS.REQUESTED, { recipientId: ARJUN, request: RING });

    it("is noted as heard by a browser only once its page answered the push", async () => {
      const ringsHeard = vi.fn(async () => undefined);
      const { domainEvents } = setup({ online: [ARJUN], friendComponent: { ringsHeard } });

      ring(domainEvents);
      await settled();
      await settled();

      expect(ringsHeard).toHaveBeenCalledWith({ sessionId: sessionOf(ARJUN), rings: [RING], now: 1 });
    });

    it("is not noted as heard by a browser whose socket never answered, so its next socket gets it", async () => {
      const heard = [];
      const ringsHeard = vi.fn(async ({ sessionId, rings }) => heard.push(...rings.map(() => sessionId)));
      const missedRings = vi.fn(async ({ sessionId }) => (heard.includes(sessionId) ? [] : [RING]));
      const { io, domainEvents, tabs } = setup({ online: [], friendComponent: { ringsHeard, missedRings } });
      io.tabs.set(ARJUN, [fakeTab(sessionOf(ARJUN), { dead: true })]);

      ring(domainEvents);
      await settled();
      await settled();
      const next = fakeTab(sessionOf(ARJUN));
      tabs.tellMissed({ socket: next, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
      await settled();
      await settled();

      expect(ringsHeard).toHaveBeenCalledTimes(1);
      expect(ringsHeard).toHaveBeenCalledWith({ sessionId: sessionOf(ARJUN), rings: [RING], now: 1 });
      expect(missedRings).toHaveBeenCalledWith({ playerId: ARJUN, sessionId: sessionOf(ARJUN), now: 1 });
      expect(next.emitted).toEqual([{ event: SOCKET_EVENTS.FRIEND_REQUESTED, payload: RING, ms: 10_000 }]);
    });

    it("sends a connecting tab what it may have missed, to that tab only, and notes what its page answered", async () => {
      const ringsHeard = vi.fn(async () => undefined);
      const { io, tabs } = setup({ friendComponent: { missedRings: async () => [RING], ringsHeard } });
      const tab = fakeTab("a browser");
      const deadTab = fakeTab("another browser", { dead: true });

      tabs.tellMissed({ socket: tab, playerId: ARJUN, sessionId: "a browser" });
      tabs.tellMissed({ socket: deadTab, playerId: ARJUN, sessionId: "another browser" });
      await settled();
      await settled();

      expect(tab.emitted.map(({ payload }) => payload)).toEqual([RING]);
      expect(ringsHeard.mock.calls).toEqual([[{ sessionId: "a browser", rings: [RING], now: 1 }]]);
      expect(io.sent).toEqual([]);
    });

    it("logs a failure to note a heard ring", async () => {
      const { domainEvents, entries } = setup({
        online: [ARJUN],
        friendComponent: { ringsHeard: async () => Promise.reject(new Error("down")) },
      });

      ring(domainEvents);
      await settled();
      await settled();

      expect(entries.map((entry) => entry.msg)).toContain("pushing a heard ring failed");
    });
  });

  it("logs a failure to find a recipient's tabs", async () => {
    const { io, domainEvents, entries } = setup();
    io.in = () => ({ fetchSockets: async () => Promise.reject(new Error("down")) });

    domainEvents.emit(FRIEND_EVENTS.REQUESTED, {
      recipientId: ARJUN,
      request: { requestId: "r", displayName: "RiyaTest", via: "game", ringAt: 1 },
    });
    await settled();

    expect(entries.map((entry) => entry.msg)).toContain("pushing a friend request failed");
  });

  it("logs a failure to read the missed requests and sends nothing", async () => {
    const { tabs, entries } = setup({
      friendComponent: { missedRings: async () => Promise.reject(new Error("down")) },
    });
    const socket = fakeTab(sessionOf(ARJUN));

    tabs.tellMissed({ socket, playerId: ARJUN, sessionId: sessionOf(ARJUN) });
    await settled();

    expect(socket.emitted).toEqual([]);
    expect(entries.map((entry) => entry.msg)).toContain("pushing missed friend requests failed");
  });
});
