import { describe, expect, it } from "vitest";
import { ROOM_LIMITS, roomLimits } from "./roomLimits.js";

describe("room limits", () => {
  it("allows three waiting rooms per player, two thousand rooms in all and thirty per address, five tabs and thirty connections per address", () => {
    expect(ROOM_LIMITS).toEqual({
      waitingRoomsPerPlayer: 3,
      openRoomsMax: 2000,
      openRoomsPerAddress: 30,
      socketsPerSession: 5,
      socketsPerAddress: 30,
      eventBurstPerPlayer: 20,
      eventsPerSecondPerPlayer: 10,
    });
    expect(Object.isFrozen(ROOM_LIMITS)).toBe(true);
  });

  it("uses the standard limits unless told otherwise", () => {
    expect(roomLimits()).toEqual(ROOM_LIMITS);
    expect(roomLimits({ openRoomsMax: 1 })).toEqual({ ...ROOM_LIMITS, openRoomsMax: 1 });
    expect(Object.isFrozen(roomLimits({ socketsPerAddress: 9 }))).toBe(true);
  });

  it.each([
    [{ roomsMax: 5 }, /Unknown room limit: roomsMax/],
    [{ openRoomsMax: 0 }, /positive/],
    [{ openRoomsMax: -1 }, /positive/],
    [{ openRoomsMax: 1.5 }, /positive/],
    [{ openRoomsMax: "10" }, /positive/],
  ])("refuses a limit that makes no sense (%o)", (overrides, message) => {
    expect(() => roomLimits(overrides)).toThrow(TypeError);
    expect(() => roomLimits(overrides)).toThrow(message);
  });
});
