import {
  getLeaderboard,
  LEADERBOARD_UNLISTED,
  LEADERBOARDS,
  levelForXp,
  XP_AWARDS,
} from "@classicade/shared";
import { isAccountId } from "../../models/identity.js";
import { assertDefined } from "../../utils/assert.js";
import { NotFoundError } from "../../utils/errors.js";
import { creditFor, hasComputerPlayer } from "../matches/fairPlay.js";
import { resultFor } from "../progression/progressionComponent.js";
import { gamesWithWinsBoards, hasWinsBoard, storageFor, weekOf, winsBoard, XP_BOARD } from "./boards.js";

const ALL = "all";
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

/**
 * Leaderboards (CC-053): overall XP, XP this ISO week, and wins per game — for accounts only; guests are never
 * stored or listed. Scores follow recorded matches and progression; every write is idempotent (totals only ever
 * rise, weekly additions are keyed by match or quest), so a match applied twice changes nothing.
 *
 * @param {{
 *   leaderboardAccessor: ReturnType<typeof import("../../data/leaderboardAccessor.js").createLeaderboardAccessor>,
 *   matchAccessor: Pick<ReturnType<typeof import("../../data/matchAccessor.js").createMatchAccessor>, "countWins" | "listForPlayer">,
 *   progressAccessor: Pick<ReturnType<typeof import("../../data/progressAccessor.js").createProgressAccessor>, "get">,
 * }} deps
 */
export function createLeaderboardComponent({ leaderboardAccessor, matchAccessor, progressAccessor }) {
  assertDefined(leaderboardAccessor, "leaderboardAccessor");
  assertDefined(matchAccessor, "matchAccessor");
  assertDefined(progressAccessor, "progressAccessor");

  /** @param {string} boardId */
  function requireBoard(boardId) {
    const info = getLeaderboard(boardId);
    if (info === undefined) {
      throw new NotFoundError("No such leaderboard");
    }
    return info;
  }

  const raiseWins = async ({ player, gameId, at }) => {
    const wins = await matchAccessor.countWins({ playerId: player.playerId, gameId });
    if (wins > 0) {
      await leaderboardAccessor.raiseScore({
        ...player,
        board: winsBoard(gameId),
        period: ALL,
        score: wins,
        at,
      });
    }
  };

  /** Overall XP follows the player's total; this week's XP adds what was earned, once per key. */
  const addXp = async ({ player, xp, gained, key, at }) => {
    if (xp > 0) {
      await leaderboardAccessor.raiseScore({ ...player, board: XP_BOARD, period: ALL, score: xp, at });
    }
    if (gained > 0) {
      const { period, expiresAt } = weekOf(at);
      await leaderboardAccessor.addOnce({
        ...player,
        board: XP_BOARD,
        period,
        key,
        inc: gained,
        at,
        expiresAt,
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

  return Object.freeze({
    /** The public catalog of boards. */
    listBoards: () => LEADERBOARDS.map(({ id, name, metric, period }) => ({ id, name, metric, period })),

    /**
     * One board's current period, best first. Entries carry public fields only — never player ids.
     *
     * @param {{ boardId: string, limit: number, now: number }} query
     * @throws {NotFoundError} for an unknown board
     */
    async getBoard({ boardId, limit, now }) {
      const info = requireBoard(boardId);
      const { board, period, resetsAt } = storageFor(info, now);
      const top = await leaderboardAccessor.listTop({ board, period, limit });
      return {
        board: {
          id: info.id,
          name: info.name,
          metric: info.metric,
          period: info.period,
          periodId: period,
          ...(resetsAt !== undefined && { resetsAt }),
        },
        entries: top.map(({ displayName, level, score }, index) => ({
          rank: index + 1,
          displayName,
          level,
          score,
        })),
      };
    },

    /**
     * Where the viewer stands on a board — also outside the listed top entries. Guests are never ranked.
     *
     * @param {{ boardId: string, viewer: import("../../models/identity.js").Identity, now: number }} query
     * @returns {Promise<{ listed: true, rank: number, score: number } | { listed: false, reason: string }>}
     * @throws {NotFoundError} for an unknown board
     */
    async standingFor({ boardId, viewer, now }) {
      const { board, period } = storageFor(requireBoard(boardId), now);
      if (!isAccountId(viewer.id)) {
        return { listed: false, reason: LEADERBOARD_UNLISTED.GUEST };
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
     * Pipeline step after progression: the accounts of a recorded match move up the boards. A match that doesn't
     * count for an account (CC-095) moves it nowhere. Everything is read from the stored match and progress, not
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
      const listed = match.players.filter(
        ({ playerId }) => isAccountId(playerId) && creditFor(match, playerId).counted,
      );
      for (const { playerId, displayName } of listed) {
        const result = resultFor(match, playerId);
        // Progression already added this match, and any quest bonus it earned (CC-089), to the stored total.
        const stored = await progressAccessor.get(playerId);
        const latest = rankedEntry({ xp: stored.xp, level: levelForXp(stored.xp) }, stored);
        const player = { playerId, displayName, level: latest.level };
        const at = match.endedAt;
        await addXp({ player, xp: latest.xp, gained: XP_AWARDS[result], key: match.matchId, at });
        if (result === "win" && hasWinsBoard(match.gameId)) {
          await raiseWins({ player, gameId: match.gameId, at });
        }
      }
    },

    /**
     * Bonus XP outside matches (daily quests): counts for the overall and this week's boards, unless a game against
     * a computer character earned it (`ranked` is false, ADR-025).
     *
     * @param {{ playerId: string, displayName: string, key: string, xpGained: number, ranked: boolean, progress: { xp: number, level: number }, at: number }} bonus
     */
    async applyBonus({ playerId, displayName, key, xpGained, ranked, progress, at }) {
      if (!isAccountId(playerId) || !ranked) {
        return;
      }
      const latest = rankedEntry(progress, await progressAccessor.get(playerId));
      const player = { playerId, displayName, level: latest.level };
      await addXp({ player, xp: latest.xp, gained: xpGained, key, at });
    },

    /**
     * A guest's data moved to an account (ADR-014 participant). Guests are never on a board, so there is nothing to
     * move: the account's entries are recomputed from its (already moved) progress and match history. Idempotent.
     *
     * @param {{ from: string, to: import("../../models/identity.js").Identity, now: number }} input
     * @returns {Promise<{ moved: Record<string, number> }>}  `leaderboardEntries`: account entries that rose
     */
    async transferPlayer({ to, now }) {
      const stored = await progressAccessor.get(to.id);
      const { xp, level } = rankedEntry({ xp: stored.xp, level: levelForXp(stored.xp) }, stored);
      const player = { playerId: to.id, displayName: to.displayName, level };
      const { period, startsAt, expiresAt } = weekOf(now);
      // This week's XP from matches; quest XP already on the weekly entry is kept (scores only rise).
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
      let raised = 0;
      for (const total of totals.filter(({ score }) => score > 0)) {
        raised += (await leaderboardAccessor.raiseScore({ ...player, ...total, at: now })).raised ? 1 : 0;
      }
      return { moved: { leaderboardEntries: raised } };
    },
  });
}
