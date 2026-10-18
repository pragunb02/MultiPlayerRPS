const isNonAscii = (text) => [...text].some((char) => char.codePointAt(0) > 127);

/** Test double with the same contract as `createLegacyUserDao`. Seed it with legacy-shaped users. */
export function createInMemoryLegacyUserDao(users = []) {
  return Object.freeze({
    async listByEmail(email, storedAs = []) {
      return users
        .filter(
          (user) => user.email.trim().toLowerCase() === email.toLowerCase() || storedAs.includes(user.email),
        )
        .filter((user) => typeof user.password === "string")
        .map((user) => ({
          username: String(user.username ?? ""),
          email: user.email,
          passwordHash: user.password,
          legacyId: `legacy-${users.indexOf(user)}`,
        }));
    },

    async listNonAsciiEmails() {
      return users
        .filter((user) => typeof user.email === "string" && isNonAscii(user.email))
        .map((user) => user.email);
    },
  });
}
