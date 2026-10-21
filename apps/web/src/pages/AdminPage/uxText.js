import { FEWER_THAN_MIN, FEWER_THAN_MIN_TEXT, formatChange, formatShare, NO_DATA_TEXT } from "./format.js";

/**
 * The words of the owner's UX page (CC-177) and its Week view (CC-313). The server sends ids from closed lists, and
 * the page names them here, so a value from the database is never shown as markup.
 */

/** The words of each budget colour (CC-313). A line from fewer than 5 has no colour, and says so. */
export const COLOUR_WORDS = Object.freeze({ green: "Green", amber: "Amber", red: "Red", none: "No colour" });

/** The UX page's section tabs, in order. */
export const UX_SECTION_NAMES = Object.freeze({
  week: "Week",
  funnels: "Funnels",
  clicks: "Clicks",
  errors: "Errors",
  speed: "Speed",
  latency: "Latency",
  interruptions: "Interruptions",
});

/** What each section holds, in one line, under its heading. */
export const UX_SECTION_LEDES = Object.freeze({
  week: "The last full India week, Monday to Sunday, against the week before: the interruption budget and what it is made of.",
  funnels:
    "Visit to play, link to seat and sign-up as ratios of daily totals, then the registered step funnels.",
  clicks: "Where presses do nothing (dead clicks) and where people press again and again (rage clicks).",
  errors: "Errors players saw and the server's own, by day and by build.",
  speed:
    "Page speed at p75 by screen and device against the Core Web Vitals good lines, and the time to first move.",
  latency: "How long a press waits for its answer, as the player feels it, per control.",
  interruptions: "Toasts, banners, dialogs and cards the site opened, against the interruption budget.",
});

export const FUNNEL_TITLES = Object.freeze({
  visit_to_play: "Visit to play",
  link_to_seat: "Link to seat",
  sign_up: "Sign-up",
  challenge: "Challenge",
});

export const STEP_LABELS = Object.freeze({
  landed: "Landed",
  first_move: "First move",
  room_link_landed: "Landed on a room link",
  join_guest: "Pressed Join as guest",
  guest_started: "New guest",
  form_viewed: "Sign-up form seen",
  form_submitted: "Sign-up form sent",
  account_created: "Account made",
  game_opened: "Game opened",
  seated: "Seated",
  link_opened: "Link opened",
  challenge_opened: "Challenge opened",
  challenge_accepted: "Challenge accepted",
});

export const ENTRY_LABELS = Object.freeze({
  direct: "Direct",
  shared_link: "A shared link",
  room_link: "A room link",
  search: "Search",
  social: "Social",
  other_site: "Another site",
});

export const EVENT_LABELS = Object.freeze({
  client_errored: "Errors in the browser",
  request_failed: "Requests that failed",
  socket_changed: "Connection changes",
  server_errored: "Server errors",
});

export const BUDGET_LABELS = Object.freeze({
  optional_per_visit: "Optional interruptions per visit",
  visits_with_three_or_more: "Visits with 3 or more optional interruptions",
  optional_per_game_during_play: "Optional interruptions during play, per game",
  blocking_optional_during_play: "Blocking optional interruptions during play",
  first_move_p75_slower: "Time to first move p75, against the 4 weeks before",
  rage_and_dead_per_100_presses: "Rage and dead clicks per 100 presses",
});

/** The budget's green line of each measure, in words (CC-313 section 5, owner 2026-10-20). */
export const BUDGET_GREEN = Object.freeze({
  optional_per_visit: "0.5 or less",
  visits_with_three_or_more: "5 % or less",
  optional_per_game_during_play: "0.05 or less",
  blocking_optional_during_play: "0",
  first_move_p75_slower: "within 10 %",
  rage_and_dead_per_100_presses: "1 or less",
});

export const SPEED_LABELS = Object.freeze({
  lcp_ms: "Largest paint (LCP)",
  inp_ms: "Press to paint (INP)",
  cls: "Layout shift (CLS)",
  fcp_ms: "First paint (FCP)",
  ttfb_ms: "First byte (TTFB)",
});

export const DEVICE_LABELS = Object.freeze({ phone: "Phone", tablet: "Tablet", desktop: "Desktop" });

/** A count, a mean or a share that may be hidden, as a plain number with up to 2 decimals. */
export function formatValue(value) {
  if (value === FEWER_THAN_MIN) return FEWER_THAN_MIN_TEXT;
  if (typeof value !== "number") return NO_DATA_TEXT;
  return String(Math.round(value * 100) / 100);
}

/** A funnel step's ratio to the step before: a share, said to be capped when the totals went over 100 %. */
export function formatRatio({ ratio, capped }) {
  if (ratio === undefined) return "";
  return capped ? `${formatShare(ratio)} (capped)` : formatShare(ratio);
}

/** A change against the period before, in words, or "" when either side is hidden. */
export function changeWords(change) {
  if (change === null || change === undefined) return "";
  return formatChange(change);
}

/** Each budget measure as it reads: a share as a percentage, the others as numbers. */
export function formatBudgetValue(measure, value) {
  if (value === FEWER_THAN_MIN) return FEWER_THAN_MIN_TEXT;
  if (typeof value !== "number") return NO_DATA_TEXT;
  if (measure === "visits_with_three_or_more") return formatShare(value);
  if (measure === "first_move_p75_slower") return formatChange(value);
  return String(Math.round(value * 100) / 100);
}

/** A route template as it reads, with the game slug kept: the template itself is the clearest name. */
export const routeName = (route) => (route === "not_found" ? "Not found page" : route);
