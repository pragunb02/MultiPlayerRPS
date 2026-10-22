// The test browsers make no sound, so a browser test run on a laptop is silent (CC-344). The game sounds still
// play inside the page: the audio context starts, the notes are made and a test can still see that a sound was
// asked for (controlProbe.js). Only what reaches the speakers is silenced.

/** Chromium plays nothing through the speakers. */
export const CHROMIUM_MUTES_AUDIO = Object.freeze(["--mute-audio"]);

/** Firefox plays everything at volume 0. */
export const FIREFOX_MUTES_AUDIO = Object.freeze({ "media.volume_scale": "0.0" });

/**
 * WebKit has no switch to mute it, so this runs in every page before the app (`addInitScript`). Each audio
 * context's `destination` becomes a gain of 0 in front of the real speakers, so the app's sound graph is built and
 * runs as before and only its output is silent. It runs in the page, so it uses only what the page has.
 */
export function silenceWebAudio() {
  const Context = window.BaseAudioContext ?? window.AudioContext ?? window.webkitAudioContext;
  const speakers = Context && Object.getOwnPropertyDescriptor(Context.prototype, "destination")?.get;
  if (speakers === undefined) return;
  const silent = new WeakMap();
  Object.defineProperty(Context.prototype, "destination", {
    configurable: true,
    enumerable: true,
    get() {
      if (!silent.has(this)) {
        const gain = this.createGain();
        gain.gain.value = 0;
        gain.connect(speakers.call(this));
        silent.set(this, gain);
      }
      return silent.get(this);
    },
  });
}
