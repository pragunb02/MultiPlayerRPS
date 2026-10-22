import { ERROR_CODES, GAMES, ROOM_STATUS, SOCKET_EVENTS } from "@classicade/shared";
import {
  BOT_THINKING_OUTCOMES,
  PASSWORD_CHECK_OUTCOMES,
  ROUTE_PATTERN,
  ROUTE_UNMATCHED,
  SOCKET_OUTCOMES,
} from "../../utils/operationsMetrics.js";

/** The metrics the server sends (ADR-055 point 1). Nothing else is exported. */
export const METRICS = Object.freeze({
  HTTP_DURATION: "http.server.request.duration",
  SOCKET_DURATION: "socket.event.duration",
  ROOMS_OPEN: "rooms.open",
  CONNECTIONS: "realtime.connections",
  PIPELINE_ATTEMPTS: "match_pipeline.attempts",
  PIPELINE_FAILED: "match_pipeline.failed",
  BOT_THINKING_DURATION: "bots.thinking.duration",
  PASSWORD_CHECKS: "accounts.password_checks",
  EVENT_LOOP_P50: "nodejs.eventloop.delay.p50",
  EVENT_LOOP_P99: "nodejs.eventloop.delay.p99",
  MEMORY_RSS: "process.memory.rss",
  MEMORY_HEAP_USED: "process.memory.heap_used",
  SCRUBBED: "telemetry.scrubbed",
  LOGS_SUPPRESSED: "telemetry.logs.suppressed",
});

/** The OpenTelemetry name for a method outside the standard list. */
export const OTHER_METHOD = "_OTHER";
/** What the scrubber writes in place of a value that breaks its rule. */
export const SCRUBBED_VALUE = "other";
/** The `key` of `telemetry.scrubbed` when the key itself was not on the list, because the key could hold anything. */
export const UNKNOWN_KEY = "unknown";

export const HTTP_METHODS = Object.freeze([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
]);

const SERVICE_NAME = "classicade-server";
const ENVIRONMENTS = ["development", "test", "production"];
const STATUS_CLASSES = ["1xx", "2xx", "3xx", "4xx", "5xx"];

// A route template is lowercase words (with inner dots or hyphens) and `:params`. A room code has capitals and
// digits, an id has digits or an underscore, an email has an @ and an IP address is digits, so none can pass.
const ROUTE_TEMPLATE = /^(\/([a-z]+([.-][a-z]+)*|:[a-z][a-zA-Z]*))+$/;
const ERROR_CLASS = /^[A-Z][A-Za-z0-9]{0,63}$/;
const SERVICE_VERSION = /^([0-9a-f]{7,12}|unknown)$/;

const LEVEL = Object.freeze({ INFO: 30, WARN: 40, ERROR: 50 });
const MAX_VALUE_LENGTH = 128;
const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The log lines that are forwarded, by message, with the lowest level that is (ADR-055 point 1.7). Each message
 * is a fixed string in our code. A line not listed here stays in Render's logs only. Nothing below info level is
 * ever forwarded, and the info lines are the few that mark a start or a stop. `request completed` goes at
 * error level only, because the request metric already counts every 4xx, and `telemetry export failed` is left
 * out on purpose, so a failing export cannot feed itself.
 */
const NAMED_LINES = Object.freeze({
  "server listening": LEVEL.INFO,
  "telemetry on": LEVEL.INFO,
  "shutting down": LEVEL.INFO,
  "shutdown complete": LEVEL.INFO,
  "match pipeline failed": LEVEL.ERROR,
  "match pipeline step failed, will retry": LEVEL.WARN,
  "finished games added to the match pipeline late": LEVEL.WARN,
  "room sweep failed": LEVEL.ERROR,
  "planning for computer players failed": LEVEL.ERROR,
  "applying game deadlines failed": LEVEL.ERROR,
  "resuming guest transfers failed": LEVEL.ERROR,
  "guest transfer failed again": LEVEL.ERROR,
  "running the match pipeline failed": LEVEL.ERROR,
  "adding finished games to the match pipeline failed": LEVEL.ERROR,
  "sweeping account deletions failed": LEVEL.ERROR,
  "account deletion sweep failed": LEVEL.ERROR,
  "reading the room gauge failed": LEVEL.ERROR,
  "shutdown timed out, forcing exit": LEVEL.ERROR,
  "error during shutdown": LEVEL.ERROR,
  "uncaught exception": LEVEL.ERROR,
  "unhandled promise rejection": LEVEL.ERROR,
  "background task failed": LEVEL.ERROR,
  "checking a socket's session failed": LEVEL.ERROR,
  "socket refused": LEVEL.WARN,
  "failed to broadcast room update": LEVEL.ERROR,
  "socket event without acknowledgement ignored": LEVEL.WARN,
  "socket handler failed": LEVEL.ERROR,
  "failed to record disconnect": LEVEL.ERROR,
  "failed to record that the player went offline": LEVEL.ERROR,
  "failed to record that the player came online": LEVEL.ERROR,
  "account closed, erasing its data will finish in the next sweep": LEVEL.ERROR,
  "moving the previous identity's data failed": LEVEL.ERROR,
  "the legacy store failed behind a login": LEVEL.ERROR,
  "saving the upgraded password hash failed": LEVEL.WARN,
  "stored email left in an older spelling: another account already has the one spelling": LEVEL.WARN,
  "unhandled error": LEVEL.ERROR,
  "computer player failed": LEVEL.ERROR,
  "computer player will try again": LEVEL.WARN,
  "computer player ran out of time to think": LEVEL.WARN,
  "computer player's thinking crashed": LEVEL.WARN,
  "request completed": LEVEL.ERROR,
});

/** @typedef {(value: unknown) => boolean} Rule */

/** @param {ReadonlyArray<unknown>} values */
const oneOf = (values) => {
  const allowed = new Set(values);
  return (value) => allowed.has(value);
};
/** @param {RegExp} pattern */
const matches =
  (pattern, maxLength = MAX_VALUE_LENGTH) =>
  (value) =>
    typeof value === "string" && value.length <= maxLength && pattern.test(value);
const wholeNumber = (min, max) => (value) => Number.isInteger(value) && value >= min && value <= max;
const either =
  (...rules) =>
  (value) =>
    rules.some((rule) => rule(value));

/**
 * The allowlist of everything that may leave the server (ADR-055 points 1, 2 and 7): for each metric its
 * attribute keys and a rule for each value, the named log lines and their fields, and the resource. The SDK's
 * Views, the log forwarder and the scrubber all read this one list, and a key or value it does not allow never
 * leaves. Adding an attribute means adding it here on purpose, and the privacy tests then check it.
 *
 * @param {{ matchSteps: ReadonlyArray<string> }} input  the match pipeline's step names (ADR-047)
 */
export function createTelemetrySchema({ matchSteps }) {
  const route = either(oneOf([ROUTE_UNMATCHED, ROUTE_PATTERN, "/"]), matches(ROUTE_TEMPLATE));
  const socketEvent = oneOf(Object.values(SOCKET_EVENTS));
  const game = oneOf(GAMES.map(({ id }) => id));
  const roomStatus = oneOf(Object.values(ROOM_STATUS));
  const step = oneOf(matchSteps);

  const metricRules = {
    [METRICS.HTTP_DURATION]: {
      "http.route": route,
      "http.request.method": oneOf([...HTTP_METHODS, OTHER_METHOD]),
      "http.response.status_class": oneOf(STATUS_CLASSES),
    },
    [METRICS.SOCKET_DURATION]: {
      "socket.event": socketEvent,
      outcome: oneOf(Object.values(SOCKET_OUTCOMES)),
    },
    [METRICS.ROOMS_OPEN]: { game, status: roomStatus },
    [METRICS.CONNECTIONS]: {},
    [METRICS.PIPELINE_ATTEMPTS]: { step },
    [METRICS.PIPELINE_FAILED]: { step },
    [METRICS.BOT_THINKING_DURATION]: { game, outcome: oneOf(Object.values(BOT_THINKING_OUTCOMES)) },
    [METRICS.PASSWORD_CHECKS]: { outcome: oneOf(Object.values(PASSWORD_CHECK_OUTCOMES)) },
    [METRICS.EVENT_LOOP_P50]: {},
    [METRICS.EVENT_LOOP_P99]: {},
    [METRICS.MEMORY_RSS]: {},
    [METRICS.MEMORY_HEAP_USED]: {},
  };
  const logFields = {
    errorCode: oneOf(Object.values(ERROR_CODES)),
    event: socketEvent,
    route,
    game,
    step,
    attempts: wholeNumber(1, 1000),
    status: either(wholeNumber(100, 599), roomStatus),
    "error.type": matches(ERROR_CLASS),
  };
  const resource = {
    "service.name": oneOf([SERVICE_NAME]),
    "service.version": matches(SERVICE_VERSION),
    "service.instance.id": matches(INSTANCE_ID),
    "deployment.environment.name": oneOf(ENVIRONMENTS),
  };
  // The scrubbed counter names the key that was wrong, so its own values are the known keys and the places the
  // scrubber looks at besides keys.
  const knownKeys = [
    ...Object.values(metricRules).flatMap((rules) => Object.keys(rules)),
    ...Object.keys(logFields),
    ...Object.keys(resource),
    "metric",
    "body",
    "eventName",
    UNKNOWN_KEY,
  ];
  metricRules[METRICS.SCRUBBED] = { signal: oneOf(["metrics", "logs"]), key: oneOf(knownKeys) };
  metricRules[METRICS.LOGS_SUPPRESSED] = {};

  return deepFreeze({
    serviceName: SERVICE_NAME,
    metrics: metricRules,
    logs: { lines: { ...NAMED_LINES }, fields: logFields },
    resource,
  });
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  Object.values(value).forEach((child) => {
    if (child !== null && typeof child === "object") deepFreeze(child);
  });
  return Object.freeze(value);
}
