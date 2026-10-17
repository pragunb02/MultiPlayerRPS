import { renamePlayer } from "@classicade/games";
import { XP_AWARDS } from "@classicade/shared";
import { isBotPlayerId } from "../../models/botIdentity.js";
import { assertDefined } from "../../utils/assert.js";
import { NotFoundError } from "../../utils/errors.js";
import { resultFor } from "../progression/progressionComponent.js";
import {
  botXpFor,
  creditFor,
  endedTooSoon,
  hasComputerPlayer,
  judgeMatch,
  limitWindowOf,
} from "./fairPlay.js";

/**
 * Match history: turns finished rooms into permanent match records and answers "what did I play?". Also judges
 * once whether each match counts for its players (CC-095, rules in `fairPlay.js`).
 *
 * @param {{ matchAccessor: ReturnType<typeof import("../../data/matchAccessor.js").createMatchAccessor> }} deps
 */
export function createMatchComponent({ matchAccessor }) {
  assertDefined(matchAccessor, "matchAccessor");

  const isPlayer = (match, playerId) => match.players.some((p) => p.playerId === playerId);

  /** The player's other games the limits look at, as stored now. */
  const othersFor = (match, playerId) =>
    // A game that ended too soon counts for nobody, whatever else they played.
    endedTooSoon(match)
      ? []
      : matchAccessor.listCountedBetween({
          playerId,
          ...limitWindowOf(match.endedAt),
          excluding: match.matchId,
        });

  /** How a match counts for one player, against their other games as stored now. */
  const verdictFor = async (match, playerId) =>
    judgeMatch({ match, playerId, others: await othersFor(match, playerId) });

  /**
   * A guest's game, now the account's: it keeps its verdict, except that a game which counted for the guest stops
   * counting when the account's own games of that day already reached a limit. It then names the guest, so
   * progression can take back what the guest earned from it.
   */
  async function creditAfterMove({ match, from, to }) {
    if (match.credit === undefined || !creditFor(match, to).counted) {
      return match;
    }
    const verdict = await verdictFor(match, to);
    if (verdict.counted) {
      return match;
    }
    const withdrawn = { playerId: to, reason: verdict.reason, withdrawnFrom: from };
    return { ...match, credit: { ...match.credit, notCounted: [...match.credit.notCounted, withdrawn] } };
  }

  /** How the match went for one player. */
  function outcomeFor(match, playerId) {
    if (match.result.result === "draw") {
      return "draw";
    }
    return match.result.winners.includes(playerId) ? "win" : "loss";
  }

  return Object.freeze({
    /**
     * Records the match a room just finished (subscribed to `room.gameFinished`).
     *
     * @param {{ room: Readonly<import("../../data/roomAccessor.js").Room>, outcome: { result: string, winners: string[], reason: string } }} event
     */
    recordFinished({ room, outcome }) {
      return matchAccessor.record({
        matchId: room.game.matchId,
        roomCode: room.code,
        gameId: room.gameId,
        options: room.options,
        seed: room.game.seed,
        players: room.seats.map(({ playerId, displayName }) => ({ playerId, displayName })),
        log: room.game.log,
        result: { result: outcome.result, winners: outcome.winners, reason: outcome.reason },
        startedAt: room.game.startedAt,
        endedAt: room.lastActivityAt,
      });
    },

    /**
     * Decides once whether a recorded match counts for each of its players, and stores it with the match.
     * Progression, quests, achievements and leaderboards then read that verdict. Judging again returns the
     * first verdict. A computer character is never judged: it earns nothing. In a game against one, each person
     * it counts for also gets the XP it gives them within the day's limit for such games (ADR-025).
     *
     * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
     * @returns {Promise<Readonly<import("../../data/matchAccessor.js").Match>>} the match with its verdict
     */
    async judge(match) {
      if (match.credit !== undefined) {
        return match;
      }
      const notCounted = [];
      const botXp = [];
      for (const { playerId } of match.players.filter((p) => !isBotPlayerId(p.playerId))) {
        const others = await othersFor(match, playerId);
        const verdict = judgeMatch({ match, playerId, others });
        if (!verdict.counted) {
          notCounted.push({ playerId, reason: verdict.reason });
        } else if (hasComputerPlayer(match)) {
          const award = XP_AWARDS[resultFor(match, playerId)];
          botXp.push({ playerId, ...botXpFor({ match, playerId, others, award }) });
        }
      }
      const credit = { notCounted, ...(botXp.length > 0 && { botXp }) };
      return matchAccessor.judgeOnce({ matchId: match.matchId, credit });
    },

    /**
     * A player's history, newest first. `countsForYou` says whether the game counted for this player, and why
     * not (CC-095).
     *
     * @param {{ playerId: string, limit: number, before?: number }} query
     */
    async listForPlayer({ playerId, limit, before }) {
      const matches = await matchAccessor.listForPlayer(playerId, { limit, before });
      return matches.map((match) => ({
        matchId: match.matchId,
        gameId: match.gameId,
        players: match.players,
        result: match.result,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
        outcomeForYou: outcomeFor(match, playerId),
        countsForYou: creditFor(match, playerId),
      }));
    },

    /**
     * The full record (including the move log for replays) — for participants only. Others get
     * "not found", so match ids cannot be probed. How it counted is told for the viewer only: the other
     * players' limits are theirs.
     *
     * @param {{ matchId: string, playerId: string }} query
     */
    async getForPlayer({ matchId, playerId }) {
      const { credit, ...match } = await matchAccessor.getById(matchId);
      if (!isPlayer(match, playerId)) {
        throw new NotFoundError("Match not found");
      }
      return {
        ...match,
        outcomeForYou: outcomeFor(match, playerId),
        countsForYou: creditFor({ ...match, credit }, playerId),
      };
    },

    /**
     * The full record, for the server's own pipeline (never for a client: see `getForPlayer`).
     *
     * @param {string} matchId
     */
    getById(matchId) {
      return matchAccessor.getById(matchId);
    },

    /**
     * A guest's match history becomes their account's (CC-032): every match the guest played is rewritten with
     * the account's id and name (seats, moves, winners), so history, details and replays work as before. A match
     * the guest played against that same account stays as it is — one player can't hold both seats.
     * The fair play limits apply to the account's day as a whole (CC-095): oldest first, each game the guest
     * moves in counts only while the account stays within them.
     * Idempotent: a match is only rewritten while the guest is still in it.
     *
     * @param {{ from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number }} transfer
     * @returns {Promise<{ moved: { matches: number } }>}
     */
    async transferPlayer({ from, to }) {
      const matches = await matchAccessor.listExcluding(from, { excluding: to.id });
      const renamedNow = [];
      for (const match of matches) {
        const renamed = renamePlayer(match, from, to.id);
        const players = renamed.players.map((p) =>
          p.playerId === to.id ? { ...p, displayName: to.displayName } : p,
        );
        const moved = await creditAfterMove({ match: { ...renamed, players }, from, to: to.id });
        renamedNow.push(await matchAccessor.replaceRenamed({ from, match: moved }));
      }
      return { moved: { matches: renamedNow.filter(Boolean).length } };
    },
  });
}
