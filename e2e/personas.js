// E2E_PORT lets several checkouts run the browser tests at the same time without sharing a server.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4997);
// Browsers reach the app over HTTPS, as on Render. tlsFront.js serves HTTPS on E2E_PORT with a certificate made
// for the run and passes each connection to the app on APP_PORT. WebKit needs this. On plain http://localhost it
// sends every request to HTTPS because of the page's security policy, and it drops Secure cookies (CC-184).
export const BASE_URL = `https://localhost:${E2E_PORT}`;
/** The app process itself, plain HTTP. Only the harness uses it (app.mjs, server.mjs, serverControl.js). */
export const APP_PORT = E2E_PORT + 10_000;
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
/** The test server's throwaway MongoDB (server.mjs), for the few tests that seed state directly. */
export const E2E_MONGO_PORT = E2E_PORT + 20_000;
export const E2E_MONGO_URI = `mongodb://127.0.0.1:${E2E_MONGO_PORT}/e2e`;

/** Seeded into the legacy `users` collection by server.mjs (bcrypt hash, legacy-style name). */
export const LEGACY_PLAYER = Object.freeze({
  legacyUsername: "Old Timer!",
  migratedUsername: "Old_Timer",
  email: "old.timer@example.com",
  password: "legacy password 1",
});

/**
 * A fresh account per test, so reruns against a reused server never collide.
 *
 * The tag is digits only: the last 11 digits of the clock and 4 random digits, which fills the 20 character limit
 * with "riya_". The public name rules read a part made only of digits as a number, so the name rules can never
 * refuse it. A tag with letters sometimes spelled a reserved or rude word, such as "cpu" in "riya_cp8um06316", and
 * sign-up refused it (CC-237).
 *
 * @returns {{ username: string, email: string, password: string }}
 */
export function newAccount() {
  const clock = String(Date.now()).slice(-11);
  const random = String(Math.floor(Math.random() * 1e4)).padStart(4, "0");
  const tag = `${clock}${random}`;
  return { username: `riya_${tag}`, email: `riya.${tag}@example.com`, password: `correct horse ${tag}` };
}
