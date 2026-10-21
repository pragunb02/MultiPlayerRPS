import { randomUUID } from "node:crypto";
import { SUSPENDED_REASON, SUSPENSION_DURATION_MS } from "@classicade/shared";
import { isAccountId } from "../../models/identity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ConflictError, ForbiddenError } from "../../utils/errors.js";

/** What the composition root hears when a suspension starts, so it can cut the account's sockets (ADR-078). */
export const SUSPENSION_EVENTS = Object.freeze({ STARTED: "suspension:started" });

/**
 * What a suspended account is told when it signs in with the right password. The page writes the end date from
 * `details`. Nothing in it names a report, a reason or anyone else (ADR-078, decision 2).
 */
export const SUSPENDED_MESSAGE =
  "This account is paused for now. If you think this is a mistake, tell us through the feedback form";

/** How an export writes the end of a suspension that has none. */
const UNTIL_LIFTED_TEXT = "until lifted";

/**
 * @typedef {Readonly<{ name: string, playerSuspended: (input: { playerId: string, now: number }) => Promise<unknown> }>} SuspensionFollower
 *   one part of the site that lets go of a suspended player: rooms, challenges, friends
 * @typedef {import("../../data/suspensionAccessor.js").Actor} Actor
 */

/**
 * Account suspensions (CC-334, ADR-078). The owner takes an account off the site for 24 hours, 7 days, 30 days or
 * until lifted, with a reason from a closed list. The record is written first, then every session of the account
 * ends (its session version), its sockets are cut (SUSPENSION_EVENTS.STARTED) and each follower lets go of the
 * player. A follower that fails does not stop the others or undo the suspension: it is named in the answer, for the
 * logs. Nobody but the owner is told anything, and nothing here knows who reported.
 *
 * @param {{
 *   suspensionAccessor: ReturnType<typeof import("../../data/suspensionAccessor.js").createSuspensionAccessor>,
 *   accounts: { endSessions: (input: { playerId: string }) => Promise<unknown> },
 *   events: { emit: (name: string, payload: object) => unknown },
 *   followers: ReadonlyArray<SuspensionFollower>,
 *   isProtected: (playerId: string) => boolean,
 *   newId?: () => string,
 * }} deps  `accounts.endSessions` counts the account's session version up (ADR-030.4). `isProtected` answers the
 *   admin accounts, which cannot be suspended, so the owner can never lock the console. `newId` is for tests
 */
export function createSuspensionComponent({
  suspensionAccessor,
  accounts,
  events,
  followers,
  isProtected,
  newId = randomUUID,
}) {
  assertDefined(suspensionAccessor, "suspensionAccessor");
  assertFunction(accounts?.endSessions, "accounts.endSessions");
  assertFunction(events?.emit, "events.emit");
  assertDefined(followers, "followers");
  followers.forEach((follower) =>
    assertFunction(follower.playerSuspended, `${follower.name}.playerSuspended`),
  );
  assertFunction(isProtected, "isProtected");
  assertFunction(newId, "newId");

  const inEffect = (suspension, now) =>
    suspension.liftedAt === undefined && (suspension.endsAt === undefined || suspension.endsAt > now);

  /** What the console shows of a suspension: names and times, never the player's or an admin's id. */
  const viewOf = (suspension, now) =>
    Object.freeze({
      suspensionId: suspension.suspensionId,
      nameThen: suspension.nameThen,
      duration: suspension.duration,
      reason: suspension.reason,
      startedAt: suspension.startedAt,
      ...(suspension.endsAt !== undefined && { endsAt: suspension.endsAt }),
      byName: suspension.byName,
      ...(suspension.liftedAt !== undefined && {
        liftedAt: suspension.liftedAt,
        liftedByName: suspension.liftedByName,
      }),
      active: inEffect(suspension, now),
    });

  /** The suspension of the player in effect now, if any. */
  async function currentOf(playerId, now) {
    return (await suspensionAccessor.listByPlayer(playerId)).find((each) => inEffect(each, now));
  }

  return Object.freeze({
    /**
     * Suspends an account. `duration` and `reason` are already checked by the service layer.
     *
     * @param {{ playerId: string, nameThen: string, duration: string, reason: string, by: Actor, now: number }} input
     * @returns {Promise<Readonly<{ suspension: object, failed: ReadonlyArray<{ name: string, err: unknown }> }>>}
     *   `failed`: the followers that could not let go of the player, for the logs
     * @throws {ConflictError} for a guest, an admin account, or an account suspended already
     */
    async suspend({ playerId, nameThen, duration, reason, by, now }) {
      if (!isAccountId(playerId)) {
        throw new ConflictError("Only an account can be suspended: a guest has no account to pause");
      }
      if (isProtected(playerId)) {
        throw new ConflictError("An admin account can't be suspended");
      }
      if ((await currentOf(playerId, now)) !== undefined) {
        throw new ConflictError("This account is suspended already. Lift it first");
      }
      const lasts = SUSPENSION_DURATION_MS[duration];
      const suspension = await suspensionAccessor.add({
        suspensionId: newId(),
        playerId,
        nameThen,
        duration,
        reason,
        by,
        startedAt: now,
        ...(lasts !== undefined && { endsAt: now + lasts }),
      });
      // The record first, then the version: a sign-in that read the account in between gets a session that its next
      // request ends, and one after sees the record (ADR-078).
      await accounts.endSessions({ playerId });
      events.emit(SUSPENSION_EVENTS.STARTED, { playerId });
      const failed = [];
      for (const follower of followers) {
        try {
          await follower.playerSuspended({ playerId, now });
        } catch (err) {
          failed.push({ name: follower.name, err });
        }
      }
      return Object.freeze({ suspension: viewOf(suspension, now), failed: Object.freeze(failed) });
    },

    /**
     * Lifts a suspension early. Nothing is given back: the player signs in again.
     *
     * @param {{ suspensionId: string, by: Actor, now: number }} input
     * @throws {NotFoundError} for an unknown suspension
     * @throws {ConflictError} when it has ended or was lifted already
     */
    async lift({ suspensionId, by, now }) {
      await suspensionAccessor.get(suspensionId);
      if (!(await suspensionAccessor.lift({ suspensionId, by, at: now }))) {
        throw new ConflictError("This suspension has ended already");
      }
      return viewOf(await suspensionAccessor.get(suspensionId), now);
    },

    /**
     * Refuses a sign-in while the account is suspended. Call it only once the password was right, so the refusal
     * never tells who has an account (ADR-078, decision 3).
     *
     * @param {{ playerId: string, now: number }} input
     * @returns {Promise<void>}
     * @throws {ForbiddenError} with `details: { reason: SUSPENDED_REASON, endsAt? }`, `endsAt` left out until lifted
     */
    async refuseSignIn({ playerId, now }) {
      const current = await currentOf(playerId, now);
      if (current === undefined) return;
      throw new ForbiddenError(SUSPENDED_MESSAGE, {
        details: {
          reason: SUSPENDED_REASON,
          ...(current.endsAt !== undefined && { endsAt: current.endsAt }),
        },
      });
    },

    /** @param {{ playerId: string, now: number }} query @returns {Promise<boolean>} */
    isSuspended: async ({ playerId, now }) => (await currentOf(playerId, now)) !== undefined,

    /**
     * Every suspension of one player for the console, newest first.
     *
     * @param {{ playerId: string, now: number }} query
     */
    historyOf: async ({ playerId, now }) =>
      Object.freeze((await suspensionAccessor.listByPlayer(playerId)).map((each) => viewOf(each, now))),

    /**
     * The suspensions in effect now, newest first, so the owner can lift one whose reports are long gone.
     *
     * @param {{ now: number }} query
     */
    current: async ({ now }) =>
      Object.freeze((await suspensionAccessor.listActive({ at: now })).map((each) => viewOf(each, now))),

    /**
     * The player's own suspensions for their export (CC-035): the reason, the duration and the times, never who
     * acted or anything about a report.
     *
     * @param {{ playerId: string }} query
     */
    exportPlayer: async ({ playerId }) =>
      (await suspensionAccessor.listByPlayer(playerId)).map((each) => ({
        reason: each.reason,
        duration: each.duration,
        startedAt: new Date(each.startedAt).toISOString(),
        endsAt: each.endsAt === undefined ? UNTIL_LIFTED_TEXT : new Date(each.endsAt).toISOString(),
        ...(each.liftedAt !== undefined && { liftedAt: new Date(each.liftedAt).toISOString() }),
      })),

    /**
     * Deletes every suspension of the player with their account (ADR-048.2).
     *
     * @param {{ playerId: string }} input
     */
    erasePlayer: async ({ playerId }) => ({
      erased: { suspensions: await suspensionAccessor.removePlayer(playerId) },
    }),
  });
}
