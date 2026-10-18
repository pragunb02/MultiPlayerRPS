import { useServerCountdown } from "../hooks/useServerCountdown.js";
import { roomRequests } from "./roomUpdates.js";
import { nameOf } from "./roomView.js";

const noop = () => undefined;

/**
 * Why the viewer cannot ask for `type` right now (CC-159), in their words, or "" when they can: their own request
 * waits for an answer, the opponent's request of the same kind waits for theirs, the game's limit is used up, or
 * the short pause after the last answer is still running. The pause ends by itself, and the reason with it.
 *
 * @param {any} room  RoomView
 * @param {string} type  a request type
 * @returns {string}
 */
export function useAskReason(room, type) {
  const left = useServerCountdown({
    until: room.askAgainAt?.[type] ?? 0,
    serverTime: room.serverTime,
    onElapsed: noop,
  });
  const open = roomRequests(room).find((request) => request.type === type);
  if (open?.from === room.you) return `Waiting for ${nameOf(room, open.to)} to answer`;
  if (open !== undefined) return `${nameOf(room, open.from)} asked first. Answer it above the board`;
  if (room.requestsLeft?.[type] === 0) return "You have used every offer this game allows";
  if (left > 0) return "You can ask again in a moment";
  return "";
}
