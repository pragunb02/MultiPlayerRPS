/**
 * The only thing the app keeps in web storage (CC-103): whether sound is on and how loud. It is a preference of
 * this browser, not of the player, so it lives in localStorage and survives reloads and signing in or out. The
 * browser tests allow exactly this key and this shape (e2e/fixtures.js).
 */
export const SOUND_STORAGE_KEY = "cc.sound";

/** Sound is on at a moderate volume until the player says otherwise. */
export const DEFAULT_SOUND_SETTINGS = Object.freeze({ muted: false, volume: 0.6 });

/** @typedef {Readonly<{ muted: boolean, volume: number }>} SoundSettings */

const isSettings = (value) =>
  value !== null &&
  typeof value === "object" &&
  Object.keys(value).length === 2 &&
  typeof value.muted === "boolean" &&
  typeof value.volume === "number" &&
  value.volume >= 0 &&
  value.volume <= 1;

/**
 * Reads and writes the sound settings. `getStorage` is a function because merely touching `window.localStorage`
 * throws in some browsers when storage is blocked. Storage that is blocked, full, or holds something unreadable
 * never breaks the app: reading falls back to the defaults (the documented contract for a missing preference) and
 * a failed write keeps the choice for this visit only.
 *
 * @param {{ getStorage: () => Pick<Storage, "getItem" | "setItem"> }} deps
 */
export function createSoundPreferences({ getStorage }) {
  return Object.freeze({
    /** @returns {SoundSettings} */
    load() {
      try {
        const parsed = JSON.parse(getStorage().getItem(SOUND_STORAGE_KEY) ?? "null");
        return isSettings(parsed)
          ? Object.freeze({ muted: parsed.muted, volume: parsed.volume })
          : DEFAULT_SOUND_SETTINGS;
      } catch {
        return DEFAULT_SOUND_SETTINGS;
      }
    },

    /**
     * @param {SoundSettings} settings
     * @returns {boolean} whether the choice was stored
     */
    save(settings) {
      try {
        getStorage().setItem(
          SOUND_STORAGE_KEY,
          JSON.stringify({ muted: settings.muted, volume: settings.volume }),
        );
        return true;
      } catch {
        return false;
      }
    },
  });
}
