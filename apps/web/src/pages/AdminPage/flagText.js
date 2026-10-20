import { FLAG_AUDIENCES, FLAG_ROLLOUT } from "@classicade/shared";

/** Who a flag is for, in words (CC-312). */
export const AUDIENCE_TEXT = Object.freeze({
  [FLAG_AUDIENCES.EVERYONE]: "Everyone",
  [FLAG_AUDIENCES.SIGNED_IN]: "Players with an account",
  [FLAG_AUDIENCES.ADULTS]: "Adults with an account",
  [FLAG_AUDIENCES.ADMINS]: "Console admins only",
});

/**
 * A rollout in words: off, on, or a share of the audience (CC-312).
 *
 * @param {"off" | "on" | number} rollout
 * @returns {string}
 */
export function rolloutText(rollout) {
  if (rollout === FLAG_ROLLOUT.OFF) return "Off";
  if (rollout === FLAG_ROLLOUT.ON) return "On";
  return `${rollout}% of the audience`;
}
