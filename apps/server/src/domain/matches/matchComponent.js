import { renamePlayer } from "@classicade/games";
import { assertDefined } from "../../utils/assert.js";
import { NotFoundError } from "../../utils/errors.js";

/**
 * Match history: turns finished rooms into permanent match records and answers "what did I play?".
 *
 * @param {{ matchAccessor: ReturnType<typeof import("../../data/matchAccessor.js").createMatchAccessor> }} deps
 */
export function createMatchComponent({ matchAccessor }) {
  assertDefined(matchAccessor, "matchAccessor");

  const isPlayer = (match, playerId) => match.players.some((p) => p.playerId === playerId);

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
     * A player's history, newest first.
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
      }));
    },

    /**
     * The full record (including the move log for replays) — for participants only. Others get
     * "not found", so match ids cannot be probed.
     *
     * @param {{ matchId: string, playerId: string }} query
     */
    async getForPlayer({ matchId, playerId }) {
      const match = await matchAccessor.getById(matchId);
      if (!isPlayer(match, playerId)) {
        throw new NotFoundError("Match not found");
      }
      return { ...match, outcomeForYou: outcomeFor(match, playerId) };
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
        renamedNow.push(await matchAccessor.replaceRenamed({ from, match: { ...renamed, players } }));
      }
      return { moved: { matches: renamedNow.filter(Boolean).length } };
    },
  });
}
