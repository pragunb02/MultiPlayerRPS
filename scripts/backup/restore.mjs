import { access, constants } from "node:fs/promises";

import { OpsError } from "../lib/errors.mjs";
import { runPiped } from "../lib/processes.mjs";

/**
 * Restores only ever write into a database with this prefix. Production never has one, so a restore can not land
 * on top of live data by mistake.
 */
export const SCRATCH_PREFIX = "restore_";

const SCRATCH_DB = new RegExp(`^${SCRATCH_PREFIX}[A-Za-z0-9_]{1,40}$`);
const DB_NAME = /^[A-Za-z0-9_-]{1,63}$/;
const NO_DATABASE_IN_URI = /^mongodb(?:\+srv)?:\/\/[^/]+\/?(?:\?.*)?$/;

/**
 * @typedef {import("./readOnlyCheck.mjs").Connect} Connect
 * @typedef {import("../lib/processes.mjs").Spawn} Spawn
 * @typedef {{ name: string, documents: number, indexes: number }} CollectionSummary
 */

/**
 * Document and index counts per collection, sorted by name. Counts only, so it can be compared and shared without
 * showing any data.
 *
 * @param {{ uri: string, database: string, connect: Connect }} params
 * @returns {Promise<readonly CollectionSummary[]>}
 */
export async function summarizeDatabase({ uri, database, connect }) {
  const client = await connect(uri);
  try {
    const db = client.db(database);
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name).sort();
    const summaries = await Promise.all(
      names.map(async (name) => {
        const collection = db.collection(name);
        const [documents, indexes] = await Promise.all([
          collection.countDocuments(),
          collection.listIndexes().toArray(),
        ]);
        return Object.freeze({ name, documents, indexes: indexes.length });
      }),
    );
    return Object.freeze(summaries);
  } finally {
    await client.close();
  }
}

/**
 * A plain text table of a summary.
 *
 * @param {readonly CollectionSummary[]} summary
 */
export function formatSummary(summary) {
  if (summary.length === 0) {
    return "(no collections)\n";
  }
  const width = Math.max(...summary.map(({ name }) => name.length), "collection".length);
  const row = (/** @type {string} */ name, /** @type {string} */ docs, /** @type {string} */ indexes) =>
    `${name.padEnd(width)}  ${docs.padStart(10)}  ${indexes.padStart(7)}\n`;
  return [
    row("collection", "documents", "indexes"),
    ...summary.map(({ name, documents, indexes }) => row(name, String(documents), String(indexes))),
  ].join("");
}

/** @param {string} path @param {string} what */
async function mustBeReadable(path, what) {
  try {
    await access(path, constants.R_OK);
  } catch (err) {
    throw new OpsError(`Can not read the ${what} at ${path}.`, { cause: err });
  }
}

/**
 * @typedef {{ archive: string, identity: string, uri: string, "from-db": string, "to-db": string }} RestoreOptions
 */

/**
 * Checks a restore request before anything runs: names are valid, files are readable, and the target is an empty
 * scratch database.
 *
 * @param {{ options: RestoreOptions, connect: Connect }} params
 */
export async function checkRestoreTarget({ options, connect }) {
  if (!SCRATCH_DB.test(options["to-db"])) {
    throw new OpsError(
      `--to-db must start with ${SCRATCH_PREFIX} (for example ${SCRATCH_PREFIX}2026_10_16).`,
    );
  }
  if (!DB_NAME.test(options["from-db"])) {
    throw new OpsError("--from-db must be the name of the database that was backed up.");
  }
  if (!NO_DATABASE_IN_URI.test(options.uri)) {
    throw new OpsError(
      "--uri must not name a database (end it after the host). --to-db chooses the database.",
    );
  }
  await mustBeReadable(options.archive, "backup file");
  await mustBeReadable(options.identity, "private key file");
  const existing = await summarizeDatabase({ uri: options.uri, database: options["to-db"], connect });
  if (existing.length > 0) {
    throw new OpsError(
      `${options["to-db"]} already has collections. Restore into a new ${SCRATCH_PREFIX} database.`,
    );
  }
}

/**
 * Decrypts a backup with the owner's private key and loads it into an empty scratch database, then returns what
 * landed there so it can be checked.
 *
 * @param {{ options: RestoreOptions, connect: Connect, spawn: Spawn }} params
 * @returns {Promise<readonly CollectionSummary[]>}
 */
export async function restoreBackup({ options, connect, spawn }) {
  await checkRestoreTarget({ options, connect });
  const from = options["from-db"];
  await runPiped({
    spawn,
    producer: { command: "age", args: ["--decrypt", "--identity", options.identity, options.archive] },
    consumer: {
      command: "mongorestore",
      args: [
        `--uri=${options.uri}`,
        "--gzip",
        "--archive",
        `--nsInclude=${from}.*`,
        `--nsFrom=${from}.*`,
        `--nsTo=${options["to-db"]}.*`,
        "--stopOnError",
      ],
    },
  });
  return summarizeDatabase({ uri: options.uri, database: options["to-db"], connect });
}
