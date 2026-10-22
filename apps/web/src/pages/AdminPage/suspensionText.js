import { SUSPENSION_DURATION, SUSPENSION_REASON } from "@classicade/shared";

/**
 * The console's words for account suspensions (CC-334, ADR-078), in one place. The console is for the owner, so it
 * is in English only, as the rest of the console.
 */

/** What each duration is called. A new one in SUSPENSION_DURATIONS needs one line here. */
export const SUSPENSION_DURATION_LABELS = Object.freeze({
  [SUSPENSION_DURATION.DAY]: "24 hours",
  [SUSPENSION_DURATION.WEEK]: "7 days",
  [SUSPENSION_DURATION.MONTH]: "30 days",
  [SUSPENSION_DURATION.UNTIL_LIFTED]: "Until I lift it",
});

/** What each reason is called. A closed list: there is no box to type in. */
export const SUSPENSION_REASON_LABELS = Object.freeze({
  [SUSPENSION_REASON.CHEATING]: "Cheating or stalling",
  [SUSPENSION_REASON.HARASSMENT]: "Harassing other players",
  [SUSPENSION_REASON.NAME]: "Offensive name, again",
  [SUSPENSION_REASON.OTHER]: "Another rule broken",
});

/** A moment in India time, as the rest of the console shows times. */
export const indiaTime = (ms) =>
  new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** When a suspension ends, or that it lasts until lifted. */
export const endsText = (suspension) =>
  suspension.endsAt === undefined ? "until lifted" : `until ${indiaTime(suspension.endsAt)}`;
