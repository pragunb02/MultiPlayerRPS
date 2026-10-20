import { describe, expect, it } from "vitest";
import {
  FRIEND_ANSWERS,
  FRIEND_PRESENCE,
  FRIEND_REQUEST_RESULTS,
  FRIEND_REQUEST_VIA,
  FRIEND_RULES,
  isFriendLinkToken,
  SOCKET_EVENTS,
} from "./index.js";

describe("friends (CC-052)", () => {
  it.each([
    ["FRIEND_PRESENCE", FRIEND_PRESENCE],
    ["FRIEND_REQUEST_VIA", FRIEND_REQUEST_VIA],
    ["FRIEND_ANSWERS", FRIEND_ANSWERS],
    ["FRIEND_REQUEST_RESULTS", FRIEND_REQUEST_RESULTS],
  ])("%s is frozen with unique values", (_name, constants) => {
    expect(Object.isFrozen(constants)).toBe(true);
    expect(new Set(Object.values(constants)).size).toBe(Object.values(constants).length);
  });

  it("names presence without ever naming a room or a game", () => {
    expect(Object.values(FRIEND_PRESENCE).sort()).toEqual(["offline", "online", "playing"]);
  });

  it("keeps the numbers players are told in one frozen place (ADR-066.8)", () => {
    expect(FRIEND_RULES).toEqual({ maxFriends: 200, maxWaiting: 10, requestDays: 30, linkDays: 7 });
    expect(Object.isFrozen(FRIEND_RULES)).toBe(true);
  });

  it("has its own socket events, apart from the room's", () => {
    expect([
      SOCKET_EVENTS.FRIENDS_UPDATED,
      SOCKET_EVENTS.FRIEND_REQUESTED,
      SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED,
    ]).toEqual(["friends:updated", "friends:request", "friends:presence"]);
  });

  it("accepts only 22 base64url characters as a friend link token, never a player id", () => {
    expect(isFriendLinkToken("AbCdEfGhIjKlMnOpQrSt_-")).toBe(true);
    for (const other of [
      "A".repeat(21),
      "A".repeat(23),
      "AbCdEfGhIjKlMnOpQrSt+/",
      "user_0123456789abcdef01234567",
      "guest_00000000-0000-4000-8000-000000000001",
      "",
      undefined,
      22,
    ]) {
      expect(isFriendLinkToken(other)).toBe(false);
    }
  });
});
