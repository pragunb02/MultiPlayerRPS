/**
 * The limits on telemetry (CC-175, ADR-034 as amended 2026-10-20, in the style of ADR-035). Each is a business rule,
 * and tests may change them. They keep one free database inside its 512 MB next to every game record.
 *
 * 1. `bodyBytes`: the largest batch, in bytes. 30 events of about 200 bytes each fit with room to spare.
 * 2. `eventsPerBatch`: the most events a batch may carry. A longer batch is dropped whole.
 * 3. `batches`: batches per session in a window, or per network for a visitor with no session (the CC-110 limiter,
 *    which keeps its keys in memory only). A client sends one every 10 seconds at most, and on `pagehide`, so this is
 *    ten times that: a long session, or many players on one mobile network, are never cut off (owner review
 *    2026-10-21).
 * 4. `perNetworkDaily`: events one network may have stored in one India day, a fiftieth of the site's day, so one
 *    network can never use up the day for everyone. Counted in memory, like CC-110, and forgotten at the day's end.
 * 5. `storedPerDay`: events stored for the whole site in one India day. Above it, events are dropped and counted.
 * 6. `keepDays`: how long a stored count lives before MongoDB deletes it (a TTL index).
 */
export const TELEMETRY_LIMITS = Object.freeze({
  bodyBytes: 8 * 1024,
  eventsPerBatch: 30,
  batches: Object.freeze({ windowMs: 10 * 60 * 1000, limit: 600 }),
  perNetworkDaily: 2_000,
  storedPerDay: 100_000,
  keepDays: 30,
});

/** Why a batch or an event was not stored, shared with the ops counter `telemetry.dropped` (ADR-055). */
export { TELEMETRY_DROP_REASONS } from "../../utils/operationsMetrics.js";
