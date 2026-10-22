/** Test double with the same contract as `createTelemetryCountDao` (verified by the shared contract tests). */
export function createInMemoryTelemetryCountDao() {
  /** @type {Map<string, Record<string, unknown> & { key: string, hour: Date, count: number }>} */
  let counters = new Map();
  const copy = ({ key, ...doc }) => structuredClone(doc);
  const byHourAndKey = (a, b) => a.hour.getTime() - b.hour.getTime() || (a.key < b.key ? -1 : 1);

  return Object.freeze({
    ensureIndexes: async () => {},

    async addCounts(rows) {
      rows.forEach(({ key, hour, fields, count }) => {
        const id = `${hour.getTime()} ${key}`;
        const counter = counters.get(id) ?? { ...structuredClone(fields), key, hour, count: 0 };
        counters.set(id, { ...counter, count: counter.count + count });
      });
    },

    countSince: async (from) =>
      [...counters.values()].filter(({ hour }) => hour >= from).reduce((sum, { count }) => sum + count, 0),

    async deleteBefore(before) {
      const gone = [...counters.values()].filter(({ hour }) => hour < before);
      counters = new Map([...counters].filter(([, { hour }]) => hour >= before));
      return gone.reduce((sum, { count }) => sum + count, 0);
    },

    list: async ({ from, to, limit }) =>
      [...counters.values()]
        .filter(({ hour }) => hour >= from && hour < to)
        .sort(byHourAndKey)
        .slice(0, limit)
        .map(copy),
  });
}
