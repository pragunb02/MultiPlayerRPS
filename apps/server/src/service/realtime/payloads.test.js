import { describe, expect, it } from "vitest";
import { ValidationError } from "../../utils/errors.js";
import { parseCreateRoom, parseGameMove, parseRoomRef } from "./payloads.js";

describe("socket payload validation", () => {
  describe("parseCreateRoom", () => {
    it("accepts a game id with optional options", () => {
      expect(parseCreateRoom({ gameId: "rps", options: { bestOf: 3 } })).toEqual({
        gameId: "rps",
        options: { bestOf: 3 },
      });
      expect(parseCreateRoom({ gameId: "chess" })).toEqual({ gameId: "chess", options: {} });
    });

    it.each([
      undefined,
      null,
      "rps",
      [],
      { gameId: "RPS" },
      { gameId: "rps; drop" },
      { gameId: "rps", options: [] },
      { gameId: "rps", options: "x" },
      { gameId: "rps", extra: true },
      { gameId: "rps", options: { blob: "x".repeat(2_000) } },
    ])("rejects %j", (raw) => {
      expect(() => parseCreateRoom(raw)).toThrow(ValidationError);
    });
  });

  describe("parseRoomRef", () => {
    it("normalises the room code", () => {
      expect(parseRoomRef({ code: " ab2cd3 " })).toEqual({ code: "AB2CD3" });
    });

    it.each([{}, { code: "nope" }, { code: "AB2CD3", playerId: "guest_x" }])("rejects %j", (raw) => {
      expect(() => parseRoomRef(raw)).toThrow(ValidationError);
    });
  });

  describe("parseGameMove", () => {
    it("passes the move through untouched (the engine validates it)", () => {
      expect(parseGameMove({ code: "AB2CD3", move: { add: 1 } })).toEqual({
        code: "AB2CD3",
        move: { add: 1 },
      });
    });

    it.each([
      { code: "AB2CD3" },
      { code: "AB2CD3", move: { blob: "x".repeat(3_000) } },
      { code: "bad", move: {} },
      { code: "AB2CD3", move: {}, playerId: "someone-else" },
    ])("rejects %j", (raw) => {
      expect(() => parseGameMove(raw)).toThrow(ValidationError);
    });
  });
});
