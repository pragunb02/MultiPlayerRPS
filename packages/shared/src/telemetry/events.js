import { ERROR_CODES } from "../errors.js";
import { GAME_IDS } from "../games.js";
import { SHARE_CHANNELS } from "../shareChannels.js";
import {
  TELEMETRY_BUCKETS,
  TELEMETRY_ENTRIES,
  TELEMETRY_ERROR_TYPES,
  TELEMETRY_MAX_SINCE_LOAD_MS,
  TELEMETRY_MAX_WAIT_MS,
  TELEMETRY_PLAYER_KINDS,
  TELEMETRY_SOCKET_CODES,
} from "./early.js";
import { fits, flag, list, ms, optional, pattern, ratio } from "./fields.js";
import { API_ENDPOINTS, OTHER_ENDPOINT, TELEMETRY_ROUTES } from "./routes.js";

// The small values the page needs early live in early.js (CC-322). The catalogue still offers them.
export {
  TELEMETRY_BUCKETS,
  TELEMETRY_ENTRIES,
  TELEMETRY_ERROR_TYPES,
  TELEMETRY_MAX_SINCE_LOAD_MS,
  TELEMETRY_MAX_WAIT_MS,
  TELEMETRY_PLAYER_KINDS,
  TELEMETRY_SOCKET_CODES,
};

/**
 * The telemetry catalogue in code (CC-174, CC-175): every event of docs/analytics/EVENTS.md that is built, with each
 * of its fields. The browser builds events only through it and the server keeps only what it allows, so the two can
 * never drift. Every value is from a closed list, a bucket, a rounded time or a fixed name from our code: never text
 * a person typed, an id, an address or a room code (ADR-034). An event or field not written here is not sent.
 *
 * Adding an event: a row in EVENTS.md, an entry here, and the code that sends it (ENGINEERING.md).
 */

/** Who sends an event: the browser through `POST /api/telemetry`, or the server itself. */
export const TELEMETRY_SOURCES = Object.freeze({ CLIENT: "client", SERVER: "server" });

/** The only tier built: no id of anyone, for everyone (ADR-034.1). */
export const TELEMETRY_TIER = "counts";

/** The width classes of `device`, from the viewport width only. */
export const TELEMETRY_DEVICES = Object.freeze({ PHONE: "phone", TABLET: "tablet", DESKTOP: "desktop" });
/** The widths in CSS pixels at which a tablet and a desktop start. */
export const DEVICE_WIDTHS = Object.freeze({ TABLET: 600, DESKTOP: 1024 });

/** Error codes a client event may carry, besides `network`, `timeout` and `unknown`. */
const CODES = Object.freeze([...Object.values(ERROR_CODES), "network", "timeout", "unknown"]);

/**
 * A control's stable name (`data-cc-control`, CC-170): lowercase words joined by dots, digits only after a letter
 * inside a word (`admin.range.last7`), each word at most 24 characters. A room code has capitals, an email an `@`, an
 * address digits and dots, a guest id hyphens and an account id 29 characters in one word, so none of them fits.
 */
export const CONTROL_PATTERN = /^[a-z][a-z_]{0,23}(?:\.[a-z][a-z0-9_]{0,23}){0,5}$/;
const CONTROL_MAX = 64;

/** The tags and roles a `dead_clicked` or `rage_clicked` without a control may name. */
export const TELEMETRY_ELEMENT_TAGS = Object.freeze([
  "a",
  "button",
  "div",
  "span",
  "img",
  "svg",
  "li",
  "p",
  "label",
  "summary",
  "td",
  "other",
]);
export const TELEMETRY_ELEMENT_ROLES = Object.freeze([
  "button",
  "link",
  "img",
  "tab",
  "menuitem",
  "checkbox",
  "switch",
  "option",
  "other",
]);
const ELEMENTS = Object.freeze([
  ...TELEMETRY_ELEMENT_TAGS,
  ...TELEMETRY_ELEMENT_TAGS.flatMap((tag) => TELEMETRY_ELEMENT_ROLES.map((role) => `${tag}:${role}`)),
]);

/** The build names an event may carry: the web build's stamp (CC-290) or the server's calendar version (CC-303). */
export const BUILD_PATTERN = /^(?:\d{1,4}\.\d{1,2}\.\d{1,2}\+(?:[0-9a-f]{7}|local)|dev|unknown)$/;

const control = pattern(CONTROL_PATTERN, CONTROL_MAX);
const element = list(ELEMENTS);
const entries = list(Object.values(TELEMETRY_ENTRIES));
const wait = ms(TELEMETRY_MAX_WAIT_MS);
const forms = list(["login", "signup"]);
const gameIds = list(Object.values(GAME_IDS));

/** The fields every client event carries (EVENTS.md 1, "The fields every event carries"). */
export const CLIENT_COMMON_FIELDS = Object.freeze({
  route: list(TELEMETRY_ROUTES),
  device: list(Object.values(TELEMETRY_DEVICES)),
  player_kind: list(Object.values(TELEMETRY_PLAYER_KINDS)),
});

/** The fields every server event carries: who the session was, and nothing about the page. */
export const SERVER_COMMON_FIELDS = Object.freeze({
  player_kind: list(Object.values(TELEMETRY_PLAYER_KINDS)),
});

/**
 * @typedef {Object} TelemetryEventSpec
 * @property {"client" | "server"} by
 * @property {Readonly<Record<string, Readonly<import("./fields.js").Field>>>} fields  besides the common ones
 * @property {ReadonlyArray<ReadonlyArray<string>>} [oneOf]  sets of fields of which exactly one is present
 */

const client = (fields, extra = {}) =>
  Object.freeze({ by: TELEMETRY_SOURCES.CLIENT, fields: Object.freeze(fields), ...extra });
const server = (fields) => Object.freeze({ by: TELEMETRY_SOURCES.SERVER, fields: Object.freeze(fields) });
const pressedOn = [["control", "element"]];

/** @type {Readonly<Record<string, Readonly<TelemetryEventSpec>>>} */
export const TELEMETRY_EVENTS = Object.freeze({
  // 3.1 Pages and visits
  page_viewed: client({
    is_landing: flag(),
    entry: optional(entries),
    via: optional(list(Object.values(SHARE_CHANNELS))),
  }),
  page_speed_measured: client({
    ttfb_ms: optional(wait),
    fcp_ms: optional(wait),
    lcp_ms: optional(wait),
    inp_ms: optional(wait),
    cls: optional(ratio(100)),
    was_waking: flag(),
  }),
  visit_ended: client({
    active_s: list(TELEMETRY_BUCKETS.ACTIVE_S),
    presses: list(TELEMETRY_BUCKETS.VISIT_PRESSES),
  }),
  // 3.2 Presses
  control_pressed: client({ control, has_reason: flag() }),
  dead_clicked: client({ control: optional(control), element: optional(element) }, { oneOf: pressedOn }),
  rage_clicked: client(
    { control: optional(control), element: optional(element), presses: list(TELEMETRY_BUCKETS.RAGE_PRESSES) },
    { oneOf: pressedOn },
  ),
  action_waited: client({
    control,
    transport: list(["http", "socket"]),
    wait_ms: wait,
    outcome: list(["ok", ...CODES]),
    showed_spinner: flag(),
  }),
  // 3.3 Sign-up and login, the browser's part
  auth_form_viewed: client({ form: forms, next_kind: list(["room", "profile", "leaderboard", "none"]) }),
  auth_form_submitted: client({ form: forms }),
  auth_form_rejected: client({
    form: forms,
    field: list(["email", "username", "password"]),
    rule: list(["missing", "too_short", "format", "reserved_name"]),
  }),
  // 3.4 The time to first move
  gameplay_started: client({
    game_id: gameIds,
    entry: entries,
    since_load_ms: ms(TELEMETRY_MAX_SINCE_LOAD_MS),
  }),
  // 3.5 Errors and connection
  client_errored: client({
    kind: list(["render", "unhandled", "chunk_load", "stale_build_reload"]),
    error_type: list(TELEMETRY_ERROR_TYPES),
  }),
  request_failed: client({
    endpoint: list([...API_ENDPOINTS, OTHER_ENDPOINT]),
    status: list([0, ...Array.from({ length: 200 }, (_, index) => 400 + index)]),
    code: list(CODES),
  }),
  socket_changed: client({
    state: list(["connect_failed", "dropped", "restored"]),
    code: list(TELEMETRY_SOCKET_CODES),
    after_s: optional(list(TELEMETRY_BUCKETS.AFTER_S)),
  }),
  // 3.3 and 3.5, the server's part: never accepted from a browser
  account_created: server({
    from_guest: flag(),
    guest_matches: optional(list(TELEMETRY_BUCKETS.GUEST_MATCHES)),
    guest_age_days: optional(list(TELEMETRY_BUCKETS.GUEST_AGE_DAYS)),
  }),
  login_succeeded: server({ from_guest: flag() }),
  login_failed: server({ reason: list(["wrong_credentials", "throttled", "rate_limited", "validation"]) }),
  session_ended: server({
    cause: list(["logout", "signed_out_elsewhere", "password_changed", "expired_90_days"]),
  }),
  guest_started: server({}),
  server_errored: server({ operation: list([...API_ENDPOINTS, OTHER_ENDPOINT]), code: list(CODES) }),
});

/** Every event name in the catalogue. */
export const TELEMETRY_EVENT_NAMES = Object.freeze(Object.keys(TELEMETRY_EVENTS));

/**
 * Whether a name is in the catalogue.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export const isTelemetryEventName = (name) =>
  typeof name === "string" && Object.hasOwn(TELEMETRY_EVENTS, name);

/**
 * The catalogue entry of a name. An unknown name is a mistake in code, so it throws.
 *
 * @param {string} name
 * @returns {Readonly<TelemetryEventSpec>}
 * @throws {RangeError}
 */
export function telemetryEventNamed(name) {
  if (!isTelemetryEventName(name)) {
    throw new RangeError(
      `Unknown telemetry event "${name}". Add it to packages/shared/src/telemetry/events.js.`,
    );
  }
  return TELEMETRY_EVENTS[name];
}

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * @typedef {{ ok: true, event: Readonly<Record<string, string | number | boolean>> } | { ok: false, problem: string }} TelemetryCheck
 */

/**
 * Checks one event against the catalogue: a known name from this source, every common field and every required
 * field of its own present and fitting, no other key, and exactly one of each `oneOf` set. The answer is a new,
 * frozen copy with only those keys, so nothing else the caller put on the object can slip through.
 *
 * @param {unknown} raw  `{ name, ...fields }`
 * @param {"client" | "server"} by  who sent it: a browser may never send a server event
 * @returns {TelemetryCheck} `problem` names the first thing wrong, for tests and the `invalid` count. It holds the
 *   key, never the value
 */
export function checkTelemetryEvent(raw, by) {
  if (!isPlainObject(raw)) return { ok: false, problem: "not an object" };
  const { name, ...rest } = /** @type {Record<string, unknown>} */ (raw);
  if (!isTelemetryEventName(name)) return { ok: false, problem: "unknown name" };
  const spec = TELEMETRY_EVENTS[/** @type {string} */ (name)];
  if (spec.by !== by) return { ok: false, problem: "wrong source" };
  const fields = {
    ...(by === TELEMETRY_SOURCES.CLIENT ? CLIENT_COMMON_FIELDS : SERVER_COMMON_FIELDS),
    ...spec.fields,
  };
  const unknown = Object.keys(rest).find((key) => !Object.hasOwn(fields, key));
  if (unknown !== undefined) return { ok: false, problem: "unknown field" };
  for (const [key, field] of Object.entries(fields)) {
    const present = Object.hasOwn(rest, key) && rest[key] !== undefined;
    if (!present && !field.optional) return { ok: false, problem: `missing ${key}` };
    if (present && !fits(field, rest[key])) return { ok: false, problem: `bad ${key}` };
  }
  const broken = (spec.oneOf ?? []).find((set) => set.filter((key) => rest[key] !== undefined).length !== 1);
  if (broken !== undefined) return { ok: false, problem: `one of ${broken.join(", ")}` };
  const kept = Object.keys(fields).filter((key) => rest[key] !== undefined);
  return {
    ok: true,
    event: Object.freeze(Object.fromEntries([["name", name], ...kept.map((key) => [key, rest[key]])])),
  };
}

/**
 * Whether a build name is one an event may carry.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isTelemetryBuild = (value) =>
  typeof value === "string" && value.length <= 40 && BUILD_PATTERN.test(value);
