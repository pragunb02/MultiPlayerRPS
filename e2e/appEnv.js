// The environment of the browser tests' app process (app.mjs), kept apart so a unit test can check it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OWNER_PLAYER_ID } from "./ownerConsole.js";
import { APP_PORT, BASE_URL } from "./personas.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The variables the app process boots with. HOST is not set, so the app takes the config's own default and listens
 * on this machine only. Browsers reach it through the HTTPS front in tlsFront.js, which connects to 127.0.0.1
 * (CC-287).
 *
 * @param {{ mongoUri: string | undefined }} options  the test database that server.mjs started
 * @returns {Record<string, string | undefined>}
 */
export function appEnv({ mongoUri }) {
  return {
    // Secure cookies and proxy trust, as on Render. tlsFront.js serves HTTPS in front of this process, and the
    // tests send X-Forwarded-Proto: https as Render's proxy does.
    NODE_ENV: "production",
    PORT: String(APP_PORT),
    LOG_LEVEL: "warn",
    MONGO_URI: mongoUri,
    SESSION_SECRET: "e2e-session-secret-not-used-anywhere-else-0123456789",
    ALLOWED_ORIGINS: BASE_URL,
    WEB_DIST_DIR: path.join(root, "apps/web/dist"),
    // The seeded owner may open the owner console (CC-233, ownerConsole.js).
    ADMIN_ACCOUNT_IDS: OWNER_PLAYER_ID,
  };
}
