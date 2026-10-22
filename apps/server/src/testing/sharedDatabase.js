/**
 * One database for a test file instead of a new one per test (CC-338, after CC-336). A new database makes every
 * collection and index again, and mongod syncs each one to disk: slow on a busy laptop, and every one of them is
 * synced again when mongod stops. `databaseUri` empties the file's database and gives its address, so its collections
 * and indexes are made once. A test of the indexes a new database gets calls `ownDatabaseNext` first.
 *
 * The state is per test file: Vitest loads this module again for each file.
 */
let ownNext = false;
let owned = 0;

/** The next `databaseUri` gives a new database of its own, for a test of what a new database gets. */
export function ownDatabaseNext() {
  ownNext = true;
}

/**
 * @param {{ uri: (dbName: string) => string, empty: (dbName: string) => Promise<void> }} mongo  from startMemoryMongo
 * @param {string} name  the file's database
 * @returns {Promise<string>} its address, emptied, or a new database's after `ownDatabaseNext`
 */
export async function databaseUri(mongo, name) {
  if (ownNext) {
    ownNext = false;
    return mongo.uri(`${name}-own-${++owned}`);
  }
  await mongo.empty(name);
  return mongo.uri(name);
}
