import { describe, expect, it } from "vitest";
import { FRIEND_PRESENCE, ROOM_STATUS } from "@classicade/shared";
import { createPresenceTracker, PRESENCE_EVENTS } from "./presenceTracker.js";

const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const PIP = "bot_pip_easy";

const room = (code, status, ...playerIds) => ({
  code,
  status,
  seats: playerIds.map((playerId) => ({ playerId, ...(playerId.startsWith("bot_") && { bot: {} }) })),
});

function setup(seated = {}) {
  const announced = [];
  const tracker = createPresenceTracker({
    rooms: { seatedRooms: async ({ playerId }) => seated[playerId] ?? [] },
    events: { emit: (name, payload) => announced.push([name, payload.playerId]) },
  });
  return { tracker, announced, changes: () => announced.map(([, playerId]) => playerId) };
}

describe("presence tracker (CC-052, ADR-066.6)", () => {
  it("needs the rooms and the events", () => {
    expect(() => createPresenceTracker({})).toThrow(/rooms.seatedRooms/);
    expect(() => createPresenceTracker({ rooms: { seatedRooms: async () => [] } })).toThrow(/events.emit/);
  });

  it("shows a player online while any tab is open, and announces only the changes", async () => {
    const { tracker, announced } = setup();

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.OFFLINE);
    await tracker.connected({ playerId: RIYA });
    await tracker.connected({ playerId: RIYA });
    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.ONLINE);
    tracker.disconnected({ playerId: RIYA });
    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.ONLINE);
    tracker.disconnected({ playerId: RIYA });

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.OFFLINE);
    expect(announced).toEqual([
      [PRESENCE_EVENTS.CHANGED, RIYA],
      [PRESENCE_EVENTS.CHANGED, RIYA],
    ]);
  });

  it("does nothing for a tab closing that it never saw open", () => {
    const { tracker, announced } = setup();

    tracker.disconnected({ playerId: RIYA });

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.OFFLINE);
    expect(announced).toEqual([]);
  });

  it("shows playing while a connected player sits in a room whose game is on, never for a computer", async () => {
    const { tracker, changes } = setup();
    await tracker.connected({ playerId: RIYA });

    tracker.roomChanged(room("ROOM22", ROOM_STATUS.WAITING, RIYA));
    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.ONLINE);
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.PLAYING, RIYA, PIP));
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.PLAYING, RIYA, PIP));
    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.PLAYING);
    expect(tracker.statusOf(PIP)).toBe(FRIEND_PRESENCE.OFFLINE);
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.FINISHED, RIYA, PIP));

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.ONLINE);
    expect(changes()).toEqual([RIYA, RIYA, RIYA]);
  });

  it("stays playing while any of the player's games is on, and forgets a seat they left", async () => {
    const { tracker } = setup();
    await tracker.connected({ playerId: RIYA });
    await tracker.connected({ playerId: ARJUN });
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.PLAYING, RIYA, ARJUN));
    tracker.roomChanged(room("ROOM33", ROOM_STATUS.PLAYING, RIYA, PIP));

    tracker.roomChanged(room("ROOM22", ROOM_STATUS.PLAYING, RIYA));
    expect(tracker.statusOf(ARJUN)).toBe(FRIEND_PRESENCE.ONLINE);
    tracker.roomClosed({ code: "ROOM22" });
    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.PLAYING);
    tracker.roomClosed({ code: "ROOM33" });
    tracker.roomClosed({ code: "NEVER1" });

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.ONLINE);
  });

  it("shows a disconnected player offline even in a game, and playing again when they come back", async () => {
    const { tracker, changes } = setup();
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.PLAYING, RIYA, ARJUN));
    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.OFFLINE);
    expect(changes()).toEqual([]);

    await tracker.connected({ playerId: RIYA });

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.PLAYING);
  });

  it("leaves a room that changed while the first tab's rooms were being read to its own change", async () => {
    let answer;
    const announced = [];
    const tracker = createPresenceTracker({
      rooms: { seatedRooms: () => new Promise((resolve) => (answer = resolve)) },
      events: { emit: (name, payload) => announced.push(payload.playerId) },
    });

    const connecting = tracker.connected({ playerId: RIYA });
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.FINISHED, RIYA, ARJUN));
    tracker.roomClosed({ code: "ROOM33" });
    answer([
      room("ROOM22", ROOM_STATUS.PLAYING, RIYA, ARJUN),
      room("ROOM33", ROOM_STATUS.PLAYING, RIYA, ARJUN),
    ]);
    await connecting;

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.ONLINE);
    tracker.roomChanged(room("ROOM44", ROOM_STATUS.PLAYING, RIYA, ARJUN));
    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.PLAYING);
  });

  it("keeps the changes it noted while another first tab's rooms are still being read", async () => {
    const answers = {};
    const tracker = createPresenceTracker({
      rooms: { seatedRooms: ({ playerId }) => new Promise((resolve) => (answers[playerId] = resolve)) },
      events: { emit: () => undefined },
    });

    const riya = tracker.connected({ playerId: RIYA });
    const arjun = tracker.connected({ playerId: ARJUN });
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.FINISHED, RIYA, ARJUN));
    answers[RIYA]([]);
    await riya;
    answers[ARJUN]([room("ROOM22", ROOM_STATUS.PLAYING, RIYA, ARJUN)]);
    await arjun;

    expect(tracker.statusOf(ARJUN)).toBe(FRIEND_PRESENCE.ONLINE);
  });

  it("forgets a first tab whose rooms could not be read, and the next change still counts", async () => {
    const tracker = createPresenceTracker({
      rooms: { seatedRooms: async () => Promise.reject(new Error("database down")) },
      events: { emit: () => undefined },
    });

    await expect(tracker.connected({ playerId: RIYA })).rejects.toThrow("database down");
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.PLAYING, RIYA, ARJUN));

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.PLAYING);
  });

  it("reads the rooms of a player's first tab, so a game from before a restart shows", async () => {
    const { tracker, changes } = setup({
      [RIYA]: [
        room("ROOM22", ROOM_STATUS.PLAYING, RIYA, ARJUN),
        room("ROOM33", ROOM_STATUS.FINISHED, RIYA, ARJUN),
      ],
    });

    await tracker.connected({ playerId: RIYA });

    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.PLAYING);
    expect(tracker.statusOf(ARJUN)).toBe(FRIEND_PRESENCE.OFFLINE);
    expect(changes()).toEqual([RIYA, RIYA]);
    tracker.roomChanged(room("ROOM22", ROOM_STATUS.FINISHED, RIYA, ARJUN));
    expect(tracker.statusOf(RIYA)).toBe(FRIEND_PRESENCE.ONLINE);
  });
});
