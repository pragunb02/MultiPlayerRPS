const NODE_ENVS = ["development", "test", "production"];

/**
 * @typedef {Object} Config
 * @property {"development" | "test" | "production"} env
 * @property {boolean} isProduction
 * @property {number} port
 */

/**
 * Builds and validates the server config from environment variables.
 * Throws with every problem listed, so a misconfigured deploy fails at boot instead of at first request.
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

  const port = env.PORT === undefined ? 4000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    errors.push(`PORT must be an integer between 0 and 65535 (got "${env.PORT}")`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join("\n  - ")}`);
  }

  return Object.freeze({
    env: /** @type {Config["env"]} */ (nodeEnv),
    isProduction: nodeEnv === "production",
    port,
  });
}
