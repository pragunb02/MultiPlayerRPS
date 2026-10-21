import {
  CHALLENGE_LIFETIME_MS,
  CHALLENGE_LIMIT_REASONS,
  CHALLENGE_LIMITS,
  CHALLENGE_STATES,
} from "@classicade/shared";
import { newChallengeId } from "../../models/challengeId.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors.js";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
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
 * 4. `claimLeaseMs`: taking a challenge holds it while its room is made, which takes well under a second. A hold
 *    with no room after this long was cut off by a crash or a failed write, so the challenge is open again.
 */
export const CHALLENGE_LIFETIMES = Object.freeze({
  openMs: CHALLENGE_LIFETIME_MS,
  keptMs: 24 * HOUR_MS,
  acceptedShownMs: 30 * MINUTE_MS,
  claimLeaseMs: 30 * SECOND_MS,
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
/** Oldest first, and by id for the same moment, so every reader puts challenges in the same order. */
const oldestFirst = (a, b) => a.createdAt - b.createdAt || a.challengeId.localeCompare(b.challengeId);

/** A hold on a challenge whose room was never recorded and whose lease is over (see `claimLeaseMs`). */
const isStaleClaim = (challenge, now) =>
  challenge.state === CHALLENGE_STATES.ACCEPTED &&
  challenge.roomCode === "" &&
  now >= challenge.endedAt + CHALLENGE_LIFETIMES.claimLeaseMs;

/**
 * Where a challenge stands at `now`. Storage never writes "expired": an open challenge whose day is over is
 * expired from that moment, without anything having to sweep. A stale hold counts as open (see `claimLeaseMs`).
 *
 * @param {Readonly<import("../../data/challengeAccessor.js").Challenge>} challenge
 * @param {number} now
 */
export function stateAt(challenge, now) {
  if (challenge.state !== CHALLENGE_STATES.OPEN && !isStaleClaim(challenge, now)) {
    return challenge.state;
  }
  return now >= challenge.expiresAt ? CHALLENGE_STATES.EXPIRED : CHALLENGE_STATES.OPEN;
}

/**
 * @typedef {Object} ChallengeView   what one viewer is told about a challenge. Never a player id (ADR-057)
 * @property {string} id
 * @property {string} gameId
 * @property {Readonly<object>} options
 * @property {string} state           a CHALLENGE_STATES value
 * @property {string} fromName        "" when the viewer may not see who made it (ADR-028.7)
 * @property {boolean} own            the viewer made it
 * @property {boolean} forYou         it was sent to the viewer
 * @property {boolean} took           the viewer took it
 * @property {boolean} later          the viewer moved it from a popup to their inbox
 * @property {number} [createdAt]     to its creator only. Anyone else could tell a blocked "expired" from a real one
 * @property {number} [expiresAt]     while it is open
 * @property {string} [toName]        to its creator, the one person it was sent to
 * @property {string} [acceptedName]  to its creator, who took it
 * @property {{ code: string, gameId: string }} [room]  to its creator and the one who took it, the room made
 * @property {number} [until]         to its creator, how long a taken challenge stays in the inbox
 */

/**
 * Challenges (CC-139, ADR-069). A player picks a game and its options and gets a link that lasts a day. Whoever
 * opens it can take it, and a room is made with both of them seated. A challenge to one person (CC-052) works the
 * same way, reaches them on any page, and only they can take or decline it.
 *
 * Blocks never show (ADR-053). Someone in a blocked pair with the challenger sees an open challenge exactly as an
 * expired one, and taking or declining it answers exactly what an expired one answers. A challenge to one person in
 * a blocked pair is never delivered to them, so the sender sees it wait and then expire, as if nobody had answered.
 *
 * @param {{
 *   challengeAccessor: ReturnType<typeof import("../../data/challengeAccessor.js").createChallengeAccessor>,
 *   rooms: Pick<ReturnType<typeof import("../rooms/roomComponent.js").createRoomComponent>, "checkOptions" | "createChallengeRoom">,
 *   blocks: { blockedWith: (query: { playerId: string }) => Promise<ReadonlySet<string>> },
 *   safety: Pick<ReturnType<typeof import("../safety/safetyComponent.js").createSafetyComponent>, "policyFor">,
 *   events: { emit: (event: string, payload: unknown) => void },
 *   recipients?: { resolve: (query: { from: Readonly<{ id: string }>, target: unknown, now: number }) => Promise<Readonly<{ id: string, displayName: string }>> },
 *   newId?: () => string,
 *   lifetimes?: Readonly<typeof CHALLENGE_LIFETIMES>,
 *   limits?: Readonly<typeof CHALLENGE_LIMITS>,
 * }} deps  `rooms` is the room component, which checks options and makes the room. `blocks` answers everyone on
 *   either side of a block with a player. `safety` gives each player's age policy (CC-152): a link shows the
 *   creator's name only when their policy lets a share card carry it (ADR-028.7). `recipients` names the one person
 *   a challenge is for, and refuses everyone it may not name: by default nobody can be named, until CC-052 passes
 *   in friends by handle. `newId`, `lifetimes` and `limits` are for tests
 */
export function createChallengeComponent({
  challengeAccessor,
  rooms,
  blocks,
  safety,
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
  assertFunction(safety?.policyFor, "safety.policyFor");
  assertFunction(events?.emit, "events.emit");
  assertFunction(recipients?.resolve, "recipients.resolve");
  assertFunction(newId, "newId");

  /** Whether two players are on either side of a block. A visitor without a player id is never blocked. */
  const blockedBetween = async (playerId, otherId) =>
    playerId !== "" && (await blocks.blockedWith({ playerId })).has(otherId);

  /** Holds older than this have lost their lease (see `claimLeaseMs`). */
  const staleBefore = (now) => now - CHALLENGE_LIFETIMES.claimLeaseMs;

  /**
   * What `viewerId` is told about `challenge`. A viewer in a blocked pair with its creator sees exactly what an
   * expired challenge shows them: the same fields with the same values, and nothing that only an open one has.
   */
  function viewFor(challenge, viewerId, { now, blocked }) {
    const own = viewerId === challenge.fromId;
    const forYou = challenge.toId !== "" && viewerId === challenge.toId;
    const state = blocked && !own ? CHALLENGE_STATES.EXPIRED : stateAt(challenge, now);
    const accepted = state === CHALLENGE_STATES.ACCEPTED;
    const took = accepted && viewerId === challenge.acceptedBy;
    const withRoom = accepted && challenge.roomCode !== "";
    return Object.freeze({
      id: challenge.challengeId,
      gameId: challenge.gameId,
      options: challenge.options,
      fromName: own || forYou || challenge.fromPublic ? challenge.fromName : "",
      own,
      forYou,
      took,
      later: challenge.laterBy.includes(viewerId),
      state,
      ...(own && { createdAt: challenge.createdAt }),
      ...(state === CHALLENGE_STATES.OPEN && { expiresAt: challenge.expiresAt }),
      ...(own && challenge.toId !== "" && { toName: challenge.toName }),
      ...(own && accepted && { acceptedName: challenge.acceptedName }),
      ...((own || took) &&
        withRoom && { room: Object.freeze({ code: challenge.roomCode, gameId: challenge.gameId }) }),
      ...(own && withRoom && { until: challenge.endedAt + lifetimes.acceptedShownMs }),
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

  /** The one person a new challenge is for. Refuses yourself. */
  async function recipientOf({ from, to, now }) {
    if (to === undefined) {
      return { id: "", displayName: "" };
    }
    const recipient = await recipients.resolve({ from, target: to, now });
    if (recipient.id === from.id) {
      throw new ValidationError("You can't challenge yourself", { details: { field: "to" } });
    }
    return recipient;
  }

  /**
   * The limit a new challenge breaks, or undefined. It reads the sender's challenges with the new one stored, so
   * challenges made at the same moment are judged in one order: the oldest within the limit stay, and any after
   * them are refused. Checking before storing would let two at once both pass.
   */
  async function brokenLimit(challenge, now) {
    const mine = [...(await challengeAccessor.listFrom(challenge.fromId))].sort(oldestFirst);
    const open = mine.filter((each) => stateAt(each, now) === CHALLENGE_STATES.OPEN);
    if (open.findIndex((each) => each.challengeId === challenge.challengeId) >= limits.openPerSender) {
      return new ConflictError(
        `You can have ${limits.openPerSender} challenges open at once. Take one back first`,
        { details: { reason: CHALLENGE_LIMIT_REASONS.OPEN, limit: limits.openPerSender } },
      );
    }
    if (challenge.toId === "") return undefined;
    const recent = mine.filter(
      (each) => each.toId === challenge.toId && now < each.createdAt + limits.samePersonEveryMs,
    );
    if (recent[0].challengeId === challenge.challengeId) return undefined;
    return new ConflictError("You challenged them a moment ago. Try again in a few minutes", {
      details: {
        reason: CHALLENGE_LIMIT_REASONS.SAME_PERSON,
        retryAt: recent[0].createdAt + limits.samePersonEveryMs,
      },
    });
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
      const recipient = await recipientOf({ from, to, now });
      const policy = await safety.policyFor({ playerId: from.id, now });
      const challenge = await challengeAccessor.add({
        challengeId: newId(),
        fromId: from.id,
        fromName: from.displayName,
        fromPublic: policy.shareCardName,
        toId: recipient.id,
        toName: recipient.displayName,
        gameId,
        options: value,
        createdAt: now,
        expiresAt: now + lifetimes.openMs,
        deleteAt: now + lifetimes.openMs + lifetimes.keptMs,
      });
      const broken = await brokenLimit(challenge, now);
      if (broken !== undefined) {
        await challengeAccessor.remove(challenge.challengeId);
        throw broken;
      }
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
     * take it. If the room cannot be made or recorded, the challenge is open again.
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
      const claimed = await challengeAccessor.claim({
        ...claim,
        acceptedName: player.displayName,
        at: now,
        staleBefore: staleBefore(now),
      });
      if (!claimed) {
        throw await endedSince(challengeId, now);
      }
      let recorded;
      try {
        const room = await rooms.createChallengeRoom({
          challenger: { id: challenge.fromId, displayName: challenge.fromName },
          accepter: player,
          network,
          earlierNetworks,
          gameId: challenge.gameId,
          options: challenge.options,
          now,
        });
        recorded = (await challengeAccessor.setRoom({ ...claim, roomCode: room.code })) ? room : undefined;
      } catch (err) {
        await challengeAccessor.release(claim);
        throw err;
      }
      // The hold ran out and someone else took it meanwhile. The room made here closes by itself.
      if (recorded === undefined) {
        throw await endedSince(challengeId, now);
      }
      const accepted = await challengeAccessor.get(challengeId);
      await announce(accepted);
      return {
        challenge: viewFor(accepted, player.id, { now, blocked: false }),
        room: Object.freeze({ code: recorded.code, gameId: recorded.gameId }),
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
      const end = { challengeId, state: CHALLENGE_STATES.DECLINED, at: now, staleBefore: staleBefore(now) };
      if (!(await challengeAccessor.end(end))) {
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
      const end = { challengeId, state: CHALLENGE_STATES.WITHDRAWN, at: now, staleBefore: staleBefore(now) };
      if (!(await challengeAccessor.end(end))) {
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
     * The owner suspended the player's account (CC-334, ADR-078 decision 5): every challenge they made that is still
     * open ends as withdrawn, so nobody can take a link into a room with them, and whoever it was for sees an
     * ordinary take-back. Challenges sent to them are left to run out, as for anyone who does not answer.
     *
     * @param {{ playerId: string, now: number }} input
     * @returns {Promise<number>} challenges withdrawn
     */
    async playerSuspended({ playerId, now }) {
      const open = (await challengeAccessor.listFrom(playerId)).filter(
        (challenge) => stateAt(challenge, now) === CHALLENGE_STATES.OPEN,
      );
      let withdrawn = 0;
      for (const { challengeId } of open) {
        const end = {
          challengeId,
          state: CHALLENGE_STATES.WITHDRAWN,
          at: now,
          staleBefore: staleBefore(now),
        };
        if (await challengeAccessor.end(end)) {
          withdrawn += 1;
          await announce(await challengeAccessor.get(challengeId));
        }
      }
      return withdrawn;
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
     * The player's challenges for their data export (CC-035): the ones they made and the ones sent to them, each in
     * the state it has now, with the other person by name only, never by id. A challenge sent by someone in a block
     * with them is left out, as the inbox leaves it out, so the export never shows a block (ADR-053).
     *
     * @param {{ playerId: string, now: number }} query
     */
    async exportPlayer({ playerId, now }) {
      const [mine, sent, blocked] = await Promise.all([
        challengeAccessor.listFrom(playerId),
        challengeAccessor.listTo(playerId),
        blocks.blockedWith({ playerId }),
      ]);
      const row = (challenge, fields) => ({
        challengeId: challenge.challengeId,
        gameId: challenge.gameId,
        options: challenge.options,
        state: stateAt(challenge, now),
        createdAt: new Date(challenge.createdAt).toISOString(),
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        ...fields,
      });
      return [
        ...mine.map((challenge) =>
          row(challenge, {
            made: true,
            ...(challenge.toName !== "" && { sentTo: challenge.toName }),
            ...(stateAt(challenge, now) === CHALLENGE_STATES.ACCEPTED && { takenBy: challenge.acceptedName }),
          }),
        ),
        ...sent
          .filter((challenge) => !blocked.has(challenge.fromId))
          .map((challenge) => row(challenge, { made: false, from: challenge.fromName })),
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
