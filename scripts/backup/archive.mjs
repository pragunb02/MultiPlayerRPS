import { open } from "node:fs/promises";

import { OpsError } from "../lib/errors.mjs";

/** Every file age encrypts starts with this line, so it proves the upload is ciphertext and not a plain dump. */
export const AGE_HEADER = "age-encryption.org/v1\n";

/** Where backups live in the bucket. The bucket's 30 day lifecycle rule is set on this prefix. */
export const BACKUP_PREFIX = "mongo/";

/**
 * The bucket key for a backup taken at this moment. Sortable by time, and safe in any S3 compatible store.
 *
 * @param {Date} now
 */
export function backupObjectKey(now) {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");
  return `${BACKUP_PREFIX}classicade-${stamp}.archive.gz.age`;
}

/**
 * Checks that a file is an age encrypted file with something in it, before it is uploaded anywhere.
 *
 * @param {string} path
 * @returns {Promise<{ bytes: number }>}
 */
export async function checkEncryptedArchive(path) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(AGE_HEADER.length);
    await file.read({ buffer: header, position: 0 });
    if (header.toString("latin1") !== AGE_HEADER) {
      throw new OpsError(`${path} is not an age encrypted file. Nothing was uploaded.`);
    }
    // The header with one recipient is about 200 bytes. A real dump adds far more than the margin here.
    if (size < 256) {
      throw new OpsError(`${path} is only ${size} bytes, too small to hold a dump. Nothing was uploaded.`);
    }
    return Object.freeze({ bytes: size });
  } finally {
    await file.close();
  }
}
