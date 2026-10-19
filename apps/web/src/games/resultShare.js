import { BOT_CHARACTERS, ROOM_END_REASONS } from "@classicade/shared";
import { paths } from "../app/paths.js";
import { outcomeFor } from "../components/Celebrations/outcome.js";
import { resultText, shareMessage, whatsappUrl, withFreeLine } from "../lib/shareText.js";
import { isAborted } from "./outcomeText.js";

/**
 * Two counts as a score such as "2-1", the viewer's first, but only when the viewer leads. A score next to "I won"
 * must back the claim: a player who won the last game but is level or behind ("1-1", "1-3") gets no score.
 */
function leadingScore(counts, you, opponentId) {
  const mine = counts[you] ?? 0;
  const theirs = counts[opponentId] ?? 0;
  return mine > theirs ? `${mine}-${theirs}` : "";
}

/**
 * The score to tell, as numbers only: the room's series once more than one game was played, otherwise the rounds
 * inside the game when it has several (a best of 3 of Rock Paper Scissors keeps `view.score` per player). Empty
 * when there is none, when the viewer does not lead, or when the opponent's seat is gone, because then the score
 * may count games against someone else.
 */
function scoreFor(room, opponent) {
  if (opponent === undefined) {
    return "";
  }
  const { series } = room;
  if (series !== undefined && series.games >= 2) {
    return leadingScore(series.wins, room.you, opponent.playerId);
  }
  const rounds = room.game.view?.score;
  const played = Object.values(rounds ?? {}).reduce((sum, count) => sum + count, 0);
  return played > 1 ? leadingScore(rounds, room.you, opponent.playerId) : "";
}

/**
 * What a finished room's result share may say, read from the RoomView (CC-217). It reads the outcome, the score as
 * numbers and a computer character from the catalogue, and nothing else: never a seat's name, a player id or the
 * room's code. So the text cannot carry a guest's, a minor's or anyone's name (ADR-028.7).
 *
 * @param {any} room  a finished RoomView
 * @returns {{ gameId: string, outcome: string, character: string, score: string, forfeit: boolean }}
 */
export function resultShareOf(room) {
  const seen = outcomeFor(room);
  const outcome = isAborted(room) || seen === "watched" ? "neutral" : seen;
  const opponent = room.seats.find((seat) => seat.playerId !== room.you);
  const character = BOT_CHARACTERS.find((entry) => entry.id === opponent?.bot?.character)?.name ?? "";
  const score = outcome === "win" ? scoreFor(room, opponent) : "";
  const forfeit = room.game.outcome.reason === ROOM_END_REASONS.FORFEIT;
  return { gameId: room.gameId, outcome, character, score, forfeit };
}

/**
 * The result share of a finished room: the text, the game page's link (a finished room closes soon, so the link
 * never names it), the whole message and WhatsApp's link for it.
 *
 * @param {any} room  a finished RoomView
 * @param {{ origin: string }} site  the site's own address (app/siteOrigin.js)
 * @returns {{ line: string, text: string, url: string, message: string, whatsapp: string }}
 *   line: the result alone. text: the result and the free line, for a share sheet that takes the link apart
 */
export function resultShare(room, { origin }) {
  const line = resultText(resultShareOf(room));
  const url = `${origin}${paths.game(room.gameId)}`;
  const message = shareMessage({ text: line, url });
  return { line, text: withFreeLine(line), url, message, whatsapp: whatsappUrl(message) };
}
