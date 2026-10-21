import { readFileSync } from "node:fs";

const COMMON_PASSWORDS = new URL("./passwords/commonPasswords.txt", import.meta.url);

/**
 * The common password list we keep in the repository (CC-261, ADR-080): the SecLists list of the 10,000 most common
 * passwords, under the MIT License (see passwords/LICENSE.md). Read once, at boot. Entries are kept in lower case,
 * so a password is looked up in lower case too, and "Password1" counts as "password1".
 *
 * @param {{ file?: URL }} [options]  `file` is for tests only, to read a small list
 * @returns {Readonly<{ size: number, has: (password: string) => boolean }>}  `has` expects lower case
 */
export function loadCommonPasswords({ file = COMMON_PASSWORDS } = {}) {
  const entries = new Set(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line !== ""),
  );
  return Object.freeze({ size: entries.size, has: (password) => entries.has(password) });
}
