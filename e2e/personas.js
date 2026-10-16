// E2E_PORT lets several checkouts run the browser tests at the same time without sharing a server.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4997);
export const BASE_URL = `http://localhost:${E2E_PORT}`;

/** Seeded into the legacy `users` collection by server.mjs (bcrypt hash, legacy-style name). */
export const LEGACY_PLAYER = Object.freeze({
  legacyUsername: "Old Timer!",
  migratedUsername: "Old_Timer",
  email: "old.timer@example.com",
  password: "legacy password 1",
});

/** A fresh account per test run, so reruns against a reused server never collide. */
export function newAccount() {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(-10);
  return { username: `riya_${tag}`, email: `riya.${tag}@example.com`, password: `correct horse ${tag}` };
}
