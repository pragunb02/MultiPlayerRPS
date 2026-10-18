import { categoryOf, SOUND_CATEGORIES } from "../notify/categories.js";
import { RECIPES, SOUNDS } from "./sounds.js";

/** Loudness of everything at full volume. The slider is squared first, because ears hear loudness that way. */
const MASTER_GAIN = 0.8;
/** Sounds asked for together play one after another, this many seconds apart, instead of on top of each other. */
const STAGGER_S = 0.12;
/** A note fades in over 5 ms and out to near silence, because starting or stopping at full level would click. */
const ATTACK_S = 0.005;
const SILENT = 0.0001;
/** The events browsers count as a user gesture that may start audio. */
const GESTURES = Object.freeze(["pointerdown", "pointerup", "keydown", "touchend", "click"]);
/** Elements marked like this make the subtle click sound when pressed (the Button component sets it). */
export const CLICK_SOUND_SELECTOR = "[data-sound='click']";

/**
 * Plays the app's synthesised sounds with the Web Audio API (CC-103), and owns the sound settings.
 *
 * Browsers refuse to start audio before the person has interacted with the page, and Chrome warns in the console
 * when a page even tries. So the audio context is created only during a user gesture (`unlock`, wired to the
 * page by `listen`), and until then `play` quietly does nothing. Audio must never break the game: a browser
 * without Web Audio, a context that fails, or a node that refuses a value all end in silence, never an error.
 *
 * @param {{
 *   createContext: () => AudioContext,
 *   hasUserActivation: () => boolean,
 *   preferences: ReturnType<typeof import("./soundPreferences.js").createSoundPreferences>,
 *   recipes?: typeof RECIPES,
 *   now?: () => number,
 * }} deps  `hasUserActivation` says whether the page is inside a user gesture right now. `now` is the clock of
 *   each category's rate limit (CC-208)
 */
export function createSoundPlayer({
  createContext,
  hasUserActivation,
  preferences,
  recipes = RECIPES,
  now = Date.now,
}) {
  let settings = preferences.load();
  // When each category last made a sound, for its rate limit.
  const lastPlayed = new Map();
  let context;
  let master;
  let broken = false;
  const listeners = new Set();

  const level = () => (settings.muted ? 0 : settings.volume ** 2 * MASTER_GAIN);

  function update(next) {
    settings = Object.freeze(next);
    preferences.save(settings);
    if (master !== undefined) {
      master.gain.value = level();
    }
    listeners.forEach((listener) => listener());
  }

  /**
   * How loud one sound plays next to the main volume (CC-208): its category's volume, 0 when its category is off
   * or played too recently, and 1 for a sound without a category (the click of a button).
   */
  function loudnessOf(name, at) {
    const id = SOUND_CATEGORIES[name];
    if (id === undefined) return 1;
    const setting = settings.categories[id];
    const last = lastPlayed.get(id);
    if (!setting.on || (last !== undefined && last !== at && at - last < categoryOf(id).minGapMs)) return 0;
    return setting.volume;
  }

  function voice(note, at, loudness) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const end = at + note.dur;
    oscillator.type = note.wave;
    oscillator.frequency.setValueAtTime(note.freq, at);
    if (note.to !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(note.to, end);
    }
    gain.gain.setValueAtTime(SILENT, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(SILENT, note.gain * loudness), at + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(SILENT, end);
    oscillator.connect(gain);
    gain.connect(master);
    // Finished notes are unplugged so a long game does not pile up audio nodes.
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(end + 0.02);
  }

  const player = {
    /** @returns {import("./soundPreferences.js").SoundSettings} the same object until something changes */
    settings: () => settings,

    /** @param {() => void} listener  @returns {() => void} unsubscribe */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** @param {boolean} muted */
    setMuted(muted) {
      if (typeof muted !== "boolean") {
        throw new TypeError("muted must be true or false");
      }
      update({ ...settings, muted });
    },

    /** @param {number} volume  0 (silent) to 1 (loudest) */
    setVolume(volume) {
      if (typeof volume !== "number" || !(volume >= 0 && volume <= 1)) {
        throw new RangeError("volume must be a number from 0 to 1");
      }
      update({ ...settings, volume });
    },

    /**
     * Turns one kind of notice's sound on or off, or sets its volume (CC-208).
     *
     * @param {string} id  a category id (CATEGORIES)
     * @param {{ on?: boolean, volume?: number }} change
     */
    setCategory(id, change) {
      const current = settings.categories[categoryOf(id).id];
      const next = { ...current, ...change };
      if (typeof next.on !== "boolean") {
        throw new TypeError("on must be true or false");
      }
      if (typeof next.volume !== "number" || !(next.volume >= 0 && next.volume <= 1)) {
        throw new RangeError("volume must be a number from 0 to 1");
      }
      update({ ...settings, categories: { ...settings.categories, [id]: Object.freeze(next) } });
    },

    /** Starts audio if the page is inside a user gesture. Safe to call any number of times. */
    unlock() {
      if (broken || !hasUserActivation()) {
        return;
      }
      try {
        if (context === undefined) {
          context = createContext();
          master = context.createGain();
          master.gain.value = level();
          master.connect(context.destination);
        }
        if (context.state === "suspended") {
          // A refused resume just means silence until the next gesture tries again.
          context.resume().catch(() => undefined);
        }
      } catch {
        broken = true;
        context = undefined;
      }
    },

    /**
     * Plays one sound, or several one after another.
     *
     * @param {string | ReadonlyArray<string>} names  ids from SOUNDS
     * @returns {boolean} whether anything was played
     * @throws {Error} for a name that is not a known sound (a programming mistake, not a runtime condition)
     */
    play(names) {
      const list = typeof names === "string" ? [names] : names;
      const unknown = list.find((name) => !Object.hasOwn(recipes, name));
      if (unknown !== undefined) {
        throw new Error(`Unknown sound: ${unknown}`);
      }
      if (list.length === 0 || level() === 0 || context?.state !== "running") {
        return false;
      }
      const at = now();
      const audible = list
        .map((name) => ({ name, loudness: loudnessOf(name, at) }))
        .filter(({ loudness }) => loudness > 0);
      if (audible.length === 0) {
        return false;
      }
      audible.forEach(({ name }) => {
        const id = SOUND_CATEGORIES[name];
        if (id !== undefined) lastPlayed.set(id, at);
      });
      try {
        const start = context.currentTime + 0.01;
        audible.forEach(({ name, loudness }, index) =>
          recipes[name].forEach((note) => voice(note, start + index * STAGGER_S + note.at, loudness)),
        );
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Wires the player to the page: the first gesture unlocks audio, and pressing a button marked with
     * CLICK_SOUND_SELECTOR plays the click sound.
     *
     * @param {Pick<EventTarget, "addEventListener" | "removeEventListener">} target  usually `window`
     * @returns {() => void} undo
     */
    listen(target) {
      const onGesture = (event) => {
        player.unlock();
        if (
          event.type === "click" &&
          event.target instanceof Element &&
          event.target.closest(CLICK_SOUND_SELECTOR)
        ) {
          player.play(SOUNDS.CLICK);
        }
      };
      GESTURES.forEach((type) => target.addEventListener(type, onGesture, true));
      return () => GESTURES.forEach((type) => target.removeEventListener(type, onGesture, true));
    },
  };

  return Object.freeze(player);
}
