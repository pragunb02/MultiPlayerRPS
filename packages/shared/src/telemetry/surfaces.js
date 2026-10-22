/**
 * Every interruption the site can show (CC-313, ADR-034 as amended 2026-10-20): each toast, banner, dialog, card,
 * line, request and screen, named once. Code shows one only by naming its surface here, and a source test fails on a
 * toast, dialog or banner that does not (apps/web/src/interruptionSurfaces.test.js). Adding a pop-up is one line here
 * and its ticket.
 *
 * Fields:
 * 1. `id`: `kind.what`, a fixed name.
 * 2. `kind`: one of SURFACE_KINDS.
 * 3. `blocking`: it blocks the page (a modal dialog, a full screen).
 * 4. `class`: `essential` when the player cannot play right without it (the connection, waking up, this room's
 *    requests, an error, a confirm or an answer the player asked for), otherwise `optional` (rewards, prompts,
 *    promotions, requests from other rooms, notices).
 * 5. `opens`: who opens it, the `player` by a press of their own or the `system`. Only optional surfaces the system
 *    opened count against the interruption budget (owner, 2026-10-20).
 * 6. `ticket`: the ticket that added it.
 */

export const SURFACE_KINDS = Object.freeze([
  "toast",
  "banner",
  "dialog",
  "card",
  "line",
  "request",
  "screen",
]);
export const SURFACE_CLASSES = Object.freeze({ ESSENTIAL: "essential", OPTIONAL: "optional" });
export const SURFACE_OPENERS = Object.freeze({ PLAYER: "player", SYSTEM: "system" });

const { ESSENTIAL, OPTIONAL } = SURFACE_CLASSES;
const { PLAYER, SYSTEM } = SURFACE_OPENERS;

/**
 * @typedef {Object} Surface
 * @property {string} id
 * @property {string} kind
 * @property {boolean} blocking
 * @property {"essential" | "optional"} class
 * @property {"player" | "system"} opens
 * @property {string} ticket
 */

const surface = (id, blocking, kindOfClass, opens, ticket) =>
  Object.freeze({ id, kind: id.split(".")[0], blocking, class: kindOfClass, opens, ticket });

/** @type {ReadonlyArray<Readonly<Surface>>} */
export const SURFACES = Object.freeze([
  // Rewards after a game (CC-017, CC-054, CC-089, CC-095).
  surface("toast.xp", false, OPTIONAL, SYSTEM, "CC-017"),
  surface("toast.level_up", false, OPTIONAL, SYSTEM, "CC-017"),
  surface("toast.computer_xp", false, OPTIONAL, SYSTEM, "CC-138"),
  surface("toast.not_counted", false, OPTIONAL, SYSTEM, "CC-095"),
  surface("toast.achievement", false, OPTIONAL, SYSTEM, "CC-054"),
  surface("toast.quest", false, OPTIONAL, SYSTEM, "CC-089"),
  surface("toast.saved", false, OPTIONAL, SYSTEM, "CC-097"),
  surface("toast.friend_request", false, OPTIONAL, SYSTEM, "CC-052"),
  // Answers to the player's own press or request.
  surface("toast.copied", false, ESSENTIAL, PLAYER, "CC-217"),
  surface("toast.blocked", false, ESSENTIAL, PLAYER, "CC-044"),
  surface("toast.request_answer", false, ESSENTIAL, SYSTEM, "CC-207"),
  surface("toast.challenge_answer", false, ESSENTIAL, SYSTEM, "CC-139"),
  surface("toast.room_notice", false, ESSENTIAL, SYSTEM, "CC-207"),
  // Prompts and lines on the page.
  surface("card.save_progress", false, OPTIONAL, SYSTEM, "CC-097"),
  surface("line.streak_at_risk", false, OPTIONAL, SYSTEM, "CC-097"),
  // Banners.
  surface("banner.connection", false, ESSENTIAL, SYSTEM, "CC-101"),
  surface("banner.request", false, ESSENTIAL, SYSTEM, "CC-160"),
  surface("banner.turn", false, ESSENTIAL, SYSTEM, "CC-223"),
  // Requests from other rooms and challenges, on any page (CC-207, CC-139).
  surface("request.site", false, OPTIONAL, SYSTEM, "CC-207"),
  surface("request.challenge", false, OPTIONAL, SYSTEM, "CC-139"),
  // Dialogs, all opened by the player's own press.
  surface("dialog.feedback", true, OPTIONAL, PLAYER, "CC-290"),
  surface("dialog.sound", true, OPTIONAL, PLAYER, "CC-208"),
  surface("dialog.fairness", true, OPTIONAL, PLAYER, "CC-225"),
  surface("dialog.block", true, ESSENTIAL, PLAYER, "CC-044"),
  surface("dialog.confirm_leave", true, ESSENTIAL, PLAYER, "CC-163"),
  surface("dialog.pass_and_play", true, ESSENTIAL, PLAYER, "CC-223"),
  surface("dialog.delete_account", true, ESSENTIAL, PLAYER, "CC-035"),
  surface("dialog.remove_friend", true, ESSENTIAL, PLAYER, "CC-052"),
  surface("dialog.delete_feedback", true, ESSENTIAL, PLAYER, "CC-290"),
  surface("dialog.report", true, ESSENTIAL, PLAYER, "CC-044"),
  surface("dialog.report_review", true, ESSENTIAL, PLAYER, "CC-044"),
  // The owner console's Design page shows a real dialog and a real toast on request (CC-314).
  surface("dialog.design_sample", true, ESSENTIAL, PLAYER, "CC-314"),
  surface("toast.design_sample", false, ESSENTIAL, PLAYER, "CC-314"),
  // The full screen while a cold server wakes up (CC-232).
  surface("screen.waking_up", true, ESSENTIAL, SYSTEM, "CC-232"),
]);

/** Every surface id. */
export const SURFACE_IDS = Object.freeze(SURFACES.map(({ id }) => id));

const BY_ID = new Map(SURFACES.map((each) => [each.id, each]));

/**
 * Whether an id is a registered surface.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
export const isSurfaceId = (id) => typeof id === "string" && BY_ID.has(id);

/**
 * The registered surface of an id. An unknown id is a mistake in code, so it throws.
 *
 * @param {string} id
 * @returns {Readonly<Surface>}
 * @throws {RangeError}
 */
export function surfaceNamed(id) {
  const found = BY_ID.get(id);
  if (found === undefined) {
    throw new RangeError(`Unknown surface "${id}". Add it to packages/shared/src/telemetry/surfaces.js.`);
  }
  return found;
}
