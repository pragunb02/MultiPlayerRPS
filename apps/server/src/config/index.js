import { isIP } from "node:net";
import path from "node:path";
import { LOG_LEVELS } from "../utils/logger.js";

const NODE_ENVS = ["development", "test", "production"];
const MIN_SESSION_SECRET_LENGTH = 32;
const DEV_ALLOWED_ORIGINS = ["http://localhost:4000", "http://localhost:5173"];
const MAX_TRUST_PROXY_HOPS = 5;
const ADMIN_ACCOUNT_ID = /^user_[0-9a-f]{24}$/;
// This machine only. Render and the Docker image set HOST=0.0.0.0, because their platform proxy or published port
// has to reach the process (see DEPLOYMENT.md, CC-287).
const DEFAULT_HOST = "127.0.0.1";
const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const MAX_HOSTNAME_LENGTH = 253;

/**
 * @typedef {Object} Config
 * @property {"development" | "test" | "production"} env
 * @property {boolean} isProduction
 * @property {number} port
 * @property {string} host            the address the server listens on, an IP address or a hostname (default 127.0.0.1, this machine only)
 * @property {string} logLevel
 * @property {string} mongoUri
 * @property {string} sessionSecret
 * @property {ReadonlyArray<string>} allowedOrigins  browser origins allowed to open realtime connections and send state-changing requests
 * @property {string} webDistDir      absolute path of the built web app to serve ("" = API only, e.g. in development with Vite)
 * @property {number} trustProxyHops  how many proxies in front of the server add to X-Forwarded-For (0 = none, trust no header)
 * @property {ReadonlyArray<string>} adminAccountIds  the player ids (`user_` and 24 hex digits) that may open the owner console. Empty means nobody can (CC-233)
 */

/**
 * Builds and validates the server config from environment variables.
 * Throws with every problem listed, so a misconfigured deploy fails at boot instead of at first request.
 *
 * Required: MONGO_URI, SESSION_SECRET (≥ 32 chars); ALLOWED_ORIGINS in production.
 * Documented defaults: NODE_ENV=development, PORT=4000, HOST=127.0.0.1 in every environment, LOG_LEVEL=info (silent when NODE_ENV=test),
 * ALLOWED_ORIGINS=http://localhost:4000,http://localhost:5173 outside production,
 * TRUST_PROXY_HOPS=1 in production and 0 elsewhere. Optional: WEB_DIST_DIR (serve the built web app),
 * ADMIN_ACCOUNT_IDS (who may open the owner console, empty by default).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Readonly<Config>}
 */
export function loadConfig(env) {
  const errors = [];

  const nodeEnv = env.NODE_ENV ?? "development";
  if (!NODE_ENVS.includes(nodeEnv)) {
    errors.push(`NODE_ENV must be one of ${NODE_ENVS.join(", ")} (got "${nodeEnv}")`);
  }
  const isProduction = nodeEnv === "production";

  const port = env.PORT === undefined ? 4000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    errors.push(`PORT must be an integer between 0 and 65535 (got "${env.PORT}")`);
  }

  const host = parseHost(env.HOST, { errors });

  const logLevel = env.LOG_LEVEL ?? (nodeEnv === "test" ? "silent" : "info");
  if (!LOG_LEVELS.includes(logLevel)) {
    errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")} (got "${logLevel}")`);
  }

  const mongoUri = env.MONGO_URI ?? "";
  if (!/^mongodb(\+srv)?:\/\/.+/.test(mongoUri)) {
    errors.push("MONGO_URI is required and must start with mongodb:// or mongodb+srv://");
  }

  const sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    errors.push(`SESSION_SECRET is required and must be at least ${MIN_SESSION_SECRET_LENGTH} characters`);
  }

  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS, { isProduction, errors });

  const webDistDir = env.WEB_DIST_DIR ?? "";
  if (env.WEB_DIST_DIR !== undefined && webDistDir.trim() === "") {
    errors.push("WEB_DIST_DIR, when set, must be a directory path");
  } else if (isProduction && webDistDir === "") {
    // In production this server is the website: without the build it would answer every page with a 404.
    errors.push("WEB_DIST_DIR is required in production");
  }

  const trustProxyHops = parseTrustProxyHops(env.TRUST_PROXY_HOPS, { isProduction, errors });
  const adminAccountIds = parseAdminAccountIds(env.ADMIN_ACCOUNT_IDS, { errors });

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join("\n  - ")}`);
  }

  return Object.freeze({
    env: /** @type {Config["env"]} */ (nodeEnv),
    isProduction,
    port,
    host,
    logLevel,
    mongoUri,
    sessionSecret,
    allowedOrigins,
    // Relative paths are taken from the working directory; Express can only send files by absolute path.
    webDistDir: webDistDir === "" ? "" : path.resolve(webDistDir),
    trustProxyHops,
    adminAccountIds,
  });
}

/**
 * The address the server listens on. Without HOST the server is reachable from this machine only, so a laptop
 * running the server never shares it with the rest of the network by accident. A platform whose proxy must reach
 * the process sets HOST=0.0.0.0 (Render, the Docker image). A typo fails the boot, because a server that listens
 * somewhere unexpected is either unreachable or open to more people than intended.
 *
 * @param {string | undefined} raw  an IPv4 or IPv6 address, for example "0.0.0.0" or "::1", or a hostname such as "localhost"
 * @param {{ errors: string[] }} context
 * @returns {string}
 */
function parseHost(raw, { errors }) {
  if (raw === undefined) {
    return DEFAULT_HOST;
  }
  const host = raw.trim();
  if (isIP(host) === 0 && !isHostname(host)) {
    errors.push(`HOST must be an IP address or a hostname, for example 127.0.0.1 or 0.0.0.0 (got "${raw}")`);
    return DEFAULT_HOST;
  }
  return host;
}

/**
 * A hostname made of DNS labels: letters, digits and inner hyphens, at most 63 characters each. The last label may
 * not be all digits, because no top level domain is, so a broken IP address such as 999.1.1.1 is refused.
 *
 * @param {string} value
 */
function isHostname(value) {
  const labels = value.split(".");
  return (
    value.length <= MAX_HOSTNAME_LENGTH &&
    labels.every((label) => HOSTNAME_LABEL.test(label)) &&
    !/^\d+$/.test(labels[labels.length - 1])
  );
}

/**
 * The accounts that may open the owner console (CC-233). Each id is the `identity.id` an account sees at
 * /api/session, so the owner can copy their own. A typo fails the boot instead of silently locking the owner out.
 * Guests can never be admins, because a guest id lives only in a cookie that anyone can throw away.
 *
 * @param {string | undefined} raw  comma separated, for example "user_65f0c2a1b2c3d4e5f6a7b8c9"
 * @param {{ errors: string[] }} context
 * @returns {ReadonlyArray<string>}
 */
function parseAdminAccountIds(raw, { errors }) {
  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const invalid = ids.filter((id) => !ADMIN_ACCOUNT_ID.test(id));
  if (invalid.length > 0) {
    errors.push(
      `ADMIN_ACCOUNT_IDS must be a comma separated list of account ids like user_65f0c2a1b2c3d4e5f6a7b8c9 (got "${invalid.join(",")}")`,
    );
  }
  return Object.freeze([...new Set(ids)]);
}

/**
 * The number of proxies between the player and this server. Each one adds an address to the right end of
 * X-Forwarded-For, and the server counts that many entries in from the right to find the player. A number that is
 * too high lets a player write their own address into the header and pick their own rate limit key, so the default
 * is the smallest number that is always true. Production needs at least 1, because HTTPS ends at the hosting
 * platform's proxy and secure cookies depend on trusting it (see DEPLOYMENT.md).
 *
 * @param {string | undefined} raw  a whole number, for example "2"
 * @param {{ isProduction: boolean, errors: string[] }} context
 * @returns {number}
 */
function parseTrustProxyHops(raw, { isProduction, errors }) {
  const minimum = isProduction ? 1 : 0;
  if (raw === undefined) {
    return minimum;
  }
  const hops = /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!(hops >= minimum && hops <= MAX_TRUST_PROXY_HOPS)) {
    errors.push(
      `TRUST_PROXY_HOPS must be a whole number from ${minimum} to ${MAX_TRUST_PROXY_HOPS}${isProduction ? " in production" : ""} (got "${raw}")`,
    );
    return minimum;
  }
  return hops;
}

/**
 * @param {string | undefined} raw  comma-separated origins, e.g. "https://classicade.app,https://www.classicade.app"
 * @param {{ isProduction: boolean, errors: string[] }} context
 * @returns {ReadonlyArray<string>}
 */
function parseOrigins(raw, { isProduction, errors }) {
  if (raw === undefined) {
    if (isProduction) {
      errors.push("ALLOWED_ORIGINS is required in production");
    }
    return Object.freeze([...DEV_ALLOWED_ORIGINS]);
  }
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const invalid = origins.filter((origin) => !isOrigin(origin));
  if (origins.length === 0 || invalid.length > 0) {
    errors.push(
      `ALLOWED_ORIGINS must be a comma-separated list of origins like https://example.com (got "${raw}")`,
    );
  }
  return Object.freeze(origins);
}

/** @param {string} value */
function isOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}
