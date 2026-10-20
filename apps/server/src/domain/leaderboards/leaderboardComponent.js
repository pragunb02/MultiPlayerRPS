import {
  getLeaderboard,
  HIDDEN_PLAYER_NAME,
  LEADERBOARD_UNLISTED,
  LEADERBOARDS,
  levelForXp,
  XP_AWARDS,
} from "@classicade/shared";
import { isAccountId, isGuestId, isServerGivenGuestName } from "../../models/identity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError } from "../../utils/errors.js";
import { creditFor, hasComputerPlayer } from "../matches/fairPlay.js";
import { resultFor } from "../progression/progressionComponent.js";
import {
  gamesWithWinsBoards,
  hasWinsBoard,
  rowEnds,
  storageFor,
  weekOf,
  winsBoard,
  XP_BOARD,
} from "./boards.js";

const ALL = "all";
/** A row's card: all of it, or only the avatar on a hidden row, which never links to a profile (CC-034). */
const avatarOnly = (card, hidden) =>
  card === undefined ? {} : hidden ? (card.avatar === undefined ? {} : { avatar: card.avatar }) : card;
// Without profiles nobody has an avatar or a profile link. Tests that are not about profiles build boards without.
const NO_CARDS = Object.freeze({ cardsFor: async () => new Map() });
const HISTORY_PAGE = 100;

/**
 * The XP a board shows for a player whose whole XP is `xp`: everything except the XP from games against computer
 * characters and the quest bonuses those games earned (ADR-025). The level stays the one their whole XP gives.
 * `stored` is read after `xp` was, so its unranked part can only be newer, and the board can only show too little.
 *
 * @param {{ xp: number, level: number }} total
 * @param {{ unrankedXp: number }} stored
 */
const rankedEntry = ({ xp, level }, stored) => Object.freeze({ xp: xp - stored.unrankedXp, level });

/** Accounts and guests have rows. Computer characters and the stand-ins of deleted accounts never do. */
const hasRows = (playerId) => isAccountId(playerId) || isGuestId(playerId);

/**
 * The name a row shows. An adult account shows its username. A guest shows the name the server gave it, which it
 * did not choose and which says nothing about it (ADR-060). Everyone else is hidden (ADR-048.10). A guest row with
 * any other name is hidden too, so a name a guest could one day choose falls under the age rule.
 *
 * @param {{ playerId: string, displayName: string }} entry
 * @param {ReadonlySet<string>} adults
 */
function shownName({ playerId, displayName }, adults) {
  const serverGiven = isGuestId(playerId) && isServerGivenGuestName(displayName);
  return adults.has(playerId) || serverGiven
    ? { displayName }
    : { displayName: HIDDEN_PLAYER_NAME, hidden: true };
}

/**
 * Leaderboards (CC-053): overall XP, XP this ISO week, and wins per game, for accounts and for guests under their
 * server-given name (ADR-060). Scores follow recorded matches and progression, and every write is idempotent
 * (totals only ever rise, weekly additions are keyed by match or quest), so a match applied twice changes nothing.
 *
 * @param {{
 *   leaderboardAccessor: ReturnType<typeof import("../../data/leaderboardAccessor.js").createLeaderboardAccessor>,
 *   matchAccessor: Pick<ReturnType<typeof import("../../data/matchAccessor.js").createMatchAccessor>, "countWins" | "getById" | "listForPlayer" | "listWithdrawn">,
 *   progressAccessor: Pick<ReturnType<typeof import("../../data/progressAccessor.js").createProgressAccessor>, "get">,
 *   transfers: {
 *     listFrom: (playerIds: ReadonlyArray<string>) => Promise<ReadonlyArray<{ from: string, status: string }>>,
 *     listPendingTo: (playerIds: ReadonlyArray<string>) => Promise<ReadonlyArray<{ to: { id: string } }>>,
 *   },  the guests who have started moving to an account, and the accounts being moved into (ADR-014). Their rows
 *     move and are recomputed by the move, so the board step leaves them alone
 *   ages: { adultsAmong: (query: { playerIds: string[], now: number }) => Promise<ReadonlySet<string>> },  which
 *     players are adults. Every other account's name is hidden on the boards (CC-152)
 *   cards?: Pick<ReturnType<typeof import("../profiles/profileCards.js").createProfileCards>, "cardsFor">,  the
 *     avatar and profile link beside each name a board shows (CC-034). Without it rows have neither
 * }} deps
 */
export function createLeaderboardComponent({
  leaderboardAccessor,
  matchAccessor,
  progressAccessor,
  transfers,
  ages,
  cards = NO_CARDS,
}) {
  assertFunction(ages?.adultsAmong, "ages.adultsAmong");
  assertFunction(cards?.cardsFor, "cards.cardsFor");
  assertDefined(leaderboardAccessor, "leaderboardAccessor");
  assertDefined(matchAccessor, "matchAccessor");
  assertDefined(progressAccessor, "progressAccessor");
  assertFunction(transfers?.listFrom, "transfers.listFrom");
  assertFunction(transfers?.listPendingTo, "transfers.listPendingTo");

  /** @param {string} boardId */
  function requireBoard(boardId) {
    const info = getLeaderboard(boardId);
    if (info === undefined) {
      throw new NotFoundError("No such leaderboard");
    }
    return info;
  }

  /**
   * The guests among `playerIds` who have started moving to an account, or only those whose move is done.
   * Accounts are never asked about.
   *
   * @param {ReadonlyArray<string>} playerIds
   * @param {{ doneOnly: boolean }} which
   */
  async function movedGuestsAmong(playerIds, { doneOnly }) {
    const guests = playerIds.filter(isGuestId);
    if (guests.length === 0) {
      return new Set();
    }
    const moved = (await transfers.listFrom(guests)).filter(({ status }) => !doneOnly || status === "done");
    return new Set(moved.map(({ from }) => from));
  }

  /**
   * The accounts among `playerIds` that a guest is moving into right now. Their board rows are recomputed by that
   * move, so the step leaves them alone: writing them now could count a match the guest's row also brings.
   *
   * @param {ReadonlyArray<string>} playerIds
   */
  async function accountsBeingMovedInto(playerIds) {
    const accounts = playerIds.filter(isAccountId);
    if (accounts.length === 0) {
      return new Set();
    }
    return new Set((await transfers.listPendingTo(accounts)).map(({ to }) => to.id));
  }

  /**
   * Writes the rows of the players for whom `write` is called, but not of a guest who has started moving to an
   * account: its transfer moves its rows and recomputes the account's. Afterwards, also when a write failed, every
   * moved guest among them has its rows taken off, so no guest row is left beside its account. Removing them
   * again changes nothing. That race can only count too little, never twice (ADR-060).
   *
   * @param {ReadonlyArray<string>} playerIds
   * @param {(playerId: string) => Promise<void>} write
   */
  async function writeRowsOf(playerIds, write) {
    const movedBefore = await movedGuestsAmong(playerIds, { doneOnly: false });
    try {
      for (const playerId of playerIds.filter((id) => !movedBefore.has(id))) {
        await write(playerId);
      }
    } finally {
      for (const guestId of await movedGuestsAmong(playerIds, { doneOnly: false })) {
        await leaderboardAccessor.removePlayer(guestId);
      }
    }
  }

  /** A guest's all time rows end later with each counted game, also those this game did not raise (ADR-060). */
  async function keepGuestRows({ playerId, ends }) {
    if (ends.allTime !== undefined) {
      await leaderboardAccessor.extendLifetime({ playerId, period: ALL, expiresAt: ends.allTime });
    }
  }

  const allTimeEnd = (ends) => (ends.allTime === undefined ? {} : { expiresAt: ends.allTime });

  /** Called after a counted win, so the player has at least that one win. */
  const raiseWins = async ({ player, gameId, at, ends }) => {
    const wins = await matchAccessor.countWins({ playerId: player.playerId, gameId });
    await leaderboardAccessor.raiseScore({
      ...player,
      board: winsBoard(gameId),
      period: ALL,
      score: wins,
      at,
      ...allTimeEnd(ends),
    });
  };

  /** Overall XP follows the player's total; this week's XP adds what was earned, once per key. */
  const addXp = async ({ player, xp, gained, key, at, ends }) => {
    if (xp > 0) {
      await leaderboardAccessor.raiseScore({
        ...player,
        board: XP_BOARD,
        period: ALL,
        score: xp,
        at,
        ...allTimeEnd(ends),
      });
    }
    if (gained > 0) {
      await leaderboardAccessor.addOnce({
        ...player,
        board: XP_BOARD,
        period: weekOf(at).period,
        key,
        inc: gained,
        at,
        expiresAt: ends.week,
      });
    }
  };

  /** XP an account earned from its recorded matches that count (CC-095) since `since` (newest first, paged). */
  async function matchXpSince(playerId, since) {
    let total = 0;
    let before;
    for (;;) {
      const page = await matchAccessor.listForPlayer(playerId, { limit: HISTORY_PAGE, before });
      const recent = page.filter((match) => match.endedAt >= since);
      total += recent
        .filter((match) => creditFor(match, playerId).counted && !hasComputerPlayer(match))
        .reduce((sum, match) => sum + XP_AWARDS[resultFor(match, playerId)], 0);
      if (recent.length < HISTORY_PAGE) {
        return total;
      }
      before = page.at(-1).endedAt;
    }
  }

  /**
   * The XP of the guest's games that stopped counting when they moved to the account (ADR-021.6), per week. The
   * guest's weekly rows still hold it, so it is taken out before they are added to the account's.
   *
   * @returns {Promise<Map<string, number>>} week id to XP
   */
  async function withdrawnXpByWeek({ from, to }) {
    const byWeek = new Map();
    const withdrawn = await matchAccessor.listWithdrawn({ playerId: to, from });
    for (const match of withdrawn.filter((m) => !hasComputerPlayer(m) && !creditFor(m, to).counted)) {
      const { period } = weekOf(match.endedAt);
      byWeek.set(period, (byWeek.get(period) ?? 0) + XP_AWARDS[resultFor(match, to)]);
    }
    return byWeek;
  }

  /**
   * The XP of the guest's matches that the account's week has counted already, under the same match key: the board
   * step ran for the account after the match moved and before this move (#118). A key that is not a match (a quest)
   * is not counted, and nor is a match the guest played against this same account, since both sides earned it.
   *
   * @param {{ from: string, to: string, keys: ReadonlyArray<string> }} overlap  keys both rows have
   */
  async function xpAlreadyCounted({ from, to, keys }) {
    let xp = 0;
    for (const key of keys) {
      const match = await matchOrNone(key);
      const moved = match !== undefined && !match.players.some(({ playerId }) => playerId === from);
      if (moved && creditFor(match, to).counted && !hasComputerPlayer(match)) {
        xp += XP_AWARDS[resultFor(match, to)];
      }
    }
    return xp;
  }

  /** The stored match a board key names, or nothing when the key is not a match id (a quest key). */
  async function matchOrNone(key) {
    try {
      return await matchAccessor.getById(key);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Adds each weekly row of the guest to the account's row of the same week, once (ADR-060). The guest's match and
   * quest keys go with it, so a game the guest already had on that week is never added to the account again.
   *
   * @returns {Promise<number>} the account's rows that changed now
   */
  async function mergeGuestWeeks({ from, player, now }) {
    const weeks = (await leaderboardAccessor.listWithKeys({ board: XP_BOARD, playerId: from })).filter(
      ({ period }) => period !== ALL,
    );
    if (weeks.length === 0) {
      return 0;
    }
    const withdrawn = await withdrawnXpByWeek({ from, to: player.playerId });
    const accountWeeks = new Map(
      (await leaderboardAccessor.listWithKeys({ board: XP_BOARD, playerId: player.playerId })).map((row) => [
        row.period,
        row.recentKeys,
      ]),
    );
    let merged = 0;
    for (const { period, score, updatedAt, recentKeys } of weeks) {
      const counted = await xpAlreadyCounted({
        from,
        to: player.playerId,
        keys: recentKeys.filter((key) => (accountWeeks.get(period) ?? []).includes(key)),
      });
      const { applied } = await leaderboardAccessor.mergeOnce({
        ...player,
        board: XP_BOARD,
        period,
        from,
        keys: recentKeys,
        inc: Math.max(0, score - (withdrawn.get(period) ?? 0) - counted),
        at: now,
        // The row was last written inside its week, so that moment names the week's end for the account.
        expiresAt: weekOf(updatedAt).expiresAt,
      });
      merged += applied ? 1 : 0;
    }
    return merged;
  }

  return Object.freeze({
    /** The public catalog of boards. */
    listBoards: () => LEADERBOARDS.map(({ id, name, metric, period }) => ({ id, name, metric, period })),

    /**
     * One board's current period, best first. Entries carry public fields only, never player ids. A guest shows
     * its server-given name (ADR-060). The name of a minor or of an account of unknown age is hidden, with
     * `hidden: true`. The rank and score stay (ADR-028). Every row has the player's `avatar` when they picked one,
     * and an adult account's row whose name is shown the `profile` handle of their profile (CC-034).
     *
     * @param {{ boardId: string, limit: number, now: number }} query
     * @throws {NotFoundError} for an unknown board
     */
    async getBoard({ boardId, limit, now }) {
      const info = requireBoard(boardId);
      const { board, period, resetsAt } = storageFor(info, now);
      const stored = await leaderboardAccessor.listTop({ board, period, limit });
      // A guest whose move to an account is done is never shown, even when a row of it was left behind (#118).
      const gone = await movedGuestsAmong(
        stored.map((e) => e.playerId),
        { doneOnly: true },
      );
      const top = stored.filter((e) => !gone.has(e.playerId));
      const accounts = top.map((e) => e.playerId).filter(isAccountId);
      const adults = accounts.length === 0 ? new Set() : await ages.adultsAmong({ playerIds: accounts, now });
      const shown = top.map((entry) => ({ entry, name: shownName(entry, adults) }));
      // Every row shows the avatar its player picked, a hidden row too: avatars come from our own set and say
      // nothing about who someone is (owner, ADR-065). A hidden row never gets a profile link (CC-034).
      const cardOf =
        top.length === 0 ? new Map() : await cards.cardsFor({ playerIds: top.map((e) => e.playerId), now });
      return {
        board: {
          id: info.id,
          name: info.name,
          metric: info.metric,
          period: info.period,
          periodId: period,
          ...(resetsAt !== undefined && { resetsAt }),
        },
        entries: shown.map(({ entry, name }, index) => ({
          rank: index + 1,
          ...name,
          ...avatarOnly(cardOf.get(entry.playerId), name.hidden === true),
          level: entry.level,
          score: entry.score,
        })),
      };
    },

    /**
     * Where the viewer stands on a board, also outside the listed top entries. Guests are ranked like accounts.
     *
     * @param {{ boardId: string, viewer: import("../../models/identity.js").Identity, now: number }} query
     * @returns {Promise<{ listed: true, rank: number, score: number } | { listed: false, reason: string }>}
     * @throws {NotFoundError} for an unknown board
     */
    async standingFor({ boardId, viewer, now }) {
      const { board, period } = storageFor(requireBoard(boardId), now);
      if ((await movedGuestsAmong([viewer.id], { doneOnly: true })).has(viewer.id)) {
        return { listed: false, reason: LEADERBOARD_UNLISTED.UNRANKED };
      }
      try {
        const { rank, score } = await leaderboardAccessor.getStanding({ board, period, playerId: viewer.id });
        return { listed: true, rank, score };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return { listed: false, reason: LEADERBOARD_UNLISTED.UNRANKED };
        }
        throw err;
      }
    },

    /**
     * Pipeline step after progression: the players of a recorded match move up the boards. A match that doesn't
     * count for a player (CC-095) moves them nowhere. Everything is read from the stored match and progress, not
     * from what progression just answered, so the step gives the same result when it runs again after a failure
     * or a restart (CC-111).
     *
     * @param {{ match: Readonly<import("../../data/matchAccessor.js").Match> }} input
     */
    async applyMatch({ match }) {
      // Games against a computer character never move anyone on a board (ADR-025).
      if (hasComputerPlayer(match)) {
        return;
      }
      const counted = match.players
        .map(({ playerId }) => playerId)
        .filter((playerId) => hasRows(playerId) && creditFor(match, playerId).counted);
      const beingMovedInto = await accountsBeingMovedInto(counted);
      const listed = counted.filter((playerId) => !beingMovedInto.has(playerId));
      const at = match.endedAt;
      await writeRowsOf(listed, async (playerId) => {
        const { displayName } = match.players.find((p) => p.playerId === playerId);
        const result = resultFor(match, playerId);
        const ends = rowEnds({ isGuest: isGuestId(playerId), at });
        // Progression already added this match, and any quest bonus it earned (CC-089), to the stored total.
        const stored = await progressAccessor.get(playerId);
        const latest = rankedEntry({ xp: stored.xp, level: levelForXp(stored.xp) }, stored);
        const player = { playerId, displayName, level: latest.level };
        await addXp({ player, xp: latest.xp, gained: XP_AWARDS[result], key: match.matchId, at, ends });
        if (result === "win" && hasWinsBoard(match.gameId)) {
          await raiseWins({ player, gameId: match.gameId, at, ends });
        }
        await keepGuestRows({ playerId, ends });
      });
    },

    /**
     * Bonus XP outside matches (daily quests): counts for the overall and this week's boards, unless a game against
     * a computer character earned it (`ranked` is false, ADR-025).
     *
     * @param {{ playerId: string, displayName: string, key: string, xpGained: number, ranked: boolean, progress: { xp: number, level: number }, at: number }} bonus
     */
    async applyBonus({ playerId, displayName, key, xpGained, ranked, progress, at }) {
      if (!hasRows(playerId) || !ranked) {
        return;
      }
      await writeRowsOf([playerId], async () => {
        const ends = rowEnds({ isGuest: isGuestId(playerId), at });
        const latest = rankedEntry(progress, await progressAccessor.get(playerId));
        const player = { playerId, displayName, level: latest.level };
        await addXp({ player, xp: latest.xp, gained: xpGained, key, at, ends });
        await keepGuestRows({ playerId, ends });
      });
    },

    /**
     * A guest's data moved to an account (ADR-014 participant, last). The guest's weekly rows are added to the
     * account's once, then the account's rows are recomputed from its (already moved) progress and match history,
     * and the guest's rows are deleted (ADR-060). Every step can run again and adds nothing twice.
     *
     * @param {{ from: string, to: import("../../models/identity.js").Identity, now: number }} input
     * @returns {Promise<{ moved: Record<string, number> }>}  `leaderboardEntries`: account entries that rose
     */
    async transferPlayer({ from, to, now }) {
      const stored = await progressAccessor.get(to.id);
      const { xp, level } = rankedEntry({ xp: stored.xp, level: levelForXp(stored.xp) }, stored);
      const player = { playerId: to.id, displayName: to.displayName, level };
      let raised = await mergeGuestWeeks({ from, player, now });
      const { period, startsAt, expiresAt } = weekOf(now);
      // This week's XP from matches, for games from before guests had rows. It only ever raises the score, so it
      // never adds again what the guest's weekly row brought.
      const weekXp = await matchXpSince(to.id, startsAt);
      const totals = [
        { board: XP_BOARD, period: ALL, score: xp },
        { board: XP_BOARD, period, score: weekXp, expiresAt },
      ];
      for (const gameId of gamesWithWinsBoards()) {
        totals.push({
          board: winsBoard(gameId),
          period: ALL,
          score: await matchAccessor.countWins({ playerId: to.id, gameId }),
        });
      }
      for (const total of totals.filter(({ score }) => score > 0)) {
        raised += (await leaderboardAccessor.raiseScore({ ...player, ...total, at: now })).raised ? 1 : 0;
      }
      await leaderboardAccessor.removePlayer(from);
      return { moved: { leaderboardEntries: raised } };
    },

    /**
     * The player's rows on every board, for their data export (CC-035). The player id is left out.
     *
     * @param {{ playerId: string }} query
     */
    exportPlayer: async ({ playerId }) =>
      (await leaderboardAccessor.listForPlayer(playerId)).map(
        ({ board, period, displayName, level, score, updatedAt }) => ({
          board,
          period,
          displayName,
          level,
          score,
          updatedAt: new Date(updatedAt).toISOString(),
        }),
      ),

    /**
     * Takes the player off every board (CC-035). Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { leaderboardEntries: number } }>}
     */
    erasePlayer: async ({ playerId }) => ({
      erased: { leaderboardEntries: await leaderboardAccessor.removePlayer(playerId) },
    }),
  });
}
