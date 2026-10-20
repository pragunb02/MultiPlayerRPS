import { IDENTITY_KINDS } from "@classicade/shared";
import { assertFunction } from "../../utils/assert.js";
import { ForbiddenError, NotFoundError } from "../../utils/errors.js";
import { CHALLENGE_EVENTS } from "../challenges/challengeComponent.js";

/** The one answer for anyone who may not be invited, so nothing tells a friend from a stranger or a block. */
const nobody = (cause) => new NotFoundError("We couldn't find that player", { cause });

/** Who a flag is worked out for: the session's identity. Admins have no say over a signed-in flag. */
const flagPlayerOf = ({ id, kind }) => ({ id, kind, admin: false });

/**
 * Invites to friends (CC-052 part 2, ADR-066 and ADR-069 amended): the policy the challenge component asks who a
 * challenge to one person may name. Only a friend of the sender now, and only while the `friend_invites` flag is on
 * for the sender. A handle that is not a friend, an unknown handle, a block either way, a guest and a sender without
 * the flag all get the same 404.
 *
 * It also counts the flag's one success: a friend took an invite, on the sender's side of the flag, because the
 * sender is the one who was shown the Invite button.
 *
 * @param {{
 *   friends: Pick<ReturnType<typeof import("./friendComponent.js").createFriendComponent>, "inviteeOf">,
 *   flags: Pick<ReturnType<typeof import("../flags/flagComponent.js").createFlagComponent>, "isOn" | "recordSuccess">,
 *   events: import("node:events").EventEmitter,
 *   logger: Pick<import("../../utils/logger.js").Logger, "warn">,
 * }} deps  `events` carries the challenge component's events. `logger` hears a success that could not be counted
 */
export function createFriendInvites({ friends, flags, events, logger }) {
  assertFunction(friends?.inviteeOf, "friends.inviteeOf");
  assertFunction(flags?.isOn, "flags.isOn");
  assertFunction(flags?.recordSuccess, "flags.recordSuccess");
  assertFunction(events?.on, "events.on");
  assertFunction(logger?.warn, "logger.warn");

  events.on(CHALLENGE_EVENTS.ACCEPTED, ({ challenge }) => {
    if (challenge.toId === "") return;
    flags
      .recordSuccess("friend_invites", flagPlayerOf({ id: challenge.fromId, kind: IDENTITY_KINDS.USER }))
      .catch((err) => logger.warn({ err }, "counting an invite's success failed"));
  });

  return Object.freeze({
    /**
     * The friend a challenge names: `{ handle }` from the client, or `{ playerId }` for an invite back that the
     * challenge component makes itself.
     *
     * @param {{ from: import("../../models/identity.js").Identity, target: Readonly<{ handle: string } | { playerId: string }>, now: number }} query
     * @returns {Promise<Readonly<{ id: string, displayName: string }>>}
     * @throws {NotFoundError} for everyone who may not be invited, one message for all
     */
    async resolve({ from, target, now }) {
      if (!(await flags.isOn("friend_invites", flagPlayerOf(from)))) throw nobody();
      try {
        return await friends.inviteeOf({ playerId: from.id, target, now });
      } catch (err) {
        if (err instanceof NotFoundError || err instanceof ForbiddenError) throw nobody(err);
        throw err;
      }
    },
  });
}
