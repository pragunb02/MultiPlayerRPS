import { describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { captureLogger } from "../../testing/captureLogger.js";
import { GoneError, NotFoundError } from "../../utils/errors.js";
import { pushRoomRatings, seatRatings } from "./ratingHandlers.js";

const ROOM = Object.freeze({ code: "AB2CD3", seats: [{ playerId: "guest_a" }, { playerId: "user_b" }] });
const rating = (playerId, value = 1500) => ({
  playerId,
  rating: value,
  deviation: 350,
  games: 0,
  provisional: true,
});
const shown = (seat, value = 1500) => ({ seat, rating: value, deviation: 350, games: 0, provisional: true });

/** A fake Socket.IO server that records what it sent to which channel. */
function fakeIo() {
  const sent = [];
  return { sent, to: (channel) => ({ emit: (event, payload) => sent.push({ channel, event, payload }) }) };
}

describe("rating handlers", () => {
  it("names each rating by its seat, in seat order, and never by player id", () => {
    const ratings = seatRatings({ room: ROOM, ratings: [rating("user_b", 1612), rating("guest_a")] });

    expect(ratings).toEqual([shown(0), shown(1, 1612)]);
  });

  it("leaves out a player who no longer sits in the room", () => {
    expect(seatRatings({ room: ROOM, ratings: [rating("guest_gone")] })).toEqual([]);
  });

  it("pushes a rated game's ratings to the room, by seat", async () => {
    const io = fakeIo();

    await pushRoomRatings({
      io,
      roomComponent: { getRoom: async () => ROOM },
      logger: captureLogger().logger,
      update: { roomCode: "AB2CD3", matchId: "m1", ratings: [rating("user_b")] },
    });

    expect(io.sent).toEqual([
      {
        channel: "room:AB2CD3",
        event: SOCKET_EVENTS.RATING_UPDATED,
        payload: { matchId: "m1", ratings: [shown(1)] },
      },
    ]);
  });

  it.each([
    ["closed", new GoneError("closed")],
    ["gone", new NotFoundError("gone")],
  ])("pushes nothing to a room that has %s since", async (_name, error) => {
    const io = fakeIo();

    await pushRoomRatings({
      io,
      roomComponent: { getRoom: async () => Promise.reject(error) },
      logger: captureLogger().logger,
      update: { roomCode: "AB2CD3", matchId: "m1", ratings: [rating("guest_a")] },
    });

    expect(io.sent).toEqual([]);
  });

  it("logs any other failure instead of passing it on", async () => {
    const { logger, find } = captureLogger();

    await pushRoomRatings({
      io: fakeIo(),
      roomComponent: { getRoom: async () => Promise.reject(new Error("db down")) },
      logger,
      update: { roomCode: "AB2CD3", matchId: "m1", ratings: [] },
    });

    const [entry] = find("failed to push the chess ratings");
    expect(entry).toEqual(expect.objectContaining({ level: 50, roomCode: "AB2CD3" }));
    expect(entry.err.message).toBe("db down");
  });
});
