/** Test double with the same contract as `createLegacyUserDao`. Seed it with legacy-shaped users. */
export function createInMemoryLegacyUserDao(users = []) {
  return Object.freeze({
    async listByEmail(email) {
      return users
        .filter((user) => user.email.trim().toLowerCase() === email.toLowerCase())
        .filter((user) => typeof user.password === "string")
        .map((user) => ({
          username: String(user.username ?? ""),
          email: user.email,
          passwordHash: user.password,
        }));
    },
  });
}
