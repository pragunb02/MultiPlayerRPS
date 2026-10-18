import { randomUUID } from "node:crypto";
import { renamePlayer } from "@classicade/games";
import { XP_AWARDS } from "@classicade/shared";
import { isBotPlayerId } from "../../models/botIdentity.js";
import { deletedPlayer, earnsNothing } from "../../models/deletedPlayer.js";
import { anonymisedMatch } from "./anonymise.js";
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

// How many matches one read of a player's history takes.
const HISTORY_PAGE = 100;

/**
 * Match history: turns finished rooms into permanent match records and answers "what did I play?". Also judges
 * once whether each match counts for its players (CC-095, rules in `fairPlay.js`).
 *
 * @param {{
 *   matchAccessor: ReturnType<typeof import("../../data/matchAccessor.js").createMatchAccessor>,
 *   newUuid?: () => string,   a fresh random id for each deleted player's stand-in (CC-035). Tests pick them
 * }} deps
 */
export function createMatchComponent({ matchAccessor, newUuid = randomUUID }) {
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

  /**
   * A guest's game, now the account's: it keeps its verdict, except that a game which counted for the guest stops
   * counting when the account's own games of that day already reached a limit. It then names the guest, so
   * progression can take back what the guest earned from it. A game against a computer character that still counts
   * may give less, see `capBotXp`.
   */
  async function creditAfterMove({ match, from, to }) {
    if (match.credit === undefined || !creditFor(match, to).counted) {
      return match;
    }
    const others = await othersFor(match, to);
    const verdict = judgeMatch({ match, playerId: to, others });
    if (!verdict.counted) {
      const withdrawn = { playerId: to, reason: verdict.reason, withdrawnFrom: from };
      return { ...match, credit: { ...match.credit, notCounted: [...match.credit.notCounted, withdrawn] } };
    }
    return match.credit.botXp === undefined ? match : capBotXp({ match, from, to, others });
  }

  /**
   * A guest's game against a computer character, now the account's, gives only what the account has left of the
   * day's limit for such games (ADR-025). Without this a player could earn the limit again as each new guest. The
   * part taken away names the guest, so progression can take it out of what the guest earned.
   */
  function capBotXp({ match, from, to, others }) {
    const moved = match.credit.botXp.find((entry) => entry.playerId === to);
    const { xp, left } = botXpFor({ match, playerId: to, others, award: moved.xp });
    if (xp === moved.xp) {
      return match;
    }
    const capped = { playerId: to, xp, left, withdrawnFrom: from, withdrawnXp: moved.xp - xp };
    const botXp = match.credit.botXp.map((entry) => (entry === moved ? capped : entry));
    return { ...match, credit: { ...match.credit, botXp } };
  }

  /**
   * The players as history shows them. A computer character is labelled as one, so it never reads as a person
   * with the same name (ADR-025).
   */
  const labelled = (players) =>
    players.map((player) => (isBotPlayerId(player.playerId) ? { ...player, computer: true } : player));

  /**
   * The match a finished room holds, as it is recorded: players, seed, moves, result and times, never the
   * engine's state. Nothing is stored here, so the match pipeline can keep it until it is recorded (CC-111).
   *
   * @param {{ room: Readonly<import("../../data/roomAccessor.js").Room>, outcome: { result: string, winners: string[], reason: string } }} event
   * @returns {Readonly<import("../../data/matchAccessor.js").Match>}
   */
  function finishedMatch({ room, outcome }) {
    return Object.freeze({
      matchId: room.game.matchId,
      roomCode: room.code,
      gameId: room.gameId,
      options: room.options,
      seed: room.game.seed,
      players: room.seats.map(({ playerId, displayName }) => ({ playerId, displayName })),
      log: room.game.log,
      result: { result: outcome.result, winners: outcome.winners, reason: outcome.reason },
      startedAt: room.game.startedAt,
      // When the game finished. The room's last activity moves on with rematch requests and leaving.
      endedAt: room.finishedAt,
    });
  }

  /** How the match went for one player. */
  function outcomeFor(match, playerId) {
    if (match.result.result === "draw") {
      return "draw";
    }
    return match.result.winners.includes(playerId) ? "win" : "loss";
  }

  /** Every match of a player, newest first, a page at a time. */
  async function allMatchesOf(playerId) {
    const matches = [];
    let after;
    for (;;) {
      // On the end time and the id, so matches that ended at the same moment are never lost at a page edge.
      const page = await matchAccessor.listPageForPlayer(playerId, { limit: HISTORY_PAGE, after });
      matches.push(...page);
      if (page.length < HISTORY_PAGE) {
        return matches;
      }
      after = { endedAt: page.at(-1).endedAt, matchId: page.at(-1).matchId };
    }
  }

  /**
   * One match as the player's export shows it: the player is "you", everyone else is "player-2", "player-3" in
   * seat order with their display name, and no player id appears, so the export carries nobody else's id.
   */
  function exported(match, playerId) {
    const labels = new Map(
      match.players.map((p, index) => [p.playerId, p.playerId === playerId ? "you" : `player-${index + 1}`]),
    );
    const label = (id) => labels.get(id);
    return {
      matchId: match.matchId,
      gameId: match.gameId,
      options: match.options,
      startedAt: new Date(match.startedAt).toISOString(),
      endedAt: new Date(match.endedAt).toISOString(),
      players: match.players.map((p) => ({
        player: label(p.playerId),
        displayName: p.displayName,
        ...(isBotPlayerId(p.playerId) && { computer: true }),
      })),
      result: { ...match.result, winners: match.result.winners.map(label) },
      log: match.log.map(({ playerId: id, at, ...entry }) => ({
        ...entry,
        ...(id !== undefined && { player: label(id) }),
        at: new Date(at).toISOString(),
      })),
    };
  }

  /** Whether another person played in the match, so it stays in their history when this player is deleted. */
  const sharedWithAnotherPerson = (match, playerId) =>
    match.players.some((p) => p.playerId !== playerId && !earnsNothing(p.playerId));

  return Object.freeze({
    finishedMatch,

    /**
     * Records a match. Recording the same match again returns the stored one.
     *
     * @param {Readonly<import("../../data/matchAccessor.js").Match>} match  from `finishedMatch`
     */
    record: (match) => matchAccessor.record(match),

    /**
     * Records the match a room just finished.
     *
     * @param {{ room: Readonly<import("../../data/roomAccessor.js").Room>, outcome: { result: string, winners: string[], reason: string } }} event
     */
    recordFinished: (event) => matchAccessor.record(finishedMatch(event)),

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
      for (const { playerId } of match.players.filter((p) => !earnsNothing(p.playerId))) {
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
     * not (CC-095). A computer character among the players has `computer: true`.
     *
     * @param {{ playerId: string, limit: number, before?: number }} query
     */
    async listForPlayer({ playerId, limit, before }) {
      const matches = await matchAccessor.listForPlayer(playerId, { limit, before });
      return matches.map((match) => ({
        matchId: match.matchId,
        gameId: match.gameId,
        players: labelled(match.players),
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
        players: labelled(match.players),
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

    /**
     * Every match of the player, for their data export (CC-035). Other players appear by display name only.
     *
     * @param {{ playerId: string }} query
     */
    exportPlayer: async ({ playerId }) =>
      (await allMatchesOf(playerId)).map((match) => exported(match, playerId)),

    /**
     * Removes the player from match history (CC-035). A match another person played stays in their history: the
     * player's id is replaced by a new random stand-in for each match, named "Deleted player". A match nobody else
     * played (against computer characters only) is deleted. Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { matchesAnonymised: number, matchesDeleted: number } }>}
     */
    async erasePlayer({ playerId }) {
      const erased = { matchesAnonymised: 0, matchesDeleted: 0 };
      // Every match handled leaves the list, so the first page is read until it is empty.
      for (;;) {
        const page = await matchAccessor.listForPlayer(playerId, { limit: HISTORY_PAGE });
        if (page.length === 0) {
          return { erased };
        }
        for (const match of page) {
          if (!sharedWithAnotherPerson(match, playerId)) {
            erased.matchesDeleted += Number(
              await matchAccessor.deleteForPlayer({ matchId: match.matchId, playerId }),
            );
            continue;
          }
          const stand = deletedPlayer(newUuid());
          erased.matchesAnonymised += Number(
            await matchAccessor.replaceRenamed({
              from: playerId,
              match: anonymisedMatch(match, { playerId, stand }),
            }),
          );
        }
      }
    },
  });
}
