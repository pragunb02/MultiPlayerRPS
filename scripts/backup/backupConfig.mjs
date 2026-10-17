import { OpsError } from "../lib/errors.mjs";

/**
 * The repository secrets the backup workflow needs. docs/runbooks/backup-restore.md explains how to create each one.
 */
export const BACKUP_SECRETS = Object.freeze([
  "BACKUP_MONGO_URI",
  "BACKUP_AGE_RECIPIENTS",
  "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_BUCKET",
  "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY",
]);

const MONGO_URI = /^mongodb(?:\+srv)?:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?[^/?]+/;
const PUBLIC_KEY = /^(?:age1[0-9a-z]+|ssh-(?:ed25519|rsa) \S+(?: .*)?)$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * @typedef {{ configured: false, missing: readonly string[] }} NotConfigured
 * @typedef {{ configured: true, masks: readonly string[] }} Configured
 */

/**
 * The public keys in BACKUP_AGE_RECIPIENTS, one per line. Blank lines and # comments are allowed, as in an age
 * recipients file.
 *
 * @param {string} text
 */
export function recipientLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** @param {string} value */
function checkRecipients(value) {
  const lines = recipientLines(value);
  if (lines.some((line) => line.toUpperCase().startsWith("AGE-SECRET-KEY-"))) {
    throw new OpsError(
      "BACKUP_AGE_RECIPIENTS holds a private key. Delete that secret now, make a new key pair, and store only the " +
        "public key (it starts with age1).",
    );
  }
  if (lines.length === 0 || !lines.every((line) => PUBLIC_KEY.test(line))) {
    throw new OpsError("BACKUP_AGE_RECIPIENTS must hold age public keys (age1...), one per line.");
  }
}

/** @param {string} password */
function decodePassword(password) {
  try {
    return decodeURIComponent(password);
  } catch (err) {
    throw new OpsError("The password in BACKUP_MONGO_URI is not URL encoded correctly.", { cause: err });
  }
}

/**
 * The password in the connection string, in both forms a tool could print it in. GitHub already hides the whole
 * secret, but an error message could quote just the password. The user name is not hidden: it is not secret, and
 * hiding a common word would blank it out of every log line.
 *
 * @param {string} uri
 */
function passwordMasks(uri) {
  const match = MONGO_URI.exec(uri);
  if (!match) {
    throw new OpsError("BACKUP_MONGO_URI must be a mongodb:// or mongodb+srv:// connection string.");
  }
  const password = match[2] ?? "";
  if (password === "") {
    throw new OpsError(
      "BACKUP_MONGO_URI must include the user name and password of the read only backup user.",
    );
  }
  return [...new Set([password, decodePassword(password)])];
}

/**
 * Decides whether the backup can run. With no secrets at all the owner has not set backups up yet, so the job is
 * skipped. Some but not all secrets, or a value in the wrong shape, is a setup mistake and fails loudly.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {NotConfigured | Configured}
 */
export function checkBackupConfig(env) {
  const missing = BACKUP_SECRETS.filter((name) => !env[name]?.trim());
  if (missing.length === BACKUP_SECRETS.length) {
    return Object.freeze({ configured: false, missing: Object.freeze(missing) });
  }
  if (missing.length > 0) {
    throw new OpsError(`Backups are half set up. Missing secrets: ${missing.join(", ")}.`);
  }
  const value = (/** @type {string} */ name) => /** @type {string} */ (env[name]).trim();
  const masks = passwordMasks(value("BACKUP_MONGO_URI"));
  checkRecipients(value("BACKUP_AGE_RECIPIENTS"));
  if (!value("BACKUP_S3_ENDPOINT").startsWith("https://")) {
    throw new OpsError("BACKUP_S3_ENDPOINT must be an https:// URL.");
  }
  if (!BUCKET.test(value("BACKUP_S3_BUCKET"))) {
    throw new OpsError("BACKUP_S3_BUCKET must be a bucket name, without s3:// or slashes.");
  }
  return Object.freeze({ configured: true, masks: Object.freeze(masks) });
}
