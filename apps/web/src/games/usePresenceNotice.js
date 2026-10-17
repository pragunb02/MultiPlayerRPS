import { useEffect, useEffectEvent, useRef, useState } from "react";
import { PRESENCE } from "@classicade/shared";
import { useSound } from "../hooks/useSound.js";
import { SOUNDS } from "../lib/sound/sounds.js";

/** A presence must hold this long before it is news: a reload goes offline, away and here within a moment. */
export const PRESENCE_SETTLE_MS = 1_000;

const SENTENCES = Object.freeze({
  [PRESENCE.HERE]: (name) => `${name} is back in the game`,
  [PRESENCE.AWAY]: (name) => `${name} is away from the game screen`,
  [PRESENCE.OFFLINE]: (name) => `${name} lost the connection`,
});

/** Each other player's presence, as [player id, presence] pairs. */
const presencesOf = (room) =>
  room.seats.filter((seat) => seat.playerId !== room.you).map((seat) => [seat.playerId, seat.presence]);

/**
 * What the viewer should hear about the other players coming and going (CC-158): "Bob is away from the game
 * screen", "Bob lost the connection", "Bob is back in the game". A change is told, with the soft presence sound,
 * once it has held for a second, so a reload does not read out three changes. The first view is the starting
 * point, not news.
 *
 * @param {any} room  the RoomView
 * @param {{ settleMs?: number }} [options]
 * @returns {string} the latest sentence, "" before anything changed
 */
export function usePresenceNotice(room, { settleMs = PRESENCE_SETTLE_MS } = {}) {
  const sound = useSound();
  const [notice, setNotice] = useState("");
  const told = useRef(undefined);
  const presences = presencesOf(room)
    .map((pair) => pair.join("="))
    .join(" ");

  const remember = useEffectEvent(() => {
    told.current = new Map(presencesOf(room));
  });

  const settle = useEffectEvent(() => {
    const changed = presencesOf(room).filter(([id, presence]) => told.current.get(id) !== presence);
    remember();
    const [id, presence] = changed.at(-1) ?? [];
    if (id === undefined || !Object.hasOwn(SENTENCES, presence)) return;
    setNotice(SENTENCES[presence](room.seats.find((seat) => seat.playerId === id).displayName));
    sound.play(SOUNDS.PRESENCE);
  });

  useEffect(() => {
    if (told.current === undefined) {
      remember();
      return undefined;
    }
    const timer = setTimeout(settle, settleMs);
    return () => clearTimeout(timer);
  }, [presences, settleMs]);

  return notice;
}
