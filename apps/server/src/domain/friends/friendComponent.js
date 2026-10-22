import { randomUUID } from "node:crypto";
import {
  FRIEND_ANSWERS,
  FRIEND_LINK_MAKER_NAME,
  FRIEND_PRESENCE,
  FRIEND_REQUEST_RESULTS,
  FRIEND_REQUEST_VIA,
  isAvatarId,
} from "@classicade/shared";
import { FRIEND_REQUEST_STATUS } from "../../data/friendAccessor.js";
import { hashFriendLinkToken, newFriendLinkToken } from "../../models/friendLinkToken.js";
import { isAccountId } from "../../models/identity.js";
import { FRIENDS_MODES, isQuietTime } from "../safety/agePolicy.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { FRIEND_LIMITS, mayReach, MET_THROUGH } from "./friendRules.js";
import { PRESENCE_EVENTS } from "./presenceTracker.js";

/** What the friend component announces on the domain events, for the gateway to push. */
export const FRIEND_EVENTS = Object.freeze({
  /** `{ playerIds }`: the friends view of each of these players changed */
  CHANGED: "friends.changed",
  /** `{ recipientId, request }`: someone was sent a request they can see. `request` is shaped as in their view */
  REQUESTED: "friends.requested",
});

/** Requests their sender sees as waiting. A declined one looks the same to them as one nobody answered yet. */
const WAITING = Object.freeze([FRIEND_REQUEST_STATUS.PENDING, FRIEND_REQUEST_STATUS.DECLINED]);
const PENDING = Object.freeze([FRIEND_REQUEST_STATUS.PENDING]);
const ANSWERS = new Set(Object.values(FRIEND_ANSWERS));

const guestsCannot = () => new ForbiddenError("Save your progress to add friends");
const notPlayedWith = (cause) =>
  new NotFoundError("You can only add someone you played with", cause === undefined ? {} : { cause });
const noSuchRequest = (cause) =>
  new NotFoundError("This request is no longer open", cause === undefined ? {} : { cause });
const noSuchFriend = (cause) => new NotFoundError("No such friend", cause === undefined ? {} : { cause });
const noSuchLink = (cause) =>
  new NotFoundError("This friend link has run out or was used already", cause === undefined ? {} : { cause });
const avatarField = (profile) => (isAvatarId(profile.avatar) ? { avatar: profile.avatar } : {});

/** For a failed read: the caller's own refusal when nothing was found, and any other failure as it is. */
const missingAs = (refusal) => (err) => Promise.reject(err instanceof NotFoundError ? refusal(err) : err);

/** One ring of one request: a request cancelled and sent again rings again, later (CC-341). */
const ringKey = ({ requestId, ringAt }) => `${requestId} ${ringAt}`;

/** A request as its ring tells the recipient: who sent it, how, and when it rang (CC-341), never a player id. */
const ringOf = ({ request, names, cards, ringAt }) =>
  Object.freeze({
    requestId: request.requestId,
    displayName: names.get(request.senderId),
    ...avatarField(cards.get(request.senderId)),
    via: request.via,
    ringAt,
  });

/** A friend link names its maker only when their policy lets their name travel (ADR-028.7, the age policy). */
const linkNameOf = ({ playerId, names, policies }) =>
  policies.get(playerId).shareCardName ? names.get(playerId) : FRIEND_LINK_MAKER_NAME;

/**
 * The name a sender sees for the recipient of their request. Whoever opened a friend link of a player whose policy
 * keeps their name off shared things (a minor, ADR-028.7) does not learn it until they accept, because the link may
 * have been forwarded. The friends view and the data export both name requests through this one rule.
 *
 * @param {{
 *   request: Readonly<{ via: string, recipientId: string }>,
 *   names: ReadonlyMap<string, string>,
 *   policies: ReadonlyMap<string, Readonly<{ shareCardName: boolean }>>,
 * }} people
 */
export const outgoingNameOf = ({ request, names, policies }) =>
  request.via === FRIEND_REQUEST_VIA.LINK
    ? linkNameOf({ playerId: request.recipientId, names, policies })
    : names.get(request.recipientId);

/**
 * Friends (CC-052, ADR-066): mutual, between accounts only, asked from a game the two played or through a friend
 * link, and silent about every no. A declined request, a request into a block and a request a minor may not get all
 * look "sent" to their sender until they run out, and a block or a removal ends a friendship without telling
 * anyone. Friends see each other's presence, never anyone else's, and never which room.
 *
 * Every person here is named to a client by display name, avatar and profile handle (ADR-065), never by player id.
 *
 * @param {{
 *   friendAccessor: ReturnType<typeof import("../../data/friendAccessor.js").createFriendAccessor>,
 *   privacyAccessor: ReturnType<typeof import("../../data/privacyAccessor.js").createPrivacyAccessor>,
 *   profiles: Pick<ReturnType<typeof import("../../data/profileAccessor.js").createProfileAccessor>, "getOrCreateMany" | "getByHandle">,
 *   coPlayers: ReturnType<typeof import("../players/coPlayers.js").createCoPlayers>,
 *   blocks: { blockedWith: (query: { playerId: string }) => Promise<ReadonlySet<string>> },
 *   accounts: { usernamesOf: (query: { playerIds: ReadonlyArray<string> }) => Promise<ReadonlyMap<string, string>> },
 *   safety: Pick<ReturnType<typeof import("../safety/safetyComponent.js").createSafetyComponent>, "policiesFor" | "policyFor">,
 *   presence: { statusOf: (playerId: string) => string },
 *   events: { emit: (name: string, payload: object) => unknown },
 *   limits?: Partial<typeof FRIEND_LIMITS>,
 *   newRequestId?: () => string,
 *   newToken?: () => string,
 * }} deps  `limits`, `newRequestId` and `newToken` are for tests only. `presence` is the presence tracker
 */
export function createFriendComponent({
  friendAccessor,
  privacyAccessor,
  profiles,
  coPlayers,
  blocks,
  accounts,
  safety,
  presence,
  events,
  sessions,
  limits = {},
  newRequestId = randomUUID,
  newToken = newFriendLinkToken,
}) {
  assertDefined(friendAccessor, "friendAccessor");
  assertDefined(privacyAccessor, "privacyAccessor");
  assertFunction(profiles?.getOrCreateMany, "profiles.getOrCreateMany");
  assertFunction(profiles?.getByHandle, "profiles.getByHandle");
  assertFunction(coPlayers?.personAt, "coPlayers.personAt");
  assertFunction(blocks?.blockedWith, "blocks.blockedWith");
  assertFunction(accounts?.usernamesOf, "accounts.usernamesOf");
  assertFunction(safety?.policiesFor, "safety.policiesFor");
  assertFunction(safety?.policyFor, "safety.policyFor");
  assertFunction(presence?.statusOf, "presence.statusOf");
  assertFunction(events?.emit, "events.emit");
  assertFunction(sessions?.addHeardRings, "sessions.addHeardRings");
  assertFunction(sessions?.heardRings, "sessions.heardRings");
  const rules = { ...FRIEND_LIMITS, ...limits };

  const changed = (...playerIds) => events.emit(FRIEND_EVENTS.CHANGED, { playerIds });

  /** Whether the age policy lets the player have friends at all. A guest's does not (owner, ADR-066.1). */
  const mayHaveFriends = (policy) => policy.friendsMode !== FRIENDS_MODES.NONE;

  /** The player's policy, once it lets them have friends. A guest is told to save their progress. */
  async function requireFriends(playerId, now) {
    const policy = await safety.policyFor({ playerId, now });
    if (!mayHaveFriends(policy)) throw guestsCannot();
    return policy;
  }

  /** What friends see of each player: their status, or offline for those who chose to appear offline. */
  async function presenceOf(playerIds) {
    const hidden = await privacyAccessor.appearingOffline(playerIds);
    return (playerId) => (hidden.has(playerId) ? FRIEND_PRESENCE.OFFLINE : presence.statusOf(playerId));
  }

  /** Names, avatars, handles and adulthood of the people among `playerIds`, read once for a whole view. */
  async function peopleOf(playerIds, now) {
    const ids = [...new Set(playerIds)];
    const [names, cards, policies] = await Promise.all([
      accounts.usernamesOf({ playerIds: ids }),
      profiles.getOrCreateMany({ playerIds: ids, at: now }),
      safety.policiesFor({ playerIds: ids, now }),
    ]);
    return { names, cards, policies };
  }

  /** The player's friends, without anyone on either side of a block with them, which a block ends anyway. */
  async function friendsOf(playerId, blocked) {
    return (await friendAccessor.friendsOf(playerId)).filter((friend) => !blocked.has(friend.friendId));
  }

  /**
   * The player's whole friends view. Waiting requests they cannot accept are left out: from someone on either side
   * of a block with them, or one that ran out.
   */
  async function viewFor({ playerId, now }) {
    await requireFriends(playerId, now);
    const blocked = await blocks.blockedWith({ playerId });
    const [friends, incoming, outgoing] = await Promise.all([
      friendsOf(playerId, blocked),
      friendAccessor
        .sentTo({ recipientId: playerId, statuses: PENDING, now, limit: rules.incomingShown })
        .then((list) => list.filter((request) => !blocked.has(request.senderId))),
      friendAccessor.sentBy({ senderId: playerId, statuses: WAITING, now }),
    ]);
    const others = [
      ...friends.map((friend) => friend.friendId),
      ...incoming.map((request) => request.senderId),
      ...outgoing.map((request) => request.recipientId),
    ];
    const [{ names, cards, policies }, presenceOfFriend, appearing] = await Promise.all([
      peopleOf([playerId, ...others], now),
      presenceOf(friends.map((friend) => friend.friendId)),
      privacyAccessor.appearingOffline([playerId]),
    ]);
    const card = (id) => cards.get(id);
    return Object.freeze({
      friends: Object.freeze(
        friends
          .filter((friend) => names.has(friend.friendId))
          .map(({ friendId, since }) =>
            Object.freeze({
              handle: card(friendId).handle,
              displayName: names.get(friendId),
              ...avatarField(card(friendId)),
              presence: presenceOfFriend(friendId),
              since,
              // A profile is linked only when the friend's policy allows it, as on the boards (ADR-065.2).
              ...(policies.get(friendId).profileLink && { profile: card(friendId).handle }),
            }),
          ),
      ),
      incoming: Object.freeze(
        incoming
          .filter((request) => names.has(request.senderId))
          .map((request) =>
            Object.freeze({
              requestId: request.requestId,
              displayName: names.get(request.senderId),
              ...avatarField(card(request.senderId)),
              via: request.via,
              sentAt: request.createdAt,
            }),
          ),
      ),
      outgoing: Object.freeze(
        outgoing
          .filter((request) => names.has(request.recipientId))
          .map((request) =>
            Object.freeze({
              requestId: request.requestId,
              displayName: outgoingNameOf({ request, names, policies }),
              ...avatarField(card(request.recipientId)),
              sentAt: request.createdAt,
            }),
          ),
      ),
      settings: Object.freeze({ appearOffline: appearing.has(playerId) }),
      // A player not surely an adult is shown "Only add people you know" beside the requests (Ofcom ICU F2.3).
      safetyTips: policies.get(playerId).treatedAsMinor,
    });
  }

  /**
   * Tells the recipient of a request they can see, on any page, unless it is their quiet time (22:00 to 07:00 India
   * time for anyone not surely an adult, CC-052 rule 3): then the request waits on their friends page, unannounced.
   */
  async function ring(request, now) {
    const { names, cards, policies } = await peopleOf([request.senderId, request.recipientId], now);
    if (isQuietTime(policies.get(request.recipientId), now)) return;
    events.emit(FRIEND_EVENTS.REQUESTED, {
      recipientId: request.recipientId,
      request: ringOf({ request, names, cards, ringAt: now }),
    });
  }

  /**
   * The requests that rang for the player in the last `missedRingWithinMs` and still wait, as they rang, for a tab
   * that connects and may have missed the push (CC-341). Only what `ring` announced: none rung in the player's
   * quiet hours, none while they are in them, none across a block, none this browser heard. A guest has none.
   */
  async function missedRings({ playerId, sessionId, now }) {
    const policy = await safety.policyFor({ playerId, now });
    if (!mayHaveFriends(policy) || isQuietTime(policy, now)) return [];
    const since = now - rules.missedRingWithinMs;
    const [blocked, heard] = await Promise.all([
      blocks.blockedWith({ playerId }),
      sessions.heardRings({ sessionId, since }),
    ]);
    const heardKeys = new Set(heard.map(ringKey));
    const rung = (
      await friendAccessor.sentTo({
        recipientId: playerId,
        statuses: PENDING,
        now,
        limit: rules.incomingShown,
      })
    ).filter(
      (request) =>
        !blocked.has(request.senderId) &&
        request.notifiedAt > since &&
        !heardKeys.has(ringKey({ requestId: request.requestId, ringAt: request.notifiedAt })) &&
        !isQuietTime(policy, request.notifiedAt),
    );
    if (rung.length === 0) return [];
    const { names, cards } = await peopleOf(
      rung.map((request) => request.senderId),
      now,
    );
    return rung
      .filter((request) => names.has(request.senderId))
      .map((request) => ringOf({ request, names, cards, ringAt: request.notifiedAt }));
  }

  /** Makes two players friends and clears every request between them. */
  async function befriend({ a, b, now }) {
    await friendAccessor.befriend({ a, b, at: now });
    await friendAccessor.removeRequestsBetween({ a, b });
    changed(a, b);
    return { result: FRIEND_REQUEST_RESULTS.FRIENDS };
  }

  /** The player's own friend count must leave room for one more. */
  async function requireRoomForFriend(playerId) {
    if ((await friendAccessor.countFriends(playerId)) >= rules.maxFriends) {
      throw new ConflictError(`You have ${rules.maxFriends} friends. Remove one to add another.`);
    }
  }

  /** Whether a request may reach its recipient: no block either way, and the minors' rule (ADR-051.7). */
  async function reachOf({ senderId, recipientId, met, now }) {
    const [blocked, policies] = await Promise.all([
      blocks.blockedWith({ playerId: senderId }),
      safety.policiesFor({ playerIds: [senderId, recipientId], now }),
    ]);
    return (
      !blocked.has(recipientId) &&
      mayReach({ met, modes: [senderId, recipientId].map((id) => policies.get(id).friendsMode) })
    );
  }

  /**
   * The sender's limits, checked before anything is stored or used up: room for one more friend, and for one more
   * waiting request unless one to them waits already. Answers whether the recipient asked first, so the two become
   * friends, and whether the sender's own request to them waits already.
   */
  async function roomToAsk({ senderId, recipientId, reaches, now }) {
    await requireRoomForFriend(senderId);
    if (reaches) {
      const theirs = await friendAccessor
        .getRequest({ senderId: recipientId, recipientId: senderId })
        .catch((err) => (err instanceof NotFoundError ? undefined : Promise.reject(err)));
      if (theirs !== undefined && WAITING.includes(theirs.status) && theirs.expiresAt > now) {
        return { mutual: true, waiting: false };
      }
    }
    const sent = await friendAccessor.sentBy({ senderId, statuses: WAITING, now });
    const waiting = sent.some((request) => request.recipientId === recipientId);
    if (!waiting && sent.length >= rules.maxWaiting) {
      throw new ConflictError(
        `You have ${rules.maxWaiting} requests waiting. Cancel one, or wait for an answer.`,
      );
    }
    return { mutual: false, waiting };
  }

  /**
   * Sends a request from one account to another, after every rule:
   *
   * 1. Friends already: nothing changes.
   * 2. The recipient asked the sender first, and may still be told: the two are friends now.
   * 3. The sender's own request to them still waits: nothing changes.
   * 4. A request the recipient may not see (a block either way, or the minors' rule) is stored as declined: the
   *    sender sees "Request sent" as for any other, and the recipient is never told.
   * 5. Otherwise a new request, or the one the sender cancelled sent again, which tells the recipient again only
   *    after `ringAgainAfterMs`.
   */
  async function ask({ senderId, recipientId, via, met, now }) {
    if (await friendAccessor.areFriends({ a: senderId, b: recipientId })) {
      return { result: FRIEND_REQUEST_RESULTS.FRIENDS };
    }
    const reaches = await reachOf({ senderId, recipientId, met, now });
    const { mutual, waiting } = await roomToAsk({ senderId, recipientId, reaches, now });
    if (mutual) return befriend({ a: senderId, b: recipientId, now });
    if (waiting) return { result: FRIEND_REQUEST_RESULTS.SENT };
    const status = (shown) => (shown ? FRIEND_REQUEST_STATUS.PENDING : FRIEND_REQUEST_STATUS.DECLINED);
    const fresh = { via, createdAt: now, expiresAt: now + rules.requestLifetimeMs };
    const { created, request } = await friendAccessor.addRequest({
      requestId: newRequestId(),
      senderId,
      recipientId,
      notifiedAt: now,
      status: status(reaches),
      ...(!reaches && { declinedAt: now }),
      ...fresh,
    });
    // An old request of the sender's to them: one they cancelled, or one that ran out and is not deleted yet. One
    // that was declined, or kept from them, stays so until it runs out: cancelling and sending it again never
    // asks a second time (ADR-066.4).
    const shown = created ? reaches : reaches && request.declinedAt === undefined;
    const rings = created ? reaches : shown && request.notifiedAt + rules.ringAgainAfterMs <= now;
    if (!created) {
      await friendAccessor.updateRequest({
        requestId: request.requestId,
        statuses: [request.status],
        set: { ...fresh, status: status(shown), ...(rings && { notifiedAt: now }) },
      });
    }
    if (rings) {
      await ring({ ...request, via }, now);
    }
    changed(...(shown ? [senderId, recipientId] : [senderId]));
    return { result: FRIEND_REQUEST_RESULTS.SENT };
  }

  /** The request, while it is the player's to answer: theirs, waiting, and not from anyone blocked either way. */
  async function answerable({ recipientId, requestId, now }) {
    const request = await friendAccessor.getLiveRequest({ requestId, now }).catch(missingAs(noSuchRequest));
    if (
      request.recipientId !== recipientId ||
      request.status !== FRIEND_REQUEST_STATUS.PENDING ||
      (await blocks.blockedWith({ playerId: recipientId })).has(request.senderId)
    ) {
      throw noSuchRequest();
    }
    return request;
  }

  /** The friend at a handle, or not found for anyone who is not the player's friend now. */
  async function friendByHandle({ playerId, handle }) {
    const profile = await profiles.getByHandle(handle).catch(missingAs(noSuchFriend));
    const blocked = await blocks.blockedWith({ playerId });
    if (
      blocked.has(profile.playerId) ||
      !(await friendAccessor.areFriends({ a: playerId, b: profile.playerId }))
    ) {
      throw noSuchFriend();
    }
    return profile.playerId;
  }

  return Object.freeze({
    /**
     * The player's friends view: friends with their presence, the requests waiting for them, the requests they sent
     * that still wait, their switch, and whether to show safety tips.
     *
     * @param {{ playerId: string, now: number }} query
     * @throws {ForbiddenError} for a guest
     */
    viewFor,

    /**
     * The requests a tab that just connected may have missed the ring of (CC-341), shaped as the ring: none that a
     * tab of the same browser session heard.
     *
     * @param {{ playerId: string, sessionId: string, now: number }} query
     */
    missedRings,

    /**
     * Notes that a tab of this browser session showed these rings (its page said so), so they are not sent to it
     * again. Kept beside the session for as long as a ring may be sent again, so a restart does not forget them.
     *
     * @param {{ sessionId: string, rings: ReadonlyArray<{ requestId: string, ringAt: number }>, now: number }} heard
     */
    ringsHeard: ({ sessionId, rings, now }) =>
      sessions.addHeardRings({ sessionId, rings, since: now - rules.missedRingWithinMs }),

    /**
     * Asks someone the player played with to be friends.
     *
     * @param {{ playerId: string, target: import("../players/coPlayers.js").PlayedWith, now: number }} input
     * @returns {Promise<{ result: string }>} a FRIEND_REQUEST_RESULTS value
     * @throws {ForbiddenError} for a guest
     * @throws {NotFoundError} for anyone the server did not see the player play with, one message for all
     * @throws {ConflictError} when the other player is a guest, or the player is at a limit
     */
    async sendRequest({ playerId, target, now }) {
      await requireFriends(playerId, now);
      const person = await coPlayers.personAt({ target, askerId: playerId, refusal: notPlayedWith });
      if (!mayHaveFriends(await safety.policyFor({ playerId: person.playerId, now }))) {
        throw new ConflictError(
          `${person.displayName} needs to save their progress before you can be friends`,
        );
      }
      return ask({
        senderId: playerId,
        recipientId: person.playerId,
        via: FRIEND_REQUEST_VIA.GAME,
        // A match that does not say how the two met counts as quick match, the safer side for a minor (ADR-051.7).
        met: person.quickMatch === false ? MET_THROUGH.LINK_ROOM : MET_THROUGH.QUICK_MATCH,
        now,
      });
    },

    /**
     * Accepts or declines a request sent to the player. A decline tells nobody: the sender's view does not change.
     *
     * @param {{ playerId: string, requestId: string, answer: unknown, now: number }} input  `answer` is a
     *   FRIEND_ANSWERS value
     * @returns {Promise<{ result: string }>} "friends" after an accept, "declined" after a decline
     * @throws {ForbiddenError} for a guest
     * @throws {ValidationError} for an answer that is neither
     * @throws {NotFoundError} for a request that is not theirs to answer now, one message for all
     * @throws {ConflictError} when the player has as many friends as allowed
     */
    async answerRequest({ playerId, requestId, answer, now }) {
      await requireFriends(playerId, now);
      if (!ANSWERS.has(answer)) {
        throw new ValidationError("Answer accept or decline", { details: { field: "answer" } });
      }
      const request = await answerable({ recipientId: playerId, requestId, now });
      const accepting = answer === FRIEND_ANSWERS.ACCEPT;
      if (accepting) await requireRoomForFriend(playerId);
      // The answer claims the request while it is still pending, so two answers at once cannot both win.
      const claimed = await friendAccessor.updateRequest({
        requestId,
        statuses: PENDING,
        set: accepting
          ? { status: FRIEND_REQUEST_STATUS.ACCEPTED }
          : { status: FRIEND_REQUEST_STATUS.DECLINED, declinedAt: now },
      });
      if (!claimed) throw noSuchRequest();
      if (accepting) return befriend({ a: request.senderId, b: playerId, now });
      changed(playerId);
      return { result: FRIEND_REQUEST_STATUS.DECLINED };
    },

    /**
     * Takes back a request the player sent. Its recipient's view changes only when they could see it.
     *
     * @param {{ playerId: string, requestId: string, now: number }} input
     * @throws {NotFoundError} when the player has no waiting request with that id
     */
    async cancelRequest({ playerId, requestId, now }) {
      await requireFriends(playerId, now);
      const request = await friendAccessor.getLiveRequest({ requestId, now }).catch(missingAs(noSuchRequest));
      if (request.senderId !== playerId || !WAITING.includes(request.status)) throw noSuchRequest();
      await friendAccessor.updateRequest({
        requestId,
        statuses: WAITING,
        set: { status: FRIEND_REQUEST_STATUS.WITHDRAWN },
      });
      changed(
        ...(request.status === FRIEND_REQUEST_STATUS.PENDING ? [playerId, request.recipientId] : [playerId]),
      );
    },

    /**
     * Ends a friendship, for both. Nobody is told, and it looks the same as a block.
     *
     * @param {{ playerId: string, handle: string, now: number }} input
     * @throws {NotFoundError} when the handle is not one of the player's friends
     */
    async removeFriend({ playerId, handle, now }) {
      await requireFriends(playerId, now);
      const friendId = await friendByHandle({ playerId, handle });
      await friendAccessor.unfriend({ a: playerId, b: friendId });
      changed(playerId, friendId);
    },

    /**
     * The player id of the player's friend at a handle, for features that act on a friend (part 2: invites).
     *
     * @param {{ playerId: string, handle: string }} query
     * @returns {Promise<string>}
     * @throws {NotFoundError} when the handle is not one of the player's friends
     */
    friendByHandle,

    /**
     * Sets the player's Appear offline switch. Their friends see the change at once.
     *
     * @param {{ playerId: string, appearOffline: unknown, now: number }} input
     * @throws {ValidationError} for anything but true or false
     */
    async setAppearOffline({ playerId, appearOffline, now }) {
      await requireFriends(playerId, now);
      if (typeof appearOffline !== "boolean") {
        throw new ValidationError("appearOffline must be true or false", {
          details: { field: "appearOffline" },
        });
      }
      await privacyAccessor.setAppearOffline({ playerId, appearOffline, at: now });
      events.emit(PRESENCE_EVENTS.CHANGED, { playerId });
      changed(playerId);
      return Object.freeze({ appearOffline });
    },

    /**
     * Makes a friend link. Its token is answered once, here, and stored only as a hash.
     *
     * @param {{ playerId: string, now: number }} input
     * @returns {Promise<Readonly<{ token: string, expiresAt: number }>>}
     */
    async makeLink({ playerId, now }) {
      await requireFriends(playerId, now);
      const token = newToken();
      const { expiresAt } = await friendAccessor.addLink({
        tokenHash: hashFriendLinkToken(token),
        creatorId: playerId,
        createdAt: now,
        expiresAt: now + rules.linkLifetimeMs,
      });
      await friendAccessor.keepNewestLinks({ creatorId: playerId, keep: rules.linksKept });
      return Object.freeze({ token, expiresAt });
    },

    /**
     * What a friend link's page shows, to anyone holding the link, visitors too: the maker's avatar and an adult's
     * username, or `FRIEND_LINK_MAKER_NAME` for anyone else. Reading it never uses the link up.
     *
     * @param {{ token: string, viewerId: string, now: number }} query  `viewerId` is "" for a visitor
     * @throws {NotFoundError} when the link ran out, was used, or never existed, one message for all
     */
    async linkInvite({ token, viewerId, now }) {
      const link = await friendAccessor
        .getLiveLink({ tokenHash: hashFriendLinkToken(token), now })
        .catch(missingAs(noSuchLink));
      const { names, cards, policies } = await peopleOf([link.creatorId], now);
      if (!names.has(link.creatorId)) throw noSuchLink();
      return Object.freeze({
        displayName: linkNameOf({ playerId: link.creatorId, names, policies }),
        ...avatarField(cards.get(link.creatorId)),
        ...(viewerId === link.creatorId && { own: true }),
      });
    },

    /**
     * Uses a friend link: it stops working, and its maker gets a request to accept. The rules of a request apply,
     * so a link into a block answers "Request sent" too. A guest, the maker themself and a friend already do not
     * use it up.
     *
     * @param {{ playerId: string, token: string, now: number }} input
     * @returns {Promise<{ result: string }>} a FRIEND_REQUEST_RESULTS value
     * @throws {ForbiddenError} for a guest
     * @throws {NotFoundError} when the link ran out, was used, or never existed
     * @throws {ConflictError} for the maker's own link, or a player at a limit
     */
    async useLink({ playerId, token, now }) {
      await requireFriends(playerId, now);
      const tokenHash = hashFriendLinkToken(token);
      const link = await friendAccessor.getLiveLink({ tokenHash, now }).catch(missingAs(noSuchLink));
      if (link.creatorId === playerId) {
        throw new ConflictError("This is your own friend link. Send it to a friend.");
      }
      if (await friendAccessor.areFriends({ a: playerId, b: link.creatorId })) {
        return { result: FRIEND_REQUEST_RESULTS.FRIENDS };
      }
      const asking = { senderId: playerId, recipientId: link.creatorId, met: MET_THROUGH.FRIEND_LINK, now };
      // A player at a limit keeps the link: it is used up only once the request can go.
      await roomToAsk({ ...asking, reaches: await reachOf(asking) });
      await friendAccessor.takeLink({ tokenHash, now }).catch(missingAs(noSuchLink));
      return ask({ ...asking, via: FRIEND_REQUEST_VIA.LINK });
    },

    /**
     * What a player's friends should now see of them, for the gateway to push: their handle and presence, and who
     * to tell. Guests have no friends, so nothing is read for them.
     *
     * @param {{ playerId: string, now: number }} query
     * @returns {Promise<Readonly<{ handle: string, presence: string, friendIds: ReadonlyArray<string> }>>}
     */
    async presenceAudience({ playerId, now }) {
      if (!isAccountId(playerId)) return Object.freeze({ handle: "", presence: "", friendIds: [] });
      const blocked = await blocks.blockedWith({ playerId });
      const friendIds = (await friendsOf(playerId, blocked)).map((friend) => friend.friendId);
      if (friendIds.length === 0) return Object.freeze({ handle: "", presence: "", friendIds: [] });
      const [cards, presenceOfPlayer] = await Promise.all([
        profiles.getOrCreateMany({ playerIds: [playerId], at: now }),
        presenceOf([playerId]),
      ]);
      return Object.freeze({
        handle: cards.get(playerId).handle,
        presence: presenceOfPlayer(playerId),
        friendIds,
      });
    },

    /**
     * A block was made (the block component's follower): the pair stop being friends, both ways, without a word,
     * and every pending request between them is declined, so neither ever sees it again, even after an unblock.
     * Each sender still sees their request waiting, as for any decline (ADR-053, ADR-066.4).
     *
     * @param {{ blockerId: string, blockedId: string, now: number }} pair
     */
    async playersBlocked({ blockerId, blockedId, now }) {
      const ended = await friendAccessor.unfriend({ a: blockerId, b: blockedId });
      const declined = await friendAccessor.declineRequestsBetween({ a: blockerId, b: blockedId, at: now });
      if (ended || declined > 0) changed(blockerId, blockedId);
    },

    /**
     * The player's friends data for their export (CC-035): their friends and the requests they sent, by name and
     * date, their open friend links by date, and their switch. Never an id or a token.
     *
     * @param {{ playerId: string, now: number }} query
     */
    async exportPlayer({ playerId, now }) {
      const [friends, sent, links, appearing] = await Promise.all([
        friendAccessor.friendsOf(playerId),
        friendAccessor.sentBy({ senderId: playerId, statuses: WAITING, now }),
        friendAccessor.linksBy({ creatorId: playerId, now }),
        privacyAccessor.appearingOffline([playerId]),
      ]);
      const recipients = sent.map((request) => request.recipientId);
      const [names, policies] = await Promise.all([
        accounts.usernamesOf({ playerIds: [...friends.map((friend) => friend.friendId), ...recipients] }),
        safety.policiesFor({ playerIds: recipients, now }),
      ]);
      const iso = (ms) => new Date(ms).toISOString();
      return {
        friends: friends
          .filter((friend) => names.has(friend.friendId))
          .map((friend) => ({ displayName: names.get(friend.friendId), since: iso(friend.since) })),
        requestsSent: sent
          .filter((request) => names.has(request.recipientId))
          .map((request) => ({
            displayName: outgoingNameOf({ request, names, policies }),
            sentAt: iso(request.createdAt),
          })),
        friendLinks: links.map((link) => ({ madeAt: iso(link.createdAt), worksUntil: iso(link.expiresAt) })),
        appearOffline: appearing.has(playerId),
      };
    },

    /**
     * Deletes everything about the player in the friends stores, on either side (CC-035). Their friends see them
     * gone. Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: Record<string, number> }>}
     */
    async erasePlayer({ playerId }) {
      const friends = await friendAccessor.friendsOf(playerId);
      const removed = await friendAccessor.removeInvolving(playerId);
      const privacy = await privacyAccessor.remove(playerId);
      if (friends.length > 0) changed(...friends.map((friend) => friend.friendId));
      return { erased: { ...removed, privacy } };
    },
  });
}
