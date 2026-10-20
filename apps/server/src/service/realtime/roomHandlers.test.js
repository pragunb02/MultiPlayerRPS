import { describe, expect, it } from "vitest";
import { captureLogger } from "../../testing/captureLogger.js";
import { ForbiddenError, GoneError, NotFoundError } from "../../utils/errors.js";
import { handleSocketGone, handleSocketOnline, markOnSite } from "./roomHandlers.js";

/** An io stand-in whose channels are empty (the player has no other sockets left). */
const emptyIo = { in: () => ({ fetchSockets: async () => [] }) };

function run(playerDisconnected, { playerOffline = async () => [] } = {}) {
  const capture = captureLogger();
  const promise = handleSocketGone({
    io: emptyIo,
    roomComponent: { playerDisconnected, playerOffline, viewFor: () => ({}) },
    playerId: "guest_a",
    channels: ["room:ROOM22"],
    now: () => 0,
    logger: capture.logger,
  });
  return { promise, ...capture };
}

describe("handleSocketGone", () => {
  it.each([
    new NotFoundError("Room not found"),
    new GoneError("This room has closed"),
    new ForbiddenError("Not in room"),
  ])("quietly ignores rooms that closed or were left meanwhile (%s)", async (err) => {
    const { promise, entries } = run(() => {
      throw err;
    });

    await promise;

    expect(entries).toEqual([]);
  });

  it("logs unexpected failures instead of crashing the disconnect handler", async () => {
    const { promise, find } = run(() => {
      throw new Error("store unavailable");
    });

    await promise;

    expect(find("failed to record disconnect")[0]).toEqual(
      expect.objectContaining({ roomCode: "ROOM22", level: 50 }),
    );
  });

  it("logs a failure to mark the player offline elsewhere, instead of crashing (CC-207)", async () => {
    const { promise, find } = run(async () => ({ code: "ROOM22", seats: [] }), {
      playerOffline: async () => {
        throw new Error("store unavailable");
      },
    });

    await promise;

    expect(find("failed to record that the player went offline")).toHaveLength(1);
  });
});

describe("handleSocketOnline (CC-207)", () => {
  it("logs a failure instead of crashing the connection handler", async () => {
    const capture = captureLogger();
    const socket = { data: { identity: { id: "guest_a" } }, emit: () => undefined };

    await handleSocketOnline({
      socket,
      roomComponent: {
        playerOnline: async () => {
          throw new Error("store unavailable");
        },
      },
      now: () => 0,
      logger: capture.logger,
    });

    expect(capture.find("failed to record that the player came online")).toHaveLength(1);
  });
});

describe("markOnSite (CC-139)", () => {
  const ioWith = (sockets) => ({ in: () => ({ fetchSockets: async () => sockets }) });

  it("records a player with a tab open as on the site, and leaves an offline one alone", async () => {
    const online = [];
    const roomComponent = { playerOnline: async ({ playerId }) => online.push(playerId) };
    const { logger } = captureLogger();

    await markOnSite({ io: ioWith([{}]), roomComponent, playerId: "guest_a", now: () => 0, logger });
    await markOnSite({ io: ioWith([]), roomComponent, playerId: "guest_b", now: () => 0, logger });

    expect(online).toEqual(["guest_a"]);
  });

  it("logs a failure instead of throwing", async () => {
    const capture = captureLogger();

    await markOnSite({
      io: ioWith([{}]),
      roomComponent: {
        playerOnline: async () => {
          throw new Error("store unavailable");
        },
      },
      playerId: "guest_a",
      now: () => 0,
      logger: capture.logger,
    });

    expect(capture.find("failed to record that a player is on the site")).toHaveLength(1);
  });
});
