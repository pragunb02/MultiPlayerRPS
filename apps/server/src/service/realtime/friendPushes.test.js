import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { FRIEND_EVENTS } from "../../domain/friends/friendComponent.js";
import { PRESENCE_EVENTS } from "../../domain/friends/presenceTracker.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { connectFriendPushes } from "./friendPushes.js";

const RIYA = "user_aaaaaaaaaaaaaaaaaaaaaaaa";
const ARJUN = "user_dddddddddddddddddddddddd";

/** A Socket.IO server that records what it sent to each channel, with tabs open for `online` players only. */
function fakeIo(online = []) {
  const sent = [];
  return {
    sent,
    in: (channel) => ({
      fetchSockets: async () => (online.some((id) => channel === `player:${id}`) ? [{}] : []),
    }),
    to: (channel) => ({ emit: (event, payload) => sent.push({ channel, event, payload }) }),
  };
}

/** Lets every promise started by an event settle. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

function setup({ online = [RIYA, ARJUN], friendComponent = {}, presence = {} } = {}) {
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
    now: () => 1,
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

  it("pushes a new request to its recipient only", () => {
    const { io, domainEvents } = setup();
    const request = { requestId: "r", displayName: "RiyaTest", via: "game" };

    domainEvents.emit(FRIEND_EVENTS.REQUESTED, { recipientId: ARJUN, request });

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
});
