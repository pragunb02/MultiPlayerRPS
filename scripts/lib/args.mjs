import { OpsError } from "./errors.mjs";

/**
 * Parses "--name value" pairs. Every listed name is required and anything else is rejected, so a typo never turns
 * into a silently ignored option.
 *
 * @template {string} Name
 * @param {{ argv: readonly string[], names: readonly Name[] }} params
 * @returns {Readonly<Record<Name, string>>}
 */
export function parseNamedArgs({ argv, names }) {
  if (argv.length % 2 !== 0) {
    throw new OpsError(`Expected pairs of --name value, got: ${argv.join(" ")}`);
  }
  /** @type {Record<string, string>} */
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const name = flag.replace(/^--/, "");
    if (!flag.startsWith("--") || !names.includes(/** @type {Name} */ (name))) {
      throw new OpsError(`Unknown option ${flag}. Expected: ${names.map((n) => `--${n}`).join(", ")}`);
    }
    if (name in values) {
      throw new OpsError(`Option ${flag} was given twice.`);
    }
    values[name] = argv[i + 1];
  }
  const missing = names.filter((name) => !values[name]);
  if (missing.length > 0) {
    throw new OpsError(`Missing option(s): ${missing.map((n) => `--${n}`).join(", ")}`);
  }
  return Object.freeze(/** @type {Record<Name, string>} */ (values));
}
