import { QUEST_SLOTS, QUESTS } from "@classicade/shared";

/**
 * FNV-1a, 32 bit: a small, stable string hash (the same everywhere, forever — stored quests depend on it).
 *
 * @param {string} text
 * @returns {number} unsigned 32-bit integer
 */
export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * One mulberry32 step: the next 32-bit state from the current one.
 *
 * @param {number} seed
 * @returns {number} unsigned 32-bit integer
 */
export function mulberry32Step(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

const SLOT_ORDER = Object.freeze([QUEST_SLOTS.PLAY, QUEST_SLOTS.WIN, QUEST_SLOTS.GAME]);

/**
 * A player's quests for one UTC day: one per slot (play, win, game), chosen deterministically from the player id
 * and the day — so every server picks the same set without coordination. Once stored, the day's snapshot is the
 * truth (a catalog change mid-day never reshuffles anyone's quests).
 *
 * @param {{ playerId: string, day: string, catalog?: ReadonlyArray<Readonly<import("@classicade/shared/src/quests.js").QuestInfo>> }} input
 * @returns {ReadonlyArray<Readonly<import("@classicade/shared/src/quests.js").QuestInfo>>}
 */
export function questsFor({ playerId, day, catalog = QUESTS }) {
  let seed = fnv1a32(`${playerId}:${day}`);
  const chosen = [];
  for (const slot of SLOT_ORDER) {
    const pool = catalog.filter((quest) => quest.slot === slot);
    chosen.push(pool[seed % pool.length]);
    seed = mulberry32Step(seed);
  }
  return Object.freeze(chosen);
}
