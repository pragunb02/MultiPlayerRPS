import {
  CHALLENGE_LIFETIME_MS,
  CHALLENGE_LIMIT_REASONS,
  CHALLENGE_LIMITS,
  CHALLENGE_STATES,
  INVITE_KEEP_AFTER_MS,
} from "@classicade/shared";
import { newChallengeId } from "../../models/challengeId.js";
import { isQuietTime } from "../safety/agePolicy.js";
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
  /**
   * `{ challenge }`: someone took a challenge and its room was made, once per challenge. CC-052 counts an invite to
   * a friend taken as its flag's success.
   */
  ACCEPTED: "challenge.accepted",
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
  [CHALLENGE_STATES.FILLED]: "Game filled: they are playing someone else now",
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
 * @property {number} [until]         to its creator and the one who took it, how long a taken challenge stays in the
 *   inbox, cut short when the one who took it kept it for later (CC-052)
 * @property {number} [acceptedAt]    to the one who took it while its room waits, when they took it (CC-052 scenario 4)
 * @property {true} [toOne]           it was made for one person, an invite to a friend (CC-052)
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

  /** Until when a taken challenge's room waits for its creator: half an hour, or until the taker kept it for later. */
  const waitsUntil = (challenge) => challenge.keptAt || challenge.endedAt + lifetimes.acceptedShownMs;
  /** Whether a taken challenge's room still waits at `now`. */
  const roomWaits = (challenge, now) =>
    challenge.state === CHALLENGE_STATES.ACCEPTED && challenge.roomCode !== "" && now < waitsUntil(challenge);

  /**
   * What `viewerId` is told about `challenge`. A viewer in a blocked pair with its creator sees exactly what an
   * expired challenge shows them: the same fields with the same values, and nothing that only an open one has.
   */
  function viewFor(challenge, viewerId, { now, blocked, quiet = false }) {
    const own = viewerId === challenge.fromId;
    const forYou = challenge.toId !== "" && viewerId === challenge.toId;
    const state = blocked && !own ? CHALLENGE_STATES.EXPIRED : stateAt(challenge, now);
    const accepted = state === CHALLENGE_STATES.ACCEPTED;
    const took = accepted && viewerId === challenge.acceptedBy;
    const withRoom = accepted && challenge.roomCode !== "";
    // In the viewer's quiet hours an invite sent to them is in their inbox already: no popup, no sound (CC-052).
    const quietly = quiet && forYou && state === CHALLENGE_STATES.OPEN;
    return Object.freeze({
      id: challenge.challengeId,
      gameId: challenge.gameId,
      options: challenge.options,
      fromName: own || forYou || challenge.fromPublic ? challenge.fromName : "",
      own,
      forYou,
      took,
      later: challenge.laterBy.includes(viewerId) || quietly,
      state,
      ...(challenge.toId !== "" && { toOne: true }),
      ...(own && { createdAt: challenge.createdAt }),
      ...(state === CHALLENGE_STATES.OPEN && { expiresAt: challenge.expiresAt }),
      ...(own && challenge.toId !== "" && { toName: challenge.toName }),
      ...(own && accepted && { acceptedName: challenge.acceptedName }),
      ...((own || took) &&
        withRoom && { room: Object.freeze({ code: challenge.roomCode, gameId: challenge.gameId }) }),
      ...((own || took) && withRoom && { until: waitsUntil(challenge) }),
      ...(took && withRoom && { acceptedAt: challenge.endedAt }),
    });
  }

  /**
   * The group a new invite to a friend joins (CC-052 scenario 6): the sender's oldest open invite to the same game,
   * while nobody plays that group yet. Otherwise the invite starts its own group, named by its own id.
   */
  async function groupFor({ fromId, gameId, challengeId, now }) {
    const mine = await challengeAccessor.listFrom(fromId);
    const open = mine
      .filter(
        (each) => each.toId !== "" && each.gameId === gameId && stateAt(each, now) === CHALLENGE_STATES.OPEN,
      )
      .sort(oldestFirst);
    const first = mine.find((each) => each.challengeId === open[0]?.groupId);
    return first !== undefined && first.filledBy === "" ? first.challengeId : challengeId;
  }

  /** A challenge's record, or undefined when storage no longer has it. */
  const recordOf = (challengeId) =>
    challengeAccessor
      .get(challengeId)
      .catch((err) => (err instanceof NotFoundError ? undefined : Promise.reject(err)));

  /** Whether a challenge is taken by someone whose room is made, or is being made, at `now`. */
  async function isTaken(challengeId, now) {
    const holder = await recordOf(challengeId);
    return holder !== undefined && stateAt(holder, now) === CHALLENGE_STATES.ACCEPTED;
  }

  /**
   * The record that decides who plays an invite's group: the group's first record, or, once that one is gone (its
   * sender's data was erased, or it broke a limit and was removed), the oldest invite of the group still stored,
   * which every invite of the group finds alike.
   */
  async function anchorOf(challenge) {
    if ((await recordOf(challenge.groupId)) !== undefined) return challenge.groupId;
    const members = (await challengeAccessor.listFrom(challenge.fromId))
      .filter((each) => each.groupId === challenge.groupId)
      .sort(oldestFirst);
    return members[0].challengeId;
  }

  /**
   * Claims an invite's group for the invite just taken (CC-052 scenario 6): one conditional update on the group's
   * record, so of two friends accepting at the same moment exactly one plays. A group held by an invite whose hold
   * ran out, or that is no longer taken, can be claimed from it, until its room is made. Answers whether this invite
   * got it, and if not, whether the group is filled (a room is made) or only busy (a room is being made).
   *
   * @returns {Promise<{ won: boolean, filled: boolean, anchor: string }>}
   */
  async function claimGroup(challenge, now) {
    const anchor = await anchorOf(challenge);
    const group = { groupId: anchor, by: challenge.challengeId };
    if (await challengeAccessor.claimGroup({ ...group, from: "" }))
      return { won: true, filled: false, anchor };
    const { filledBy, filledDone } = await challengeAccessor.get(anchor);
    if (filledDone) return { won: false, filled: true, anchor };
    // This invite's own earlier take was cut off after it claimed the group: the group is still its own.
    if (filledBy === group.by) return { won: true, filled: false, anchor };
    if (await isTaken(filledBy, now)) return { won: false, filled: false, anchor };
    const won = await challengeAccessor.claimGroup({ ...group, from: filledBy });
    return { won, filled: false, anchor };
  }

  /** An invite whose group another friend plays: it is filled, and its friend and sender hear so. */
  async function filled(challengeId, claim, now) {
    await challengeAccessor.release(claim);
    await challengeAccessor.end({
      challengeId,
      state: CHALLENGE_STATES.FILLED,
      at: now,
      staleBefore: staleBefore(now),
    });
    await announce(await challengeAccessor.get(challengeId));
    return ended(CHALLENGE_STATES.FILLED);
  }

  /**
   * Ends every open invite between two players whose friendship just ended (CC-052): removed or blocked. Each reads
   * as expired from now on, exactly as an invite nobody answered, so nothing shows why.
   */
  async function endInvitesBetween({ a, b, now }) {
    const between = [
      ...(await challengeAccessor.listFrom(a)).filter((each) => each.toId === b),
      ...(await challengeAccessor.listFrom(b)).filter((each) => each.toId === a),
    ].filter((each) => stateAt(each, now) === CHALLENGE_STATES.OPEN);
    for (const each of between) {
      if (
        await challengeAccessor.expireNow({
          challengeId: each.challengeId,
          at: now,
          staleBefore: staleBefore(now),
        })
      ) {
        await announce(await challengeAccessor.get(each.challengeId));
      }
    }
    return between.length;
  }

  /** The other open invites of a group someone now plays: each is filled, and its friend hears so. */
  async function fillGroup(challenge, now) {
    const others = (await challengeAccessor.listFrom(challenge.fromId)).filter(
      (each) =>
        each.groupId === challenge.groupId &&
        each.challengeId !== challenge.challengeId &&
        stateAt(each, now) === CHALLENGE_STATES.OPEN,
    );
    for (const other of others) {
      const end = { challengeId: other.challengeId, state: CHALLENGE_STATES.FILLED, at: now };
      if (await challengeAccessor.end({ ...end, staleBefore: staleBefore(now) })) {
        await announce(await challengeAccessor.get(other.challengeId));
      }
    }
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

  const component = Object.freeze({
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
      const challengeId = newId();
      const invite = recipient.id !== "";
      // An invite reaching a player in their quiet hours waits in their inbox, without a popup or a sound (CC-052).
      const quiet = invite && isQuietTime(await safety.policyFor({ playerId: recipient.id, now }), now);
      const challenge = await challengeAccessor.add({
        challengeId,
        ...(invite && { groupId: await groupFor({ fromId: from.id, gameId, challengeId, now }) }),
        ...(quiet && { laterBy: [recipient.id] }),
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
    viewFor: async (challenge, viewerId, now) => {
      // An open invite pushed to its friend in their quiet hours goes to their inbox, without a popup (CC-052).
      const quiet =
        challenge.toId === viewerId &&
        stateAt(challenge, now) === CHALLENGE_STATES.OPEN &&
        isQuietTime(await safety.policyFor({ playerId: viewerId, now }), now);
      return viewFor(challenge, viewerId, { now, blocked: false, quiet });
    },

    /**
     * Ends the open invites between two players whose friendship ended (CC-052): they read as expired, as an invite
     * nobody answered.
     *
     * @param {{ a: string, b: string, now: number }} pair
     * @returns {Promise<number>} how many there were
     */
    endInvitesBetween,

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
      const invite = challenge.toId !== "";
      let anchor = "";
      if (invite) {
        const group = await claimGroup(challenge, now).catch(async (err) => {
          await challengeAccessor.release(claim);
          throw err;
        });
        if (!group.won && group.filled) {
          // Another friend took the sender's invite to this game first: this one is filled (CC-052 scenario 6).
          throw await filled(challengeId, claim, now);
        }
        if (!group.won) {
          // Another friend's room is being made. It may still fail, so this invite stays open to try again.
          await challengeAccessor.release(claim);
          throw new ConflictError("Another friend is taking this game just now. Try again in a moment");
        }
        anchor = group.anchor;
      }
      let recorded;
      let lostGroup;
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
        // A room slower than the claim lease may have lost the group to another friend meanwhile. The group must
        // still be this invite's: one conditional write decides, so only one room of a group ever counts.
        lostGroup = invite && !(await challengeAccessor.confirmGroup({ groupId: anchor, by: challengeId }));
        if (!lostGroup) {
          recorded = (await challengeAccessor.setRoom({ ...claim, roomCode: room.code })) ? room : undefined;
        }
      } catch (err) {
        await challengeAccessor.release(claim);
        if (invite) {
          await challengeAccessor.releaseGroup({ groupId: anchor, by: challengeId });
        }
        throw err;
      }
      // The room made here is not the group's, and closes by itself.
      if (lostGroup) {
        throw await filled(challengeId, claim, now);
      }
      // The hold ran out and someone else took it meanwhile. The room made here closes by itself.
      if (recorded === undefined) {
        throw await endedSince(challengeId, now);
      }
      const accepted = await challengeAccessor.get(challengeId);
      events.emit(CHALLENGE_EVENTS.ACCEPTED, { challenge: accepted });
      await announce(accepted);
      if (invite) await fillGroup(accepted, now);
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
     * Invites the sender of an invite back, to the same game with the same options (CC-052), from the friend it was
     * sent to:
     *
     * 1. after "Game filled": another friend took the sender's invite first (scenario 6), or
     * 2. to keep it for later: they took it, its room waits, and its sender has not come for INVITE_KEEP_AFTER_MS
     *    (scenario 4). The old room then stops waiting in both inboxes, so the sender finds the new invite instead.
     *
     * The new invite follows every rule of a new one: friends only, both limits and the rate limits.
     *
     * @param {{ challengeId: string, player: import("../../models/identity.js").Identity, now: number }} input
     * @returns {Promise<Readonly<ChallengeView>>} the player's view of the new invite
     * @throws {ForbiddenError} for anyone it was not sent to
     * @throws {GoneError} when it is in no state to invite back from, with `details.state`. A block reads as expired
     * @throws {ConflictError} with `details.retryAt` while the room has waited less than INVITE_KEEP_AFTER_MS
     */
    async again({ challengeId, player, now }) {
      const stored = await challengeAccessor.get(challengeId);
      if (stored.toId === "" || stored.toId !== player.id) {
        throw new ForbiddenError("That invite was not sent to you");
      }
      if (await blockedBetween(player.id, stored.fromId)) {
        throw ended(CHALLENGE_STATES.EXPIRED);
      }
      const state = stateAt(stored, now);
      const keeping =
        state === CHALLENGE_STATES.ACCEPTED && stored.acceptedBy === player.id && roomWaits(stored, now);
      if (state !== CHALLENGE_STATES.FILLED && !keeping) {
        throw ended(state);
      }
      if (keeping && now < stored.endedAt + INVITE_KEEP_AFTER_MS) {
        throw new ConflictError("Give them a few more minutes", {
          details: { retryAt: stored.endedAt + INVITE_KEEP_AFTER_MS },
        });
      }
      const back = await component.create({
        from: player,
        gameId: stored.gameId,
        options: stored.options,
        to: Object.freeze({ playerId: stored.fromId }),
        now,
      });
      if (keeping && (await challengeAccessor.keep({ challengeId, acceptedBy: player.id, at: now }))) {
        await announce(await challengeAccessor.get(challengeId));
      }
      return back;
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
      const [mine, sent, blocked, policy] = await Promise.all([
        challengeAccessor.listFrom(playerId),
        challengeAccessor.listTo(playerId),
        blocks.blockedWith({ playerId }),
        safety.policyFor({ playerId, now }),
      ]);
      const isOpen = (challenge) => stateAt(challenge, now) === CHALLENGE_STATES.OPEN;
      // An invite the player took, while its room waits: their room page tells them its sender was told (CC-052).
      const tookIt = (challenge) => challenge.acceptedBy === playerId && roomWaits(challenge, now);
      const shown = [
        ...mine.filter((challenge) => isOpen(challenge) || roomWaits(challenge, now)),
        ...sent.filter(
          (challenge) => (isOpen(challenge) || tookIt(challenge)) && !blocked.has(challenge.fromId),
        ),
      ];
      const quiet = isQuietTime(policy, now);
      return Object.freeze(
        shown
          .sort(newestFirst)
          .map((challenge) => viewFor(challenge, playerId, { now, blocked: false, quiet })),
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
  return component;
}
