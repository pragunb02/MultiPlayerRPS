/** Test double with the same contract as `createLegacyUserDao`. Seed it with legacy-shaped users. */
export function createInMemoryLegacyUserDao(users = []) {
  return Object.freeze({
    async getByEmail(email) {
      const doc = users.find((user) => user.email.toLowerCase() === email.toLowerCase());
      if (doc === undefined || typeof doc.password !== "string") {
        throw new RangeError("No legacy user for that email");
      }
      return { username: String(doc.username ?? ""), email: doc.email, passwordHash: doc.password };
    },
  });
}
