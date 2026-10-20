/** Test double with the same contract as `createTelemetryEventDao` (verified by the shared contract tests). */
export function createInMemoryTelemetryEventDao() {
  /** @type {Array<Record<string, unknown> & { received_at: Date }>} */
  let events = [];
  const copy = (doc) => structuredClone(doc);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insertMany(docs) {
      events.push(...docs.map(copy));
    },

    countSince: async (from) => events.filter(({ received_at }) => received_at >= from).length,

    async deleteBefore(before) {
      const kept = events.filter(({ received_at }) => received_at >= before);
      const deleted = events.length - kept.length;
      events = kept;
      return deleted;
    },

    list: async ({ from, to, limit }) =>
      events
        .filter(({ received_at }) => received_at >= from && received_at < to)
        .sort((a, b) => a.received_at.getTime() - b.received_at.getTime())
        .slice(0, limit)
        .map(copy),
  });
}
