import { CHESS_RATING_START, QUICK_MATCH_OUTCOMES } from "@classicade/shared";
import { botIdentity } from "../../models/botIdentity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { isRatedGame } from "../ratings/chessRatingRules.js";
import { QUICK_MATCH_MODES } from "../safety/agePolicy.js";
import {
  MATCHMAKING_RULES,
  nearbyPoolKeys,
  pickPartner,
  poolKeyOf,
  quickMatchOptions,
  searchPlan,
  SKIP_REASONS,
} from "./matchmakingRules.js";
import { COUNT_OUTCOMES } from "./quickMatchCounts.js";

const DAY_MS = 24 * 3_600_000;

/**
 * Where one search is. It only ever moves down this list, and only `settle` makes it SETTLED, once.
 *
 * 1. PREPARING: reading the player's policy, blocks and rating. Not in a pool yet.
 * 2. SEARCHING: in its pool, the character's room being made ready beside it. Cancel ends it at once.
 * 3. PAIRING: taken out of the pool with a partner, the host's room being awaited. A cancel now is kept and decided
 *    before the room is joined.
 * 4. COMMITTED: the game is being started (a person joining, or the character). A cancel now is too late if the
 *    game starts, and the room's own rules apply to whoever is not there (a first move within 60 s, ADR-034.5).
 *    It is still kept: when the person's join fails, the search ends cancelled instead of looking again.
 * 5. SETTLED: its one outcome is given.
 */
const STATES = Object.freeze({
  PREPARING: "preparing",
  SEARCHING: "searching",
  PAIRING: "pairing",
  COMMITTED: "committed",
  SETTLED: "settled",
});

/** Real timers. Tests pass their own. */
const REAL_TIMERS = Object.freeze({
  set: (run, ms) => setTimeout(run, ms),
  clear: (timer) => clearTimeout(timer),
});

const CANCELLED = Object.freeze({ outcome: QUICK_MATCH_OUTCOMES.CANCELLED });

/**
 * Quick match (CC-051, ADR-079): the main Play button looks for a person for at most a few seconds while the game
 * against the computer character is made ready beside it, and plays the character when nobody is free.
 *
 * **One process only.** The queue is in this process's memory, one pool per game and, for chess, per rating band.
 * A second server (CC-061) needs a shared queue: two players searching on two servers would never meet. A restart
 * drops every search, and each one's tab is told it was cut off like any other request.
 *
 * **Exactly one outcome per search.** Every search ends once, as a person, the character, cancelled or an error,
 * and a player has at most one search: a newer one cancels the older. The state of every search changes only in
 * synchronous code (the process runs one thing at a time), so two searches can never both take the same partner,
 * and a cancel either takes a search out before it is paired or comes too late to stop the game.
 *
 * **The room.** Each search makes its own waiting room at once, marked `quickMatch` so whoever sits with the host
 * met as strangers (ADR-051.7, `coPlayers`). When a person is found, the newer search's player joins the older's
 * room, which starts the game, and the newer room is closed. When nobody is found the character sits in the
 * player's room, which starts the game at once. The room component checks blocks again as the person sits down,
 * so a block made a moment before pairing still keeps the two apart.
 *
 * @param {{
 *   rooms: Pick<ReturnType<typeof import("../rooms/roomComponent.js").createRoomComponent>, "createRoom" | "joinRoom" | "leaveRoom">,
 *   bots: Pick<ReturnType<typeof import("../bots/botComponent.js").createBotComponent>, "playComputer" | "seatComputer">,
 *   blocks: { blockedWith: (query: { playerId: string }) => Promise<ReadonlySet<string>> },
 *   safety: { policyFor: (query: { playerId: string, now: number }) => Promise<Readonly<{ quickMatch: string }>> },
 *   ratings: { ratingsOf: (query: { gameId: string, playerIds: ReadonlyArray<string>, matchId: string }) => Promise<ReadonlyArray<{ rating: number }>> },
 *   counts: { record: (search: { gameId: string, outcome: string, waitMs: number }) => void },
 *   now: () => number,
 *   logger: import("../../utils/logger.js").Logger,
 *   timers?: { set: (run: () => void, ms: number) => unknown, clear: (timer: unknown) => void },
 *   rules?: Readonly<typeof MATCHMAKING_RULES>,
 * }} deps  `safety` is the one place for the age rules (CC-152), `counts` the anonymous counts (quickMatchCounts.js)
 */
export function createMatchmakingComponent({
  rooms,
  bots,
  blocks,
  safety,
  ratings,
  counts,
  now,
  logger,
  timers = REAL_TIMERS,
  rules = MATCHMAKING_RULES,
}) {
  assertFunction(rooms?.createRoom, "rooms.createRoom");
  assertFunction(rooms?.joinRoom, "rooms.joinRoom");
  assertFunction(rooms?.leaveRoom, "rooms.leaveRoom");
  assertFunction(bots?.playComputer, "bots.playComputer");
  assertFunction(bots?.seatComputer, "bots.seatComputer");
  assertFunction(blocks?.blockedWith, "blocks.blockedWith");
  assertFunction(safety?.policyFor, "safety.policyFor");
  assertFunction(ratings?.ratingsOf, "ratings.ratingsOf");
  assertFunction(counts?.record, "counts.record");
  assertFunction(now, "now");
  assertDefined(logger, "logger");

  /** Each player's one search. */
  const live = new Map();
  /** The searches waiting in each pool, oldest first. */
  const pools = new Map();
  /** When quick match paired each pair, for `pairsPerDay`. Keyed by the two player ids in order. */
  const pairings = new Map();
  /** The waits of the latest searches that found a person, for the search timeout (ADR-029). */
  const recentWaits = [];
  let order = 0;
  let sweepTimer;

  const pairKeyOf = (a, b) => JSON.stringify([a.playerId, b.playerId].sort());

  function pairCountOf(a, b) {
    const key = pairKeyOf(a, b);
    const since = now() - DAY_MS;
    const times = (pairings.get(key) ?? []).filter((at) => at > since);
    if (times.length === 0) pairings.delete(key);
    else pairings.set(key, times);
    return times.length;
  }

  /** Forgets every pairing older than 24 hours, so no pair of player ids is held longer (DATA.md). */
  function prunePairings() {
    const since = now() - DAY_MS;
    for (const [key, times] of pairings) {
      const kept = times.filter((at) => at > since);
      if (kept.length === 0) pairings.delete(key);
      else if (kept.length !== times.length) pairings.set(key, kept);
    }
  }

  function addToPool(entry) {
    const pool = pools.get(entry.key) ?? new Set();
    pools.set(entry.key, pool.add(entry));
  }

  function removeFromPool(entry) {
    const pool = pools.get(entry.key);
    if (pool === undefined) return;
    pool.delete(entry);
    if (pool.size === 0) pools.delete(entry.key);
  }

  const candidatesFor = (entry) =>
    nearbyPoolKeys(entry, rules)
      .flatMap((key) => [...(pools.get(key) ?? [])])
      .filter((other) => other.state === STATES.SEARCHING);

  /** The one place a search ends. Answers whether this call ended it. */
  function settle(entry, result) {
    if (entry.state === STATES.SETTLED) return false;
    entry.state = STATES.SETTLED;
    timers.clear(entry.timer);
    removeFromPool(entry);
    if (live.get(entry.playerId) === entry) live.delete(entry.playerId);
    const waitMs = Math.max(0, now() - entry.since);
    counts.record({ gameId: entry.gameId, outcome: countOutcomeOf(entry, result), waitMs });
    if (result instanceof Error) {
      entry.reject(result);
    } else {
      entry.resolve(result);
    }
    return true;
  }

  function countOutcomeOf(entry, result) {
    if (result instanceof Error) return COUNT_OUTCOMES.FAILED;
    switch (result.outcome) {
      case QUICK_MATCH_OUTCOMES.PERSON:
        return COUNT_OUTCOMES.MATCHED;
      case QUICK_MATCH_OUTCOMES.CHARACTER:
        return entry.skipped === undefined ? COUNT_OUTCOMES.TIMED_OUT : COUNT_OUTCOMES.SKIPPED;
      default:
        return COUNT_OUTCOMES.CANCELLED;
    }
  }

  /** Closes the room a search made ready and no longer needs. A room that never came, or closed, needs nothing. */
  function closePrepared(entry) {
    entry.room
      ?.then((room) =>
        rooms.leaveRoom({ code: room.code, playerId: entry.playerId, now: now(), waitingOnly: true }),
      )
      .catch((err) => logger.debug({ err }, "a quick match room was already gone"));
  }

  function cancelled(entry) {
    if (settle(entry, CANCELLED)) closePrepared(entry);
  }

  /** The character, at once: the site is empty, or the player's policy keeps them out of every search. */
  async function playNow(entry, reason) {
    entry.skipped = reason;
    entry.state = STATES.COMMITTED;
    const room = await bots.playComputer({
      host: entry.player,
      network: entry.network,
      earlierNetworks: entry.earlierNetworks,
      gameId: entry.gameId,
      options: entry.options,
      level: entry.level,
      now: now(),
    });
    settle(entry, Object.freeze({ outcome: QUICK_MATCH_OUTCOMES.CHARACTER, room }));
  }

  /** Nobody was found in time: the character sits in the room made ready for it. */
  async function fallBack(entry) {
    entry.state = STATES.COMMITTED;
    removeFromPool(entry);
    try {
      const room = await entry.room;
      const started = await bots.seatComputer({
        code: room.code,
        host: entry.player,
        gameId: entry.gameId,
        level: entry.level,
        now: now(),
      });
      settle(entry, Object.freeze({ outcome: QUICK_MATCH_OUTCOMES.CHARACTER, room: started }));
    } catch (err) {
      if (settle(entry, err)) closePrepared(entry);
    }
  }

  function timedOut(entry) {
    if (entry.state === STATES.SEARCHING) {
      fallBack(entry);
    } else if (entry.state === STATES.PAIRING) {
      entry.timedOut = true;
    }
  }

  /** A pairing did not happen: the search goes back to its pool, or ends as its cancel or its time says. */
  function release(entry) {
    if (entry.state === STATES.SETTLED) return;
    if (entry.cancelRequested) {
      cancelled(entry);
      return;
    }
    entry.state = STATES.SEARCHING;
    if (entry.timedOut || now() >= entry.deadline) {
      fallBack(entry);
      return;
    }
    addToPool(entry);
    tryPair(entry);
  }

  /** Seats the newer search's player in the older search's room, which starts the game. */
  async function pair(host, guest) {
    let hostRoom;
    try {
      hostRoom = await host.room;
    } catch (err) {
      settle(host, err);
      release(guest);
      return;
    }
    if (host.cancelRequested || guest.cancelRequested) {
      release(host);
      release(guest);
      return;
    }
    host.state = STATES.COMMITTED;
    guest.state = STATES.COMMITTED;
    let started;
    try {
      started = await rooms.joinRoom({ code: hostRoom.code, player: guest.player, now: now() });
    } catch (err) {
      // Blocked a moment ago (the room answers "full"), or the room closed: never these two again in this search.
      logger.info({ err, roomCode: hostRoom.code }, "quick match pairing did not happen");
      host.avoid.add(guest.playerId);
      guest.avoid.add(host.playerId);
      host.state = STATES.PAIRING;
      guest.state = STATES.PAIRING;
      release(host);
      release(guest);
      return;
    }
    const key = pairKeyOf(host, guest);
    pairings.set(key, [...(pairings.get(key) ?? []), now()]);
    // How long a person had to wait for a partner is the older side's wait. The newer side found someone at once,
    // and counting it would pull the timeout down to nothing (ADR-079.3).
    recentWaits.push(Math.max(0, now() - host.since));
    recentWaits.splice(0, Math.max(0, recentWaits.length - rules.waitSamples));
    const found = Object.freeze({ outcome: QUICK_MATCH_OUTCOMES.PERSON, room: started });
    settle(host, found);
    settle(guest, found);
    closePrepared(guest);
  }

  /** Pairs a searching player with the partner who waited longest, if any may be paired with them now. */
  function tryPair(entry) {
    if (entry.state !== STATES.SEARCHING) return;
    const partner = pickPartner(
      { seeker: entry, candidates: candidatesFor(entry), now: now(), pairCountOf },
      rules,
    );
    if (partner === undefined) {
      scheduleSweep();
      return;
    }
    // Both leave the pool in this same step, so no other search can take either of them.
    entry.state = STATES.PAIRING;
    partner.state = STATES.PAIRING;
    removeFromPool(entry);
    removeFromPool(partner);
    pair(partner, entry).catch((err) => logger.error({ err }, "quick match pairing failed"));
  }

  /** Waiting searches that could not be paired yet are looked at again, as chess windows widen with the wait. */
  function scheduleSweep() {
    if (sweepTimer !== undefined) return;
    const waiting = [...pools.values()].flatMap((pool) => [...pool]);
    if (!waiting.some((entry) => entry.state === STATES.SEARCHING && hasNeighbour(entry))) return;
    sweepTimer = timers.set(() => {
      sweepTimer = undefined;
      prunePairings();
      const looking = [...pools.values()]
        .flatMap((pool) => [...pool])
        .sort((a, b) => a.since - b.since || a.order - b.order);
      looking.forEach(tryPair);
    }, rules.sweepMs);
  }

  async function ratingOf(playerId, gameId) {
    if (!isRatedGame(gameId)) return undefined;
    const [rating] = await ratings.ratingsOf({ gameId, playerIds: [playerId], matchId: "" });
    return rating?.rating ?? CHESS_RATING_START.rating;
  }

  /** Reads what the search needs, then either plays the character at once or starts looking. */
  async function setUp(entry, othersOnline) {
    const [policy, blocked, rating] = await Promise.all([
      safety.policyFor({ playerId: entry.playerId, now: now() }),
      blocks.blockedWith({ playerId: entry.playerId }),
      ratingOf(entry.playerId, entry.gameId),
    ]);
    // Cancelled, or replaced by a newer search, while it read.
    if (entry.state !== STATES.PREPARING) return;
    entry.blocked = blocked;
    entry.rating = rating;
    entry.key = poolKeyOf(entry, rules);
    if (policy.quickMatch !== QUICK_MATCH_MODES.STRANGERS) {
      await playNow(entry, SKIP_REASONS.POLICY);
      return;
    }
    const partnerWaiting =
      pickPartner({ seeker: entry, candidates: candidatesFor(entry), now: now(), pairCountOf }, rules) !==
      undefined;
    const probe = entry.order % rules.probeEvery === 0;
    const plan = searchPlan({ othersOnline, partnerWaiting, recentWaits, probe }, rules);
    if (!plan.search) {
      await playNow(entry, plan.reason);
      return;
    }
    // The character's room is made ready beside the search, so a search that finds nobody starts at once.
    entry.room = rooms.createRoom({
      host: entry.player,
      network: entry.network,
      earlierNetworks: entry.earlierNetworks,
      gameId: entry.gameId,
      options: entry.options,
      now: now(),
      quickMatch: true,
    });
    entry.room.catch((err) => {
      // A room that cannot be made (a limit) ends a search still looking. A paired one finds out in `pair`.
      if (entry.state === STATES.SEARCHING) settle(entry, err);
    });
    entry.deadline = entry.since + plan.timeoutMs;
    entry.state = STATES.SEARCHING;
    addToPool(entry);
    entry.timer = timers.set(() => timedOut(entry), Math.max(0, entry.deadline - now()));
    tryPair(entry);
  }

  /**
   * Ends a search for the player who cancelled it. While paired, the cancel waits for the pairing to be decided.
   *
   * @returns {Promise<{ cancelled: boolean }>}
   */
  async function cancelEntry(entry) {
    if (entry.state === STATES.PREPARING || entry.state === STATES.SEARCHING) {
      cancelled(entry);
      return { cancelled: true };
    }
    if (entry.state === STATES.PAIRING || entry.state === STATES.COMMITTED) {
      // Kept in either state: a pairing whose join then fails ends the search instead of looking again.
      entry.cancelRequested = true;
      const result = await entry.done.catch(() => undefined);
      return { cancelled: result?.outcome === QUICK_MATCH_OUTCOMES.CANCELLED };
    }
    return { cancelled: false };
  }

  /** Whether a waiting search has someone in its own or a neighbouring pool who may be paired with it later. */
  const hasNeighbour = (entry) => candidatesFor(entry).some((other) => other !== entry);

  return Object.freeze({
    /**
     * Looks for a person to play `gameId` with, and answers the game that started.
     *
     * @param {{
     *   player: import("../../models/identity.js").Identity,
     *   network: string,
     *   earlierNetworks?: ReadonlyArray<string>,
     *   gameId: string,
     *   level: string,
     *   othersOnline: number,
     *   socketId: string,
     * }} input  `level` is the character's level pick for the fallback. `othersOnline` is how many other players
     *   are connected, for the liquidity gate. `socketId` is the tab that asked, so only that tab's leaving cancels
     *   it. `network` and `earlierNetworks` name the player's network, as for any new room
     * @returns {Promise<Readonly<{ outcome: string, room?: Readonly<import("../../data/roomAccessor.js").Room> }>>}
     *   `outcome` a QUICK_MATCH_OUTCOMES value, with the started room for a person or the character
     * @throws {import("../../utils/errors.js").ValidationError} for a game without a character or an unknown level,
     *   before anything starts, and whatever making the room throws (a room limit)
     */
    search({ player, network, earlierNetworks = [], gameId, level, othersOnline, socketId }) {
      botIdentity({ gameId, level });
      prunePairings();
      /** @type {any} */
      const entry = {
        player,
        playerId: player.id,
        socketId,
        network,
        earlierNetworks,
        gameId,
        level,
        options: quickMatchOptions(gameId),
        since: now(),
        order: ++order,
        state: STATES.PREPARING,
        blocked: new Set(),
        avoid: new Set(),
        key: gameId,
      };
      entry.done = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      const earlier = live.get(player.id);
      live.set(player.id, entry);
      if (earlier !== undefined) cancelEntry(earlier);
      setUp(entry, othersOnline).catch((err) => settle(entry, err));
      return entry.done;
    },

    /**
     * Cancels the player's search: they pressed Cancel, left or hid the page, or their tab closed.
     *
     * @param {{ playerId: string, socketId?: string }} input  with `socketId`, only a search that tab started
     * @returns {Promise<{ cancelled: boolean }>} false when there was none, or it had already found its game
     */
    async cancel({ playerId, socketId }) {
      const entry = live.get(playerId);
      if (entry === undefined || (socketId !== undefined && entry.socketId !== socketId)) {
        return { cancelled: false };
      }
      return cancelEntry(entry);
    },

    /** How many pairs of players quick match remembers pairing in the last 24 hours. For tests. */
    heldPairs: () => pairings.size,

    /** Cancels every search, for shutdown. */
    stop() {
      if (sweepTimer !== undefined) timers.clear(sweepTimer);
      sweepTimer = undefined;
      [...live.values()].forEach((entry) => cancelEntry(entry));
    },
  });
}
