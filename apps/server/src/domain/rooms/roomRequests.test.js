import { describe, expect, it } from "vitest";
import { REQUEST_STATES, ROOM_REQUEST_TYPES, ROOM_STATUS } from "@classicade/shared";
import { ConflictError, ForbiddenError, ValidationError } from "../../utils/errors.js";
import { ROOM_LIFETIMES } from "./roomLifetimes.js";
import {
  addRequest,
  askAgainAt,
  declineByMoving,
  endRequest,
  openRequest,
  requestsLeft,
  requireAnswerer,
  ruleFor,
  sameRequests,
  settleRequests,
} from "./roomRequests.js";

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const lifetimes = ROOM_LIFETIMES;
const chess = { requestTypes: { draw: { lifetimeMs: 30_000, limitPerPlayer: 3 } } };
const rules = (type) => ruleFor({ type, engine: chess, lifetimes });
const seats = [
  { playerId: "alice", displayName: "Alice", connected: true },
  { playerId: "bob", displayName: "Bob", connected: true },
];
const playing = Object.freeze({ status: ROOM_STATUS.PLAYING, seats, game: { log: [] }, requests: [] });
const finished = Object.freeze({
  status: ROOM_STATUS.FINISHED,
  seats,
  rematch: { available: true },
  requests: [],
});

const ask = (room, { playerId = "alice", type = "draw", now = T0 } = {}) =>
  addRequest(room, { playerId, type, now, rule: rules(type), lifetimes });

describe("room requests (CC-159)", () => {
  it("knows a rematch after the game and the game's own kinds during it, and nothing else", () => {
    expect(rules(ROOM_REQUEST_TYPES.REMATCH)).toEqual({
      status: ROOM_STATUS.FINISHED,
      lifetimeMs: 60_000,
      limitPerPlayer: Number.POSITIVE_INFINITY,
    });
    expect(rules("draw")).toEqual({ status: ROOM_STATUS.PLAYING, lifetimeMs: 30_000, limitPerPlayer: 3 });
    expect(rules("takeback")).toBeUndefined();
    expect(ruleFor({ type: "draw", engine: {}, lifetimes })).toBeUndefined();
  });

  it("opens a request to the other player, with its times, and counts it against the asker's limit", () => {
    const room = ask(playing);

    expect(openRequest(room, "draw")).toEqual({
      type: "draw",
      from: "alice",
      to: "bob",
      createdAt: T0,
      expiresAt: T0 + 30_000,
      state: REQUEST_STATES.OPEN,
      endedAt: 0,
    });
    expect(requestsLeft(room, { viewerId: "alice", engine: chess, lifetimes })).toEqual({ draw: 2 });
    expect(requestsLeft(room, { viewerId: "bob", engine: chess, lifetimes })).toEqual({ draw: 3 });
    expect(playing.requests).toEqual([]);
  });

  it("does not count a rematch, which has no limit", () => {
    const room = ask(finished, { type: ROOM_REQUEST_TYPES.REMATCH });

    expect(room.game).toBeUndefined();
    expect(openRequest(room, ROOM_REQUEST_TYPES.REMATCH).expiresAt).toBe(T0 + 60_000);
    expect(requestsLeft(room, { viewerId: "alice", engine: chess, lifetimes })).toEqual({});
  });

  it("refuses an unknown kind, the wrong moment, a room without one other player and a second open request", () => {
    expect(() =>
      addRequest(playing, { playerId: "alice", type: "x", now: T0, rule: undefined, lifetimes }),
    ).toThrow(ValidationError);
    expect(() => ask(playing, { type: ROOM_REQUEST_TYPES.REMATCH })).toThrow(
      "A rematch is only possible after the game is over",
    );
    expect(() => ask(finished)).toThrow("That is only possible while the game is on");
    expect(() => ask({ ...playing, seats: seats.slice(0, 1) })).toThrow(ConflictError);
    expect(() => ask(ask(playing), { playerId: "bob" })).toThrow("You already asked. Wait for the answer");
  });

  it("lets the asker ask again at once after a yes, such as a rematch whose game ended in seconds", () => {
    const asked = ask(finished, { type: ROOM_REQUEST_TYPES.REMATCH });
    const accepted = endRequest(asked, {
      request: openRequest(asked, ROOM_REQUEST_TYPES.REMATCH),
      state: REQUEST_STATES.ACCEPTED,
      now: T0 + 1_000,
    });

    expect(askAgainAt(accepted, { viewerId: "alice", lifetimes })).toEqual({});
    expect(
      openRequest(ask(accepted, { type: ROOM_REQUEST_TYPES.REMATCH, now: T0 + 2_000 }), "rematch"),
    ).toEqual(expect.objectContaining({ from: "alice", createdAt: T0 + 2_000 }));
  });

  it("makes the asker wait after a no, and stops them once their offers are used up", () => {
    const declined = (room, now) =>
      endRequest(room, { request: openRequest(room, "draw"), state: REQUEST_STATES.DECLINED, now });
    let room = declined(ask(playing), T0 + 1_000);

    expect(() => ask(room, { now: T0 + 5_000 })).toThrow(
      expect.objectContaining({ details: { retryAt: T0 + 11_000 } }),
    );
    expect(askAgainAt(room, { viewerId: "alice", lifetimes })).toEqual({ draw: T0 + 11_000 });
    expect(askAgainAt(room, { viewerId: "bob", lifetimes })).toEqual({});

    room = declined(ask(room, { now: T0 + 11_000 }), T0 + 12_000);
    room = declined(ask(room, { now: T0 + 22_000 }), T0 + 23_000);

    expect(requestsLeft(room, { viewerId: "alice", engine: chess, lifetimes })).toEqual({ draw: 0 });
    expect(() => ask(room, { now: T0 + 40_000 })).toThrow("You can ask that 3 times a game");
    expect(ask(room, { playerId: "bob", now: T0 + 40_000 }).requests.at(-1).from).toBe("bob");
  });

  it("expires an open request whose time is up, at the moment it was due", () => {
    const room = ask(playing);

    expect(settleRequests(room, { now: T0 + 29_999, rules, lifetimes })).toBe(room);
    expect(settleRequests(room, { now: T0 + 31_000, rules, lifetimes }).requests).toEqual([
      expect.objectContaining({ state: REQUEST_STATES.EXPIRED, endedAt: T0 + 30_000 }),
    ]);
  });

  it("drops an open request that no longer makes sense, without an answer", () => {
    const draw = ask(playing);
    const rematch = ask(finished, { type: ROOM_REQUEST_TYPES.REMATCH });
    const settled = (room) => settleRequests(room, { now: T0 + 1, rules, lifetimes }).requests;

    expect(settled({ ...draw, status: ROOM_STATUS.FINISHED })).toEqual([]);
    expect(settled({ ...draw, seats: seats.slice(0, 1) })).toEqual([]);
    expect(settled({ ...rematch, rematch: { available: false } })).toEqual([]);
    expect(settled({ ...draw, requests: [{ ...draw.requests[0], type: "takeback" }] })).toEqual([]);
  });

  it("keeps an answer while it is shown and the cooldown runs, then forgets it", () => {
    const asked = ask(playing);
    const room = endRequest(asked, {
      request: openRequest(asked, "draw"),
      state: REQUEST_STATES.ACCEPTED,
      now: T0,
    });

    expect(settleRequests(room, { now: T0 + 9_999, rules, lifetimes })).toBe(room);
    expect(settleRequests(room, { now: T0 + 10_000, rules, lifetimes }).requests).toEqual([]);
  });

  it("lets only the player asked answer, and only the asker withdraw", () => {
    const request = openRequest(ask(playing), "draw");

    expect(() => requireAnswerer({ request, playerId: "bob", byAsker: false })).not.toThrow();
    expect(() => requireAnswerer({ request, playerId: "alice", byAsker: true })).not.toThrow();
    expect(() => requireAnswerer({ request, playerId: "alice", byAsker: false })).toThrow(
      new ForbiddenError("That was not asked of you"),
    );
    expect(() => requireAnswerer({ request, playerId: "bob", byAsker: true })).toThrow(
      "Only the player who asked can withdraw it",
    );
  });

  it("declines what the opponent asked when the player asked makes a move, and leaves the asker's own move alone", () => {
    const room = ask(playing);

    expect(declineByMoving(room, { playerId: "alice", now: T0 + 1 })).toEqual(room);
    expect(declineByMoving(room, { playerId: "bob", now: T0 + 1 }).requests).toEqual([
      expect.objectContaining({ state: REQUEST_STATES.DECLINED, endedAt: T0 + 1 }),
    ]);
    const rematch = ask(finished, { type: ROOM_REQUEST_TYPES.REMATCH });
    expect(declineByMoving(rematch, { playerId: "bob", now: T0 + 1 })).toEqual(rematch);
  });

  it("treats a room stored before requests existed as having none", () => {
    const { requests: _none, ...old } = playing;

    expect(openRequest(old, "draw")).toBeUndefined();
    expect(settleRequests(old, { now: T0, rules, lifetimes })).toBe(old);
    expect(sameRequests(old.requests, [])).toBe(true);
    expect(sameRequests([], ask(playing).requests)).toBe(false);
  });
});
