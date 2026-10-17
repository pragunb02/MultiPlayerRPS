import { createContext, useContext } from "react";

/** Asking guests to save their progress (CC-097). Provided by <SaveProgressProvider>. */
export const SaveProgressContext = createContext(null);

/** The prompts a guest can close; each stays closed for the rest of the page session. */
export const PROMPTS = Object.freeze({
  ROOM_CARD: "room-card",
  LEVEL_UP: "level-up",
  STREAK: "streak",
});

/** A daily streak worth losing: at least this many days. */
export const STREAK_AT_RISK_MIN_DAYS = 2;

/** After the first win, a later win offers the card again once the guest has this much XP. */
export const SAVE_WORTHY_XP = 50;

/**
 * @typedef {{ xp: number, level: number, wins: number, matchesPlayed: number }} GuestProgress
 * @typedef {{ win: { current: number }, daily: { current: number, atRisk: boolean } }} GuestStreaks
 * @typedef {{
 *   guest: boolean,
 *   progress: GuestProgress | undefined,
 *   streaks: GuestStreaks | undefined,
 *   isDismissed: (prompt: string) => boolean,
 *   dismiss: (prompt: string) => void,
 *   mayOfferInRoom: (room: { code: string, game: number }) => boolean,
 *   offeredInRoom: (room: { code: string, game: number }) => void,
 *   confirmSaved: (carriedOver: { xp: number, matchesPlayed: number } | undefined) => Promise<void>,
 * }} SaveProgress
 *
 * `guest` is true only for a guest session; then `progress` and `streaks` are the guest's (once loaded, kept
 * current by pushes). Visitors and account holders get `guest: false` and nothing loaded.
 */

/** @returns {SaveProgress} */
export function useSaveProgress() {
  const value = useContext(SaveProgressContext);
  if (value === null) {
    throw new Error("useSaveProgress must be used inside <SaveProgressProvider>");
  }
  return value;
}

/**
 * The streak a guest is about to lose, if any: a daily streak of at least two days not yet played today, and the
 * guest hasn't closed the reminder.
 *
 * @returns {{ days: number, dismiss: () => void } | undefined}
 */
export function useStreakAtRisk() {
  const save = useSaveProgress();
  const daily = save.streaks?.daily;
  if (
    !save.guest ||
    daily === undefined ||
    !daily.atRisk ||
    daily.current < STREAK_AT_RISK_MIN_DAYS ||
    save.isDismissed(PROMPTS.STREAK)
  ) {
    return undefined;
  }
  return { days: daily.current, dismiss: () => save.dismiss(PROMPTS.STREAK) };
}
