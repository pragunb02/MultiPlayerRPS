import { NOTIFICATION_CATEGORIES } from "../notify/categories.js";

/**
 * The only thing the app keeps in web storage (CC-103): whether sound is on, how loud, and since CC-208 the same
 * two settings for each kind of notice. It is a preference of this browser, not of the player, so it lives in
 * localStorage and survives reloads and signing in or out. The browser tests allow exactly this key and this
 * shape (e2e/fixtures.js).
 */
export const SOUND_STORAGE_KEY = "cc.sound";

/** Every kind of notice is on at full volume, so only the main volume decides, until the player says otherwise. */
const DEFAULT_CATEGORIES = Object.freeze(
  Object.fromEntries(NOTIFICATION_CATEGORIES.map(({ id }) => [id, Object.freeze({ on: true, volume: 1 })])),
);

/** Sound is on at a moderate volume until the player says otherwise. */
export const DEFAULT_SOUND_SETTINGS = Object.freeze({
  muted: false,
  volume: 0.6,
  categories: DEFAULT_CATEGORIES,
});

/**
 * @typedef {Readonly<{ on: boolean, volume: number }>} CategorySetting
 * @typedef {Readonly<{ muted: boolean, volume: number, categories: Readonly<Record<string, CategorySetting>> }>} SoundSettings
 */

const isVolume = (value) => typeof value === "number" && value >= 0 && value <= 1;
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCategorySetting = (value) =>
  isPlainObject(value) &&
  Object.keys(value).length === 2 &&
  typeof value.on === "boolean" &&
  isVolume(value.volume);

/** Settings for each category, or undefined when what is stored is not that. Missing categories get defaults. */
function readCategories(stored) {
  if (stored === undefined) return DEFAULT_CATEGORIES;
  if (!isPlainObject(stored)) return undefined;
  const known = Object.keys(stored).every((id) => Object.hasOwn(DEFAULT_CATEGORIES, id));
  if (!known || !Object.values(stored).every(isCategorySetting)) return undefined;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(DEFAULT_CATEGORIES).map(([id, fallback]) => [
        id,
        stored[id] === undefined ? fallback : Object.freeze({ on: stored[id].on, volume: stored[id].volume }),
      ]),
    ),
  );
}

/** The settings in a stored value, or undefined when it is not settings. Values stored before CC-208 lack categories. */
function readSettings(value) {
  if (!isPlainObject(value) || typeof value.muted !== "boolean" || !isVolume(value.volume)) return undefined;
  if (Object.keys(value).some((key) => !["muted", "volume", "categories"].includes(key))) return undefined;
  const categories = readCategories(value.categories);
  return categories === undefined
    ? undefined
    : Object.freeze({ muted: value.muted, volume: value.volume, categories });
}

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
        return (
          readSettings(JSON.parse(getStorage().getItem(SOUND_STORAGE_KEY) ?? "null")) ??
          DEFAULT_SOUND_SETTINGS
        );
      } catch {
        return DEFAULT_SOUND_SETTINGS;
      }
    },

    /**
     * @param {SoundSettings} settings
     * @returns {boolean} whether the choice was stored
     */
    save(settings) {
      const categories = Object.fromEntries(
        Object.keys(DEFAULT_CATEGORIES).map((id) => {
          const { on, volume } = settings.categories[id];
          return [id, { on, volume }];
        }),
      );
      try {
        getStorage().setItem(
          SOUND_STORAGE_KEY,
          JSON.stringify({ muted: settings.muted, volume: settings.volume, categories }),
        );
        return true;
      } catch {
        return false;
      }
    },
  });
}
