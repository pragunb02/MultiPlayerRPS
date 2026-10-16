import path from "node:path";
import { LOG_LEVELS } from "../utils/logger.js";

const NODE_ENVS = ["development", "test", "production"];
const MIN_SESSION_SECRET_LENGTH = 32;
const DEV_ALLOWED_ORIGINS = ["http://localhost:4000", "http://localhost:5173"];

/**
 * @typedef {Object} Config
 * @property {"development" | "test" | "production"} env
 * @property {boolean} isProduction
 * @property {number} port
 * @property {string} logLevel
 * @property {string} mongoUri
 * @property {string} sessionSecret
 * @property {ReadonlyArray<string>} allowedOrigins  browser origins allowed to open realtime connections and send state-changing requests
 * @property {string} webDistDir      absolute path of the built web app to serve ("" = API only, e.g. in development with Vite)
 */

/**
 * Builds and validates the server config from environment variables.
 * Throws with every problem listed, so a misconfigured deploy fails at boot instead of at first request.
 *
 * Required: MONGO_URI, SESSION_SECRET (≥ 32 chars); ALLOWED_ORIGINS in production.
 * Documented defaults: NODE_ENV=development, PORT=4000, LOG_LEVEL=info (silent when NODE_ENV=test),
 * ALLOWED_ORIGINS=http://localhost:4000,http://localhost:5173 outside production. Optional: WEB_DIST_DIR (serve the built web app).
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

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join("\n  - ")}`);
  }

  return Object.freeze({
    env: /** @type {Config["env"]} */ (nodeEnv),
    isProduction,
    port,
    logLevel,
    mongoUri,
    sessionSecret,
    allowedOrigins,
    // Relative paths are taken from the working directory; Express can only send files by absolute path.
    webDistDir: webDistDir === "" ? "" : path.resolve(webDistDir),
  });
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
