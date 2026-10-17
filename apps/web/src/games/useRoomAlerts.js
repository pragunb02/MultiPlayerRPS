import { useEffect, useRef } from "react";
import { ROOM_STATUS } from "@classicade/shared";
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
 * The first view after opening or reloading the page only becomes the starting point: a reload is not news. When a
 * rematch starts, the messages about the last game's requests ("Bob declined the rematch") are taken away with
 * `dismiss`: they are over.
 *
 * @param {any} room  the RoomView, undefined until joined
 * @param {{ notify: (message: string) => number, dismiss: (id: number) => void }} options  `notify` returns an id
 *   that `dismiss` takes
 */
export function useRoomAlerts(room, { notify, dismiss }) {
  const sound = useSound();
  const previous = useRef(undefined);
  const shown = useRef([]);
  // The latest callbacks, so new functions from the page on every render do not count as a room change.
  const callbacks = useRef({ notify, dismiss });
  useEffect(() => {
    callbacks.current = { notify, dismiss };
  }, [notify, dismiss]);

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
    if (before.status === ROOM_STATUS.FINISHED && room.status === ROOM_STATUS.PLAYING) {
      shown.current.forEach((id) => callbacks.current.dismiss(id));
      shown.current = [];
    }
    roomNotices(before, room).forEach((message) => shown.current.push(callbacks.current.notify(message)));
  }, [room, sound]);

  useTurnAlert(room !== undefined && isYourTurn(room));
}
