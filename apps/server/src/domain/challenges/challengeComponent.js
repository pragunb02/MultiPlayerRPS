import {
  CHALLENGE_LIFETIME_MS,
  CHALLENGE_LIMIT_REASONS,
  CHALLENGE_LIMITS,
  CHALLENGE_STATES,
} from "@classicade/shared";
import { newChallengeId } from "../../models/challengeId.js";
import { isAccountId } from "../../models/identity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Events the challenge component publishes for other parts of the system to react to. */
export const CHALLENGE_EVENTS = Object.freeze({
  /**
   * `{ challenge, playerIds }`: a challenge was made, taken, declined, withdrawn or moved to an inbox. Every tab of
   * the players in `playerIds` hears about it on whatever page it is. A player in a blocked pair is never among
   * them (ADR-053).
   */
  CHANGED: "challenge.changed",
});

/**
 * How long challenges last (ADR-069). Each is a business rule, written down once.
 *
 * 1. `openMs`: a challenge stays open for a day (CC-052 scenario 3).
 * 2. `keptMs`: after that its record stays another day, so the link still says "expired" instead of "not found",
 *    then MongoDB deletes it by itself.
 * 3. `acceptedShownMs`: a challenge someone took stays in its creator's inbox with "Go and play" for as long as a
 *    waiting room lasts (`roomLifetimes.js`), half an hour.
 */
export const CHALLENGE_LIFETIMES = Object.freeze({
  openMs: CHALLENGE_LIFETIME_MS,
  keptMs: 24 * HOUR_MS,
  acceptedShownMs: 30 * MINUTE_MS,
});

/**
 * Who a challenge to one person can name, until CC-052 says: nobody. CC-052 replaces it with "a friend, by their
 * profile handle". Every refusal is the same "not found", so it never says whether a handle exists.
 */
const NOBODY_TO_NAME = Object.freeze({
  resolve: async () => {
    throw new NotFoundError("We couldn't find that player");
  },
});

/** What a player is told about a challenge that is no longer open. A block reads exactly as "expired" (ADR-053). */
const ENDED_MESSAGES = Object.freeze({
  [CHALLENGE_STATES.ACCEPTED]: "Someone already took this challenge",
  [CHALLENGE_STATES.DECLINED]: "This challenge was turned down",
  [CHALLENGE_STATES.EXPIRED]: "This challenge has expired",
  [CHALLENGE_STATES.WITHDRAWN]: "This challenge was taken back",
});
const ended = (state) => new GoneError(ENDED_MESSAGES[state], { details: { state } });

const newestFirst = (a, b) => b.createdAt - a.createdAt;

/**
 * Where a challenge stands at `now`. Storage never writes "expired": an open challenge whose day is over is
 * expired from that moment, without anything having to sweep.
 *
 * @param {Readonly<import("../../data/challengeAccessor.js").Challenge>} challenge
 * @param {number} now
 */
export const stateAt = (challenge, now) =>
  challenge.state === CHALLENGE_STATES.OPEN && now >= challenge.expiresAt
    ? CHALLENGE_STATES.EXPIRED
    : challenge.state;

/**
 * @typedef {Object} ChallengeView   what one viewer is told about a challenge. Never a player id (ADR-057)
 * @property {string} id
 * @property {string} gameId
 * @property {Readonly<object>} options
 * @property {string} state           a CHALLENGE_STATES value
 * @property {number} createdAt
 * @property {string} fromName        "" when the viewer may not see who made it (ADR-028.7)
 * @property {boolean} own            the viewer made it
 * @property {boolean} forYou         it was sent to the viewer
 * @property {boolean} took           the viewer took it
 * @property {boolean} later          the viewer moved it from a popup to their inbox
 * @property {number} [expiresAt]     while it is open
 * @property {string} [toName]        to its creator, the one person it was sent to
 * @property {string} [acceptedName]  to its creator, who took it
 * @property {{ code: string, gameId: string }} [room]  to its creator and the one who took it, the room made
 */

/**
 * Challenges (CC-139, ADR-069). A player picks a game and its options and gets a link that lasts a day. Whoever
 * opens it can take it, and a room is made with both of them seated. A challenge to one person (CC-052) works the
 * same way, reaches them on any page, and only they can take or decline it.
 *
 * Blocks never show (ADR-053). Someone in a blocked pair with the challenger sees an open challenge as expired, and
 * taking or declining it answers exactly what an expired one answers. A challenge to one person in a blocked pair is
 * never delivered to them, so the sender sees it wait and then expire, as if nobody had answered.
 *
 * @param {{
 *   challengeAccessor: ReturnType<typeof import("../../data/challengeAccessor.js").createChallengeAccessor>,
 *   rooms: Pick<ReturnType<typeof import("../rooms/roomComponent.js").createRoomComponent>, "checkOptions" | "createChallengeRoom">,
 *   blocks: { blockedWith: (query: { playerId: string }) => Promise<ReadonlySet<string>> },
 *   ages: { adultsAmong: (query: { playerIds: ReadonlyArray<string>, now: number }) => Promise<ReadonlySet<string>> },
 *   events: { emit: (event: string, payload: unknown) => void },
 *   recipients?: { resolve: (query: { from: Readonly<{ id: string }>, target: unknown, now: number }) => Promise<Readonly<{ id: string, displayName: string }>> },
 *   newId?: () => string,
 *   lifetimes?: Readonly<typeof CHALLENGE_LIFETIMES>,
 *   limits?: Readonly<typeof CHALLENGE_LIMITS>,
 * }} deps  `rooms` is the room component, which checks options and makes the room. `blocks` answers everyone on
 *   either side of a block with a player. `ages` answers which players are adult accounts, the only ones whose name
 *   a link may show (ADR-028.7). `recipients` names the one person a challenge is for, and refuses everyone it may
 *   not name: by default nobody can be named, until CC-052 passes in friends by handle. `newId`, `lifetimes` and
 *   `limits` are for tests
 */
export function createChallengeComponent({
  challengeAccessor,
  rooms,
  blocks,
  ages,
  events,
  recipients = NOBODY_TO_NAME,
  newId = newChallengeId,
  lifetimes = CHALLENGE_LIFETIMES,
  limits = CHALLENGE_LIMITS,
}) {
  assertDefined(challengeAccessor, "challengeAccessor");
  assertFunction(rooms?.checkOptions, "rooms.checkOptions");
  assertFunction(rooms?.createChallengeRoom, "rooms.createChallengeRoom");
  assertFunction(blocks?.blockedWith, "blocks.blockedWith");
  assertFunction(ages?.adultsAmong, "ages.adultsAmong");
  assertFunction(events?.emit, "events.emit");
  assertFunction(recipients?.resolve, "recipients.resolve");
  assertFunction(newId, "newId");

  /** Whether two players are on either side of a block. A visitor without a player id is never blocked. */
  const blockedBetween = async (playerId, otherId) =>
    playerId !== "" && (await blocks.blockedWith({ playerId })).has(otherId);

  /** Whether the challenger's name may be shown to anyone with the link: only an adult account's (ADR-028.7). */
  const isPublic = async (playerId, now) =>
    isAccountId(playerId) && (await ages.adultsAmong({ playerIds: [playerId], now })).has(playerId);

  /**
   * What `viewerId` is told about `challenge`. A viewer in a blocked pair with its creator sees what an expired
   * challenge shows, and nothing that only an open one has.
   */
  function viewFor(challenge, viewerId, { now, blocked }) {
    const own = viewerId === challenge.fromId;
    const forYou = challenge.toId !== "" && viewerId === challenge.toId;
    const base = {
      id: challenge.challengeId,
      gameId: challenge.gameId,
      options: challenge.options,
      createdAt: challenge.createdAt,
      fromName: own || forYou || challenge.fromPublic ? challenge.fromName : "",
      own,
    };
    if (blocked && !own) {
      return Object.freeze({
        ...base,
        forYou: false,
        took: false,
        later: false,
        state: CHALLENGE_STATES.EXPIRED,
      });
    }
    const state = stateAt(challenge, now);
    const took = challenge.acceptedBy !== "" && viewerId === challenge.acceptedBy;
    return Object.freeze({
      ...base,
      forYou,
      took,
      later: challenge.laterBy.includes(viewerId),
      state,
      ...(state === CHALLENGE_STATES.OPEN && { expiresAt: challenge.expiresAt }),
      ...(own && challenge.toId !== "" && { toName: challenge.toName }),
      ...(own && challenge.acceptedName !== "" && { acceptedName: challenge.acceptedName }),
      ...((own || took) &&
        challenge.roomCode !== "" && {
          room: Object.freeze({ code: challenge.roomCode, gameId: challenge.gameId }),
        }),
    });
  }

  /** Tells the players concerned that the challenge changed: its creator, the one it was sent to and the taker. */
  async function announce(challenge, only) {
    const sentTo =
      challenge.toId !== "" && !(await blockedBetween(challenge.fromId, challenge.toId))
        ? [challenge.toId]
        : [];
    const taker = challenge.acceptedBy === "" ? [] : [challenge.acceptedBy];
    const playerIds = only ?? [...new Set([challenge.fromId, ...sentTo, ...taker])];
    events.emit(CHALLENGE_EVENTS.CHANGED, { challenge, playerIds });
  }

  /** A challenge that is still open for `playerId` to answer, or the answer an ended one gets. */
  async function openFor(challengeId, playerId, now) {
    const challenge = await challengeAccessor.get(challengeId);
    if (await blockedBetween(playerId, challenge.fromId)) {
      throw ended(CHALLENGE_STATES.EXPIRED);
    }
    const state = stateAt(challenge, now);
    if (state !== CHALLENGE_STATES.OPEN) {
      throw ended(state);
    }
    return challenge;
  }

  /**
   * After a change that lost a race: how the challenge ended in the meantime. It can be open again only when someone
   * else was taking it and their room could not be made, so trying again may work.
   */
  async function endedSince(challengeId, now) {
    const state = stateAt(await challengeAccessor.get(challengeId), now);
    return state === CHALLENGE_STATES.OPEN
      ? new ConflictError("Someone else was taking this challenge just now. Try again")
      : ended(state);
  }

  /** The one person a new challenge is for, after the limits that apply to them. */
  async function recipientOf({ from, to, mine, now }) {
    if (to === undefined) {
      return { id: "", displayName: "" };
    }
    const recipient = await recipients.resolve({ from, target: to, now });
    if (recipient.id === from.id) {
      throw new ValidationError("You can't challenge yourself", { details: { field: "to" } });
    }
    const last = mine.find((challenge) => challenge.toId === recipient.id);
    if (last !== undefined && now < last.createdAt + limits.samePersonEveryMs) {
      const retryAt = last.createdAt + limits.samePersonEveryMs;
      throw new ConflictError("You challenged them a moment ago. Try again in a few minutes", {
        details: { reason: CHALLENGE_LIMIT_REASONS.SAME_PERSON, retryAt },
      });
    }
    return recipient;
  }

  return Object.freeze({
    /**
     * Makes a challenge for the game and options `from` picked, open for a day. Without `to` anyone with its link can
     * take it. With `to` it is for the one person `recipients` names (CC-052).
     *
     * @param {{ from: import("../../models/identity.js").Identity, gameId: string, options: unknown, to?: unknown, now: number }} input
     * @returns {Promise<Readonly<ChallengeView>>} the creator's view
     * @throws {ValidationError} for an unknown game, invalid options or yourself as `to`
     * @throws {NotFoundError} for a `to` that `recipients` will not name
     * @throws {ConflictError} with `details.reason` when a limit is reached (CHALLENGE_LIMIT_REASONS)
     */
    async create({ from, gameId, options, to, now }) {
      const value = rooms.checkOptions({ gameId, options });
      const mine = await challengeAccessor.listFrom(from.id);
      const open = mine.filter((challenge) => stateAt(challenge, now) === CHALLENGE_STATES.OPEN);
      if (open.length >= limits.openPerSender) {
        throw new ConflictError(
          `You can have ${limits.openPerSender} challenges open at once. Take one back first`,
          { details: { reason: CHALLENGE_LIMIT_REASONS.OPEN, limit: limits.openPerSender } },
        );
      }
      const recipient = await recipientOf({ from, to, mine, now });
      const challenge = await challengeAccessor.add({
        challengeId: newId(),
        fromId: from.id,
        fromName: from.displayName,
        fromPublic: await isPublic(from.id, now),
        toId: recipient.id,
        toName: recipient.displayName,
        gameId,
        options: value,
        createdAt: now,
        expiresAt: now + lifetimes.openMs,
        deleteAt: now + lifetimes.openMs + lifetimes.keptMs,
      });
      await announce(challenge);
      return viewFor(challenge, from.id, { now, blocked: false });
    },

    /**
     * What `viewerId` may see of a challenge, for its page. Visitors without a session too, with `viewerId` "".
     *
     * @param {{ challengeId: string, viewerId: string, now: number }} input
     * @returns {Promise<Readonly<ChallengeView>>}
     * @throws {NotFoundError} when there is none, or it was forgotten
     */
    async view({ challengeId, viewerId, now }) {
      const challenge = await challengeAccessor.get(challengeId);
      const blocked = viewerId !== challenge.fromId && (await blockedBetween(viewerId, challenge.fromId));
      return viewFor(challenge, viewerId, { now, blocked });
    },

    /**
     * The view a player is pushed when a challenge changes (see CHALLENGE_EVENTS). Only players the event names are
     * pushed, and a player in a blocked pair is never named, so no block needs reading here.
     *
     * @param {Readonly<import("../../data/challengeAccessor.js").Challenge>} challenge
     * @param {string} viewerId
     * @param {number} now
     */
    viewFor: (challenge, viewerId, now) => viewFor(challenge, viewerId, { now, blocked: false }),

    /**
     * Takes a challenge: a room is made with both players seated, and the challenge is accepted. Only one person can
     * take it. If the room cannot be made, the challenge is open again.
     *
     * @param {{ challengeId: string, player: import("../../models/identity.js").Identity, network: string, earlierNetworks?: ReadonlyArray<string>, now: number }} input
     *   `network` and `earlierNetworks` name the taker's network, for the room limits (see `createRoom`)
     * @returns {Promise<{ challenge: Readonly<ChallengeView>, room: Readonly<{ code: string, gameId: string }> }>}
     * @throws {ForbiddenError} for its own creator, or anyone but the one person it was sent to
     * @throws {GoneError} when it is no longer open, with `details.state`. A block reads as expired
     * @throws {NotFoundError} when there is none
     */
    async accept({ challengeId, player, network, earlierNetworks = [], now }) {
      const stored = await challengeAccessor.get(challengeId);
      if (stored.fromId === player.id) {
        throw new ForbiddenError("This is your own challenge");
      }
      const challenge = await openFor(challengeId, player.id, now);
      if (challenge.toId !== "" && challenge.toId !== player.id) {
        throw new ForbiddenError("This challenge is for someone else");
      }
      const claim = { challengeId, acceptedBy: player.id };
      if (!(await challengeAccessor.claim({ ...claim, acceptedName: player.displayName, at: now }))) {
        throw await endedSince(challengeId, now);
      }
      let room;
      try {
        room = await rooms.createChallengeRoom({
          challenger: { id: challenge.fromId, displayName: challenge.fromName },
          accepter: player,
          network,
          earlierNetworks,
          gameId: challenge.gameId,
          options: challenge.options,
          now,
        });
      } catch (err) {
        await challengeAccessor.release(claim);
        throw err;
      }
      await challengeAccessor.setRoom({ ...claim, roomCode: room.code });
      const accepted = await challengeAccessor.get(challengeId);
      await announce(accepted);
      return {
        challenge: viewFor(accepted, player.id, { now, blocked: false }),
        room: Object.freeze({ code: room.code, gameId: room.gameId }),
      };
    },

    /**
     * The one person a challenge was sent to says no. Its creator hears a gentle "not right now".
     *
     * @param {{ challengeId: string, playerId: string, now: number }} input
     * @returns {Promise<Readonly<ChallengeView>>}
     * @throws {ForbiddenError} for anyone it was not sent to
     * @throws {GoneError} when it is no longer open. A block reads as expired
     */
    async decline({ challengeId, playerId, now }) {
      const stored = await challengeAccessor.get(challengeId);
      if (stored.toId === "" || stored.toId !== playerId) {
        throw new ForbiddenError("That challenge was not sent to you");
      }
      await openFor(challengeId, playerId, now);
      if (!(await challengeAccessor.end({ challengeId, state: CHALLENGE_STATES.DECLINED, at: now }))) {
        throw await endedSince(challengeId, now);
      }
      const declined = await challengeAccessor.get(challengeId);
      await announce(declined);
      return viewFor(declined, playerId, { now, blocked: false });
    },

    /**
     * Its creator takes a challenge back while it is open.
     *
     * @param {{ challengeId: string, playerId: string, now: number }} input
     * @returns {Promise<Readonly<ChallengeView>>}
     * @throws {ForbiddenError} for anyone but its creator
     * @throws {GoneError} when it is no longer open
     */
    async withdraw({ challengeId, playerId, now }) {
      const stored = await challengeAccessor.get(challengeId);
      if (stored.fromId !== playerId) {
        throw new ForbiddenError("Only the player who made it can take it back");
      }
      if (stateAt(stored, now) !== CHALLENGE_STATES.OPEN) {
        throw ended(stateAt(stored, now));
      }
      if (!(await challengeAccessor.end({ challengeId, state: CHALLENGE_STATES.WITHDRAWN, at: now }))) {
        throw await endedSince(challengeId, now);
      }
      const withdrawn = await challengeAccessor.get(challengeId);
      await announce(withdrawn);
      return viewFor(withdrawn, playerId, { now, blocked: false });
    },

    /**
     * Moves a challenge from the player's popup to their inbox (CC-207): they pressed Not now, or left it for a
     * minute. Their other tabs hear of it, so it never pops up again anywhere. Doing it twice changes nothing.
     *
     * @param {{ challengeId: string, playerId: string, now: number }} input
     * @returns {Promise<Readonly<ChallengeView>>}
     * @throws {ForbiddenError} for anyone but its creator and the one person it was sent to
     */
    async later({ challengeId, playerId, now }) {
      const stored = await challengeAccessor.get(challengeId);
      if (stored.fromId !== playerId && stored.toId !== playerId) {
        throw new ForbiddenError("That challenge is not in your inbox");
      }
      const blocked = stored.fromId !== playerId && (await blockedBetween(playerId, stored.fromId));
      if (!blocked && (await challengeAccessor.addLater({ challengeId, playerId }))) {
        await announce(await challengeAccessor.get(challengeId), [playerId]);
      }
      return viewFor(await challengeAccessor.get(challengeId), playerId, { now, blocked });
    },

    /**
     * The player's inbox (CC-207, the minimal CC-147): their own open challenges, their own taken ones while the room
     * waits for them, and the open challenges sent to them by anyone not in a block with them. Newest first.
     *
     * @param {{ playerId: string, now: number }} input
     * @returns {Promise<ReadonlyArray<Readonly<ChallengeView>>>}
     */
    async inbox({ playerId, now }) {
      const [mine, sent, blocked] = await Promise.all([
        challengeAccessor.listFrom(playerId),
        challengeAccessor.listTo(playerId),
        blocks.blockedWith({ playerId }),
      ]);
      const isOpen = (challenge) => stateAt(challenge, now) === CHALLENGE_STATES.OPEN;
      const waitsForMe = (challenge) =>
        challenge.state === CHALLENGE_STATES.ACCEPTED &&
        challenge.roomCode !== "" &&
        now < challenge.endedAt + lifetimes.acceptedShownMs;
      const shown = [
        ...mine.filter((challenge) => isOpen(challenge) || waitsForMe(challenge)),
        ...sent.filter((challenge) => isOpen(challenge) && !blocked.has(challenge.fromId)),
      ];
      return Object.freeze(
        shown.sort(newestFirst).map((challenge) => viewFor(challenge, playerId, { now, blocked: false })),
      );
    },

    /**
     * A guest just signed in (ADR-014): every challenge they made, were sent or took becomes their account's.
     *
     * @param {{ from: string, to: Readonly<{ id: string }> }} transfer
     * @returns {Promise<{ moved: { challenges: number } }>}
     */
    transferPlayer: async ({ from, to }) => ({
      moved: { challenges: await challengeAccessor.movePlayer({ from, to: to.id }) },
    }),

    /**
     * The player's challenges for their data export (CC-035): the ones they made and the ones sent to them, with the
     * other person by name only, never by id.
     *
     * @param {{ playerId: string }} query
     */
    async exportPlayer({ playerId }) {
      const [mine, sent] = await Promise.all([
        challengeAccessor.listFrom(playerId),
        challengeAccessor.listTo(playerId),
      ]);
      const row = (challenge, fields) => ({
        challengeId: challenge.challengeId,
        gameId: challenge.gameId,
        options: challenge.options,
        state: challenge.state,
        createdAt: new Date(challenge.createdAt).toISOString(),
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        ...fields,
      });
      return [
        ...mine.map((challenge) =>
          row(challenge, {
            made: true,
            ...(challenge.toName !== "" && { sentTo: challenge.toName }),
            ...(challenge.acceptedName !== "" && { takenBy: challenge.acceptedName }),
          }),
        ),
        ...sent.map((challenge) => row(challenge, { made: false, from: challenge.fromName })),
      ];
    },

    /**
     * Deletes every challenge the player made, was sent or took (CC-035). Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { challenges: number } }>}
     */
    erasePlayer: async ({ playerId }) => ({
      erased: { challenges: await challengeAccessor.removeInvolving(playerId) },
    }),
  });
}
