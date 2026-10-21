import { describe, expect, it } from "vitest";
import {
  ACCOUNT_MESSAGES,
  DEVICE_BROWSERS,
  DEVICE_SYSTEMS,
  GAME_STATUS,
  IDENTITY_KINDS,
  MOVE_REJECTIONS,
  NOT_COUNTED_REASONS,
  PRESENCE,
  REQUEST_ANSWERS,
  REQUEST_STATES,
  ROOM_CLOSE_REASONS,
  ROOM_CODE_ALPHABET,
  ROOM_END_REASONS,
  ROOM_LIMIT_REASONS,
  ROOM_REQUEST_TYPES,
  ROOM_STATUS,
  SOCKET_EVENTS,
} from "./index.js";

describe.each([
  ["ACCOUNT_MESSAGES", ACCOUNT_MESSAGES],
  ["IDENTITY_KINDS", IDENTITY_KINDS],
  ["SOCKET_EVENTS", SOCKET_EVENTS],
  ["MOVE_REJECTIONS", MOVE_REJECTIONS],
  ["GAME_STATUS", GAME_STATUS],
  ["ROOM_STATUS", ROOM_STATUS],
  ["ROOM_CLOSE_REASONS", ROOM_CLOSE_REASONS],
  ["ROOM_LIMIT_REASONS", ROOM_LIMIT_REASONS],
  ["NOT_COUNTED_REASONS", NOT_COUNTED_REASONS],
  ["ROOM_REQUEST_TYPES", ROOM_REQUEST_TYPES],
  ["REQUEST_STATES", REQUEST_STATES],
  ["REQUEST_ANSWERS", REQUEST_ANSWERS],
  ["PRESENCE", PRESENCE],
  ["ROOM_END_REASONS", ROOM_END_REASONS],
  ["DEVICE_BROWSERS", DEVICE_BROWSERS],
  ["DEVICE_SYSTEMS", DEVICE_SYSTEMS],
])("%s", (_name, constants) => {
  it("is immutable", () => {
    expect(Object.isFrozen(constants)).toBe(true);
  });

  it("has unique values", () => {
    const values = Object.values(constants);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("ROOM_CODE_ALPHABET", () => {
  it("has no duplicate or look-alike characters", () => {
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
    for (const lookAlike of ["0", "O", "1", "I", "L"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(lookAlike);
    }
  });
});
