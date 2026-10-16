import { useEffect, useRef } from "react";
import { useSound } from "../hooks/useSound.js";
import { useTurnAlert } from "../hooks/useTurnAlert.js";
import { roomNotices, roomSounds } from "./roomUpdates.js";
import { isYourTurn } from "./roomView.js";

/**
 * Lets the player hear and see what changed in their room (CC-103, CC-104): each new RoomView is compared with the
 * one before, the sounds that change makes are played, and answers to requests ("Bob declined your draw offer")
 * are passed to `notify`. While it is the player's move and the tab is in the background, the tab title calls
 * them back.
 *
 * The first view after opening or reloading the page only becomes the starting point: a reload is not news.
 *
 * @param {any} room  the RoomView, undefined until joined
 * @param {{ notify: (message: string) => void }} options
 */
export function useRoomAlerts(room, { notify }) {
  const sound = useSound();
  const previous = useRef(undefined);
  // The latest callback, so a new function from the page on every render does not count as a room change.
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  useEffect(() => {
    const before = previous.current;
    previous.current = room;
    if (room === undefined || before === undefined || before === room) {
      return;
    }
    const sounds = roomSounds({ previous: before, next: room, hidden: document.hidden });
    if (sounds.length > 0) {
      sound.play(sounds);
    }
    roomNotices(before, room).forEach((message) => notifyRef.current(message));
  }, [room, sound]);

  useTurnAlert(room !== undefined && isYourTurn(room));
}
