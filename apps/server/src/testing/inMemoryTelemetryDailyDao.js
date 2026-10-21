/** Test double with the same contract as `createTelemetryDailyDao` (verified by the shared contract tests). */
export function createInMemoryTelemetryDailyDao() {
  /** @type {Map<string, Array<{ event: string, key: string, group: object, count: number, timings?: object }>>} */
  const days = new Map();
  /** @type {Map<string, { owner: string | null, leaseUntil: Date | null, doneAt: Date | null }>} */
  const runs = new Map();
  const byEventAndKey = (a, b) =>
    a.event === b.event ? (a.key < b.key ? -1 : 1) : a.event < b.event ? -1 : 1;

  return Object.freeze({
    ensureIndexes: async () => {},

    async replaceDay({ day, rows }) {
      days.set(day, structuredClone([...rows]));
    },

    read: async ({ from, to, events }) =>
      [...days.entries()]
        .filter(([day]) => day >= from && day <= to)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .flatMap(([day, rows]) =>
          rows
            .filter(({ event }) => events.includes(event))
            .sort(byEventAndKey)
            .map(({ key, ...row }) => structuredClone({ day, ...row })),
        ),

    async acquireRun({ day, owner, now, until }) {
      const run = runs.get(day) ?? { owner: null, leaseUntil: null, doneAt: null };
      if (run.leaseUntil !== null && run.leaseUntil > now) return false;
      runs.set(day, { ...run, owner, leaseUntil: until });
      return true;
    },

    async finishRun({ day, owner, now }) {
      const run = runs.get(day);
      if (run?.owner === owner) runs.set(day, { owner: null, leaseUntil: null, doneAt: now });
    },

    async releaseRun({ day, owner, now }) {
      const run = runs.get(day);
      if (run?.owner === owner) runs.set(day, { ...run, owner: null, leaseUntil: now });
    },

    doneDays: async ({ from, to }) =>
      [...runs.entries()]
        .filter(([day, run]) => day >= from && day <= to && run.doneAt !== null)
        .map(([day]) => day)
        .sort(),
  });
}
