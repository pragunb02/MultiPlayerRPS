import { checkTelemetryEvent, TELEMETRY_SOURCES, TELEMETRY_TIER } from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { dayOf, startOfDay } from "../../utils/indiaTime.js";
import { ValidationError } from "../../utils/errors.js";
import { TELEMETRY_DROP_REASONS, TELEMETRY_LIMITS } from "./telemetryLimits.js";

const HOUR_MS = 60 * 60 * 1000;
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The start of the India hour a moment falls in (CC-175, owner 2026-10-20: "to the hour"). India is 5 hours 30
 * minutes ahead of UTC, so its hours start at half past in UTC, and an hour never straddles two India days.
 *
 * @param {number} ms
 * @returns {number}
 */
export const indiaHourOf = (ms) => Math.floor((ms + INDIA_OFFSET_MS) / HOUR_MS) * HOUR_MS - INDIA_OFFSET_MS;

/**
 * Anonymous usage counts (CC-175, ADR-034). Stores events that already passed the catalogue, each as one document
 * with only its catalogue fields, its build, the tier and the India hour it arrived in. Nothing that names a person,
 * a session, a device or an address is ever given to it. At most `storedPerDay` events are stored per India day:
 * the rest are dropped and counted, so a flood can never fill the database that holds the games.
 *
 * @param {{
 *   telemetryAccessor: ReturnType<typeof import("../../data/telemetryAccessor.js").createTelemetryAccessor>,
 *   now?: () => number,
 *   limits?: Partial<typeof TELEMETRY_LIMITS>,
 *   onDropped?: (drop: { reason: string, count: number }) => void,  the ops counter `telemetry.dropped` (ADR-055)
 *   serverBuild: string,  the server's version, on events the server records itself
 * }} deps
 */
export function createTelemetryComponent({
  telemetryAccessor,
  now = Date.now,
  limits = {},
  onDropped = () => undefined,
  serverBuild,
}) {
  assertDefined(telemetryAccessor, "telemetryAccessor");
  assertFunction(now, "now");
  assertFunction(onDropped, "onDropped");
  const rules = { ...TELEMETRY_LIMITS, ...limits };
  // How many events this India day has stored. Read from the database once a day (and at boot), then counted here,
  // because one server process stores them all (a second instance, CC-061, would share the count in the database).
  let today = { day: "", stored: 0 };
  let reading;

  function dropped(reason, count) {
    if (count > 0) onDropped({ reason, count });
  }

  async function storedToday(day) {
    if (today.day === day) return today;
    reading ??= telemetryAccessor
      .countSince(startOfDay(day))
      .then((stored) => {
        today = { day, stored };
        return today;
      })
      .finally(() => {
        reading = undefined;
      });
    return reading;
  }

  /**
   * Stores events up to the day's cap, and counts the rest as `cap`.
   *
   * @param {ReadonlyArray<Readonly<Record<string, string | number | boolean>>>} events  already checked
   * @param {string} build
   * @returns {Promise<number>} how many were stored
   */
  async function store(events, build) {
    if (events.length === 0) return 0;
    const at = now();
    const counter = await storedToday(dayOf(at));
    const room = Math.max(0, rules.storedPerDay - counter.stored);
    const kept = events.slice(0, room);
    dropped(TELEMETRY_DROP_REASONS.CAP, events.length - kept.length);
    if (kept.length === 0) return 0;
    // Counted before the write, so two batches at once cannot both take the last places.
    counter.stored += kept.length;
    const receivedAt = indiaHourOf(at);
    try {
      await telemetryAccessor.add(
        kept.map((event) => ({ ...event, build, tier: TELEMETRY_TIER, receivedAt })),
      );
    } catch (error) {
      counter.stored -= kept.length;
      throw error;
    }
    return kept.length;
  }

  return Object.freeze({
    /** The limits in force, for the service layer's size, count and rate checks. */
    limits: Object.freeze(rules),

    /**
     * Counts events that were not stored, by reason. Only the reason and the number leave the server.
     *
     * @param {string} reason  a TELEMETRY_DROP_REASONS value
     * @param {number} count
     */
    dropped,

    /**
     * Stores a browser's batch that passed the validator.
     *
     * @param {{ build: string, events: ReadonlyArray<Readonly<Record<string, string | number | boolean>>> }} batch
     * @returns {Promise<number>} how many were stored
     */
    storeBatch: ({ build, events }) => store(events, build),

    /**
     * Records an event the server sees itself (EVENTS.md 3.3 and 3.5), through the same catalogue. The caller has
     * already checked the opt-out headers, the admin list and the flag.
     *
     * @param {Record<string, string | number | boolean>} event  `{ name, player_kind, ...fields }`
     * @returns {Promise<number>} 1 when stored
     * @throws {ValidationError} for an event the catalogue does not allow: a mistake in our code
     */
    async record(event) {
      const checked = checkTelemetryEvent(event, TELEMETRY_SOURCES.SERVER);
      if (!checked.ok) {
        throw new ValidationError(`Server telemetry event refused: ${checked.problem}`);
      }
      return store([checked.event], serverBuild);
    },

    /**
     * Deletes every stored event that arrived before an India day (the owner's purge, for a rollback or a field
     * found wrong).
     *
     * @param {string} day  YYYY-MM-DD
     * @returns {Promise<number>} how many were deleted
     */
    async purgeBefore(day) {
      const deleted = await telemetryAccessor.deleteBefore(startOfDay(day));
      if (today.day !== "" && day > today.day) today = { day: "", stored: 0 };
      return deleted;
    },
  });
}
