import { GAME_STATUS } from "@classicade/shared";
import { nameOf } from "../roomView.js";

/**
 * One line of the "for whom" confirmation on one phone (CC-223): the choice and how the game would then end, such as
 * "Resign for Asha: Ben wins." A move that ends in a draw says so, and one after which the game goes on says only
 * the choice.
 *
 * @param {{ room: any, label: string, outcome: { status: string, result?: string, winners?: string[] } }} input
 *   `label` is the choice, such as "Resign for Asha". `outcome` is how the game would stand after it
 * @returns {string}
 */
export function forWhomLine({ room, label, outcome }) {
  if (outcome.status !== GAME_STATUS.FINISHED) return `${label}.`;
  if (outcome.result === "draw") return `${label}: a draw.`;
  return `${label}: ${nameOf(room, outcome.winners[0])} wins.`;
}
