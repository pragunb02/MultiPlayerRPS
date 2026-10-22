import { describe, expect, it } from "vitest";
import { ValidationError } from "../../utils/errors.js";
import {
  parseCreateRoom,
  parseGameMove,
  parseLeaveRoom,
  parsePlayComputer,
  parseQuickMatch,
  parseRoomAnswer,
  parseRoomRef,
  parseRoomRequest,
} from "./payloads.js";

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

  describe("parseLeaveRoom (CC-112)", () => {
    it("reads whether only a waiting room should be left, which is false unless asked", () => {
      expect(parseLeaveRoom({ code: "ab2cd3" })).toEqual({ code: "AB2CD3", waitingOnly: false });
      expect(parseLeaveRoom({ code: "AB2CD3", waitingOnly: true })).toEqual({
        code: "AB2CD3",
        waitingOnly: true,
      });
    });

    it.each([{ code: "AB2CD3", waitingOnly: "yes" }, { code: "AB2CD3", playerId: "guest_x" }, {}])(
      "rejects %j",
      (raw) => {
        expect(() => parseLeaveRoom(raw)).toThrow(ValidationError);
      },
    );
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

  describe("parsePlayComputer", () => {
    it("accepts a game, a level and optional options", () => {
      expect(parsePlayComputer({ gameId: "rps", level: "easy" })).toEqual({
        gameId: "rps",
        options: {},
        level: "easy",
      });
      expect(parsePlayComputer({ gameId: "rps", level: "hard", options: { bestOf: 5 } })).toEqual({
        gameId: "rps",
        options: { bestOf: 5 },
        level: "hard",
      });
    });

    it.each([
      { gameId: "rps" },
      { gameId: "rps", level: "" },
      { gameId: "rps", level: "Easy" },
      { gameId: "rps", level: 3 },
      { gameId: "rps", level: "x".repeat(17) },
      { gameId: "rps", level: "easy", seat: "bot_rocky_easy" },
      { gameId: "RPS!", level: "easy" },
      { gameId: "rps", level: "easy", options: [] },
    ])("rejects %j", (raw) => {
      expect(() => parsePlayComputer(raw)).toThrow(ValidationError);
    });
  });

  describe("parseQuickMatch (CC-051)", () => {
    it("accepts a game and the character's level, and nothing else", () => {
      expect(parseQuickMatch({ gameId: "chess", level: "easy" })).toEqual({ gameId: "chess", level: "easy" });
    });

    it.each([
      undefined,
      { gameId: "rps" },
      { gameId: "rps", level: "Easy" },
      { gameId: "RPS!", level: "easy" },
      // The pool's options are the server's (ADR-051.6), and a seat or a player is never the client's to name.
      { gameId: "chess", level: "easy", options: { timeControl: "bullet-1+0" } },
      { gameId: "rps", level: "easy", playerId: "guest_x" },
    ])("rejects %j", (raw) => {
      expect(() => parseQuickMatch(raw)).toThrow(ValidationError);
    });
  });

  describe("parseRoomRequest (CC-159)", () => {
    it("normalises the room code and keeps the type for the domain to judge", () => {
      expect(parseRoomRequest({ code: "ab2cd3", type: "rematch" })).toEqual({
        code: "AB2CD3",
        type: "rematch",
      });
    });

    it.each([
      { code: "AB2CD3" },
      { code: "AB2CD3", type: 7 },
      { code: "AB2CD3", type: "Rematch" },
      { code: "AB2CD3", type: "x".repeat(40) },
      { code: "AB2CD3", type: "draw", playerId: "guest_x" },
      { code: "bad", type: "draw" },
    ])("rejects %j", (raw) => {
      expect(() => parseRoomRequest(raw)).toThrow(ValidationError);
    });
  });

  describe("parseRoomAnswer (CC-159)", () => {
    it.each(["accept", "decline", "withdraw"])("accepts the answer %s", (answer) => {
      expect(parseRoomAnswer({ code: "AB2CD3", type: "draw", answer })).toEqual({
        code: "AB2CD3",
        type: "draw",
        answer,
      });
    });

    it.each([
      { code: "AB2CD3", type: "draw" },
      { code: "AB2CD3", type: "draw", answer: "maybe" },
      { code: "AB2CD3", type: "draw", answer: "accept", from: "guest_x" },
      { code: "AB2CD3", type: "Draw", answer: "accept" },
    ])("rejects %j", (raw) => {
      expect(() => parseRoomAnswer(raw)).toThrow(ValidationError);
    });
  });
});
