import { MOVE_REJECTIONS } from "@classicade/shared";

/**
 * Engines report expected rule violations as values, not exceptions: an illegal move is normal play.
 *
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, reason: string, message: string }} Result
 */

/**
 * @template T
 * @param {T} value
 * @returns {{ ok: true, value: T }}
 */
export const ok = (value) => Object.freeze({ ok: true, value });

const REASONS = new Set(Object.values(MOVE_REJECTIONS));

/**
 * @param {string} reason   one of MOVE_REJECTIONS
 * @param {string} message  human-readable explanation, safe to show to players
 * @returns {{ ok: false, reason: string, message: string }}
 */
export function reject(reason, message) {
  if (!REASONS.has(reason)) {
    throw new TypeError(`Unknown rejection reason "${reason}"`);
  }
  return Object.freeze({ ok: false, reason, message });
}
