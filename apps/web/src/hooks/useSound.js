import { useEffect, useRef, useSyncExternalStore } from "react";
import { useServices } from "../app/servicesContext.js";
import { SOUNDS } from "../lib/sound/sounds.js";

/**
 * The sound player (CC-103), injected like the API and socket clients so tests can listen to what would play.
 *
 * @returns {ReturnType<typeof import("../lib/sound/soundPlayer.js").createSoundPlayer>}
 */
export function useSound() {
  return useServices().sound;
}

/** Whether sound is on and how loud, following every change (another control, another component). */
export function useSoundSettings() {
  const sound = useSound();
  return useSyncExternalStore(sound.subscribe, sound.settings);
}

const LOW_TIME_MS = 10_000;

/**
 * The chess clock's warning (CC-103): while your own clock runs under ten seconds, a tiny tick plays once for
 * every second that passes, like a real clock. It stops when your clock stops (you moved) or runs out.
 *
 * @param {number} msLeft  your remaining time, as displayed
 * @param {boolean} running  whether your clock is the one running
 */
export function useLowTimeTick(msLeft, running) {
  const sound = useSound();
  const lastSecond = useRef(0);
  const second = running && msLeft > 0 && msLeft < LOW_TIME_MS ? Math.ceil(msLeft / 1000) : 0;

  useEffect(() => {
    if (second !== 0 && second !== lastSecond.current) {
      sound.play(SOUNDS.LOW_TIME);
    }
    lastSecond.current = second;
  }, [second, sound]);
}
