/** Test double with the same contract as `createFeedbackDao` (verified by the shared contract tests). */
export function createInMemoryFeedbackDao() {
  /** @type {Map<string, object>} items by feedback id */
  const items = new Map();
  const copy = (doc) => structuredClone(doc);
  const newestFirst = (a, b) =>
    b.createdAt - a.createdAt || (a.feedbackId < b.feedbackId ? 1 : a.feedbackId > b.feedbackId ? -1 : 0);
  const sorted = (test) => [...items.values()].filter(test).sort(newestFirst);
  const olderThan = (doc, { createdAt, feedbackId }) =>
    doc.createdAt < createdAt || (doc.createdAt.getTime() === createdAt.getTime() && doc.feedbackId < feedbackId);
  const matches = (doc, where) => Object.entries(where).every(([key, value]) => doc[key] === value);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert(item) {
      items.set(item.feedbackId, copy(item));
      return copy(item);
    },

    list: async ({ where, before, limit }) =>
      sorted((doc) => matches(doc, where) && (before === undefined || olderThan(doc, before)))
        .slice(0, limit)
        .map(copy),

    async setStatus({ feedbackId, status, updatedAt }) {
      const doc = items.get(feedbackId);
      if (doc === undefined) {
        throw new RangeError(`No feedback ${feedbackId}`);
      }
      const next = { ...doc, status, updatedAt };
      items.set(feedbackId, next);
      return copy(next);
    },
  });
}
