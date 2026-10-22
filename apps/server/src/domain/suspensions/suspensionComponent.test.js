import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { SUSPENDED_REASON } from "@classicade/shared";
import { createSuspensionAccessor } from "../../data/suspensionAccessor.js";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createInMemorySuspensionDao } from "../../testing/inMemorySuspensionDao.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../utils/errors.js";
import { createSuspensionComponent, SUSPENSION_EVENTS } from "./suspensionComponent.js";

// CC-334, ADR-078: the owner takes an account off the site for a while. One record, then sessions end, sockets are
// cut and the followers (rooms, challenges, friends) let go of the player. Nobody else is told.

const HOUR_MS = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 21, 6);
const BOB = "user_0123456789abcdef01234567";
const OWNER_ID = "user_aaaaaaaaaaaaaaaaaaaaaaaa";
const OWNER = Object.freeze({ id: OWNER_ID, name: "Owner" });
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

let counter = 0;
const newId = () => `00000000-0000-4000-c000-${String(++counter).padStart(12, "0")}`;

function setUp({
  followers = [],
  admins = [OWNER_ID],
  failSessionsOnce = false,
  names = { [BOB]: "Bob" },
} = {}) {
  const ended = [];
  let failNext = failSessionsOnce;
  const events = new EventEmitter();
  const started = [];
  events.on(SUSPENSION_EVENTS.STARTED, (payload) => started.push(payload));
  const suspensions = createSuspensionComponent({
    suspensionAccessor: createSuspensionAccessor({ suspensionDao: createInMemorySuspensionDao() }),
    accounts: {
      async endSessions({ playerId }) {
        if (failNext) {
          failNext = false;
          throw new Error("database blip");
        }
        ended.push(playerId);
      },
      // The account's name now, which may differ from the name in the reports (review of CC-334).
      usernamesOf: async ({ playerIds }) =>
        new Map(playerIds.filter((id) => Object.hasOwn(names, id)).map((id) => [id, names[id]])),
    },
    events,
    followers,
    isProtected: (playerId) => admins.includes(playerId),
    newId,
  });
  return { suspensions, ended, started };
}

const suspendBob = (suspensions, fields = {}) =>
  suspensions.suspend({
    playerId: BOB,
    duration: "7d",
    reason: "harassment",
    by: OWNER,
    now: T0,
    ...fields,
  });

describe("suspensionComponent (CC-334, ADR-078)", () => {
  it("stores the suspension, then ends every session, cuts the sockets and runs the followers in order", async () => {
    const order = [];
    const { suspensions, ended, started } = setUp({
      followers: [
        { name: "rooms", playerSuspended: async ({ playerId }) => order.push(["rooms", playerId]) && 2 },
        { name: "challenges", playerSuspended: async () => order.push(["challenges"]) && 1 },
      ],
    });

    const { suspension, failed } = await suspendBob(suspensions);

    expect(suspension).toEqual({
      suspensionId: expect.any(String),
      nameThen: "Bob",
      duration: "7d",
      reason: "harassment",
      startedAt: T0,
      endsAt: T0 + 7 * 24 * HOUR_MS,
      byName: "Owner",
      active: true,
    });
    expect(failed).toEqual([]);
    expect(ended).toEqual([BOB]);
    expect(started).toEqual([{ playerId: BOB }]);
    expect(order).toEqual([["rooms", BOB], ["challenges"]]);
  });

  it("goes on when a follower fails, and names it so the route can log it", async () => {
    const { suspensions, ended } = setUp({
      followers: [
        { name: "rooms", playerSuspended: async () => Promise.reject(new Error("database blip")) },
        { name: "friends", playerSuspended: async () => 0 },
      ],
    });

    const { failed } = await suspendBob(suspensions);

    expect(failed).toEqual([{ name: "rooms", err: expect.any(Error) }]);
    expect(ended).toEqual([BOB]);
    expect(await suspensions.isSuspended({ playerId: BOB, now: T0 + 1 })).toBe(true);
  });

  it("names the account by its name now, not the name a report saw", async () => {
    const { suspensions } = setUp({ names: { [BOB]: "Player_K7QM2X" } });

    const { suspension } = await suspendBob(suspensions);

    expect(suspension.nameThen).toBe("Player_K7QM2X");
    const gone = setUp({ names: {} });
    await expect(suspendBob(gone.suspensions)).rejects.toThrow(NotFoundError);
  });

  it("applies the effects again when asked to suspend an account already suspended, so a failed first try is finished", async () => {
    const order = [];
    const { suspensions, ended, started } = setUp({
      failSessionsOnce: true,
      followers: [{ name: "rooms", playerSuspended: async () => order.push("rooms") }],
    });

    await expect(suspendBob(suspensions)).rejects.toThrow("database blip");
    expect(await suspensions.isSuspended({ playerId: BOB, now: T0 + 1 })).toBe(true);
    expect(ended).toEqual([]);

    const again = await suspendBob(suspensions, { now: T0 + 1 }).catch((err) => err);

    expect(again).toBeInstanceOf(ConflictError);
    expect(again.message).toBe("This account is suspended already. Lift it first");
    expect(again.details).toEqual({ appliedAgain: true });
    expect(ended).toEqual([BOB]);
    expect(started).toEqual([{ playerId: BOB }]);
    expect(order).toEqual(["rooms"]);
    // Still one suspension: nothing new was stored.
    expect(await suspensions.historyOf({ playerId: BOB, now: T0 + 1 })).toHaveLength(1);
  });

  it("lasts until lifted with no end, and ends by itself after 24 hours, 7 days or 30 days", async () => {
    const { suspensions } = setUp();
    const { suspension } = await suspendBob(suspensions, { duration: "until-lifted" });

    expect(suspension).not.toHaveProperty("endsAt");
    expect(await suspensions.isSuspended({ playerId: BOB, now: T0 + 10_000 * HOUR_MS })).toBe(true);

    const other = setUp();
    await suspendBob(other.suspensions, { duration: "24h" });
    expect(await other.suspensions.isSuspended({ playerId: BOB, now: T0 + 24 * HOUR_MS - 1 })).toBe(true);
    expect(await other.suspensions.isSuspended({ playerId: BOB, now: T0 + 24 * HOUR_MS })).toBe(false);
  });

  it("refuses a guest, an admin account and a second suspension while one lasts", async () => {
    const { suspensions } = setUp();

    await expect(suspendBob(suspensions, { playerId: GUEST })).rejects.toThrow(ConflictError);
    await expect(suspendBob(suspensions, { playerId: OWNER_ID })).rejects.toThrow(ConflictError);
    await suspendBob(suspensions);
    await expect(suspendBob(suspensions, { now: T0 + HOUR_MS })).rejects.toThrow(
      "This account is suspended already. Lift it first",
    );
    // Once it has ended, a new one may start.
    await expect(suspendBob(suspensions, { now: T0 + 8 * 24 * HOUR_MS })).resolves.toBeDefined();
  });

  it("refuses sign-in while it lasts, with the end date and the reason code only", async () => {
    const { suspensions } = setUp();
    const { suspension } = await suspendBob(suspensions);

    const refusal = await suspensions.refuseSignIn({ playerId: BOB, now: T0 + 1 }).catch((err) => err);

    expect(refusal).toBeInstanceOf(ForbiddenError);
    expect(refusal.details).toEqual({ reason: SUSPENDED_REASON, endsAt: suspension.endsAt });
    expect(refusal.message).not.toMatch(/report|harass/i);
    await expect(
      suspensions.refuseSignIn({ playerId: BOB, now: suspension.endsAt }),
    ).resolves.toBeUndefined();
  });

  it("refuses sign-in until lifted without an end date", async () => {
    const { suspensions } = setUp();
    await suspendBob(suspensions, { duration: "until-lifted" });

    const refusal = await suspensions.refuseSignIn({ playerId: BOB, now: T0 + 1 }).catch((err) => err);

    expect(refusal.details).toEqual({ reason: SUSPENDED_REASON });
  });

  it("lifts the current suspension with who and when, once, and the account may sign in again", async () => {
    const { suspensions } = setUp();
    const { suspension } = await suspendBob(suspensions, { duration: "until-lifted" });

    const lifted = await suspensions.lift({
      suspensionId: suspension.suspensionId,
      by: OWNER,
      now: T0 + HOUR_MS,
    });

    expect(lifted).toEqual({ ...suspension, liftedAt: T0 + HOUR_MS, liftedByName: "Owner", active: false });
    await expect(suspensions.refuseSignIn({ playerId: BOB, now: T0 + HOUR_MS })).resolves.toBeUndefined();
    await expect(
      suspensions.lift({ suspensionId: suspension.suspensionId, by: OWNER, now: T0 + 2 * HOUR_MS }),
    ).rejects.toThrow(ConflictError);
    await expect(
      suspensions.lift({ suspensionId: "00000000-0000-4000-c000-ffffffffffff", by: OWNER, now: T0 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("shows the history and the current suspensions with names and times only, never an id", async () => {
    const { suspensions } = setUp();
    const { suspension: first } = await suspendBob(suspensions, { duration: "24h" });
    const { suspension: second } = await suspendBob(suspensions, { now: T0 + 48 * HOUR_MS });

    const history = await suspensions.historyOf({ playerId: BOB, now: T0 + 49 * HOUR_MS });
    const current = await suspensions.current({ now: T0 + 49 * HOUR_MS });

    expect(history).toEqual([second, { ...first, active: false }]);
    expect(current).toEqual([second]);
    const values = JSON.stringify([history, current])
      .match(/"[^"]*"/g)
      .map((text) => JSON.parse(text));
    expect(values.filter(hasPlayerIdShape)).toEqual([]);
  });

  it("exports the player's own suspensions without who acted, and erases them with the account", async () => {
    const { suspensions } = setUp();
    await suspendBob(suspensions, { duration: "24h" });
    await suspendBob(suspensions, { duration: "until-lifted", now: T0 + 48 * HOUR_MS });

    const exported = await suspensions.exportPlayer({ playerId: BOB });

    expect(exported).toEqual([
      {
        reason: "harassment",
        duration: "until-lifted",
        startedAt: new Date(T0 + 48 * HOUR_MS).toISOString(),
        endsAt: "until lifted",
      },
      {
        reason: "harassment",
        duration: "24h",
        startedAt: new Date(T0).toISOString(),
        endsAt: new Date(T0 + 24 * HOUR_MS).toISOString(),
      },
    ]);
    expect(JSON.stringify(exported)).not.toMatch(/Owner|user_/);
    expect(await suspensions.erasePlayer({ playerId: BOB })).toEqual({ erased: { suspensions: 2 } });
    expect(await suspensions.exportPlayer({ playerId: BOB })).toEqual([]);
  });
});
