import { OpsError } from "../lib/errors.mjs";

/**
 * Everything MongoDB's built in "read" and "readAnyDatabase" roles allow. If the backup user can do anything else,
 * a leaked backup secret could change or delete production data, so the backup refuses to run.
 */
export const READ_ACTIONS = Object.freeze(
  new Set([
    "changeStream",
    "collStats",
    "dbHash",
    "dbStats",
    "find",
    "killCursors",
    "listCollections",
    "listDatabases",
    "listIndexes",
    "listSearchIndexes",
    // MongoDB 8 also grants these with the read roles. Both only read.
    "performRawDataOperations",
    "planCacheRead",
  ]),
);

/**
 * @typedef {{ db: string, collection?: string } | { cluster: true } | { anyResource: true }} Resource
 * @typedef {{
 *   authenticatedUsers: readonly { user: string, db: string }[],
 *   authenticatedUserRoles: readonly { role: string, db: string }[],
 *   authenticatedUserPrivileges: readonly { resource: Resource, actions: readonly string[] }[],
 * }} AuthInfo
 * @typedef {{ close: () => Promise<void>, db: (name?: string) => any }} MongoClientLike  the parts of MongoClient used
 * @typedef {(uri: string) => Promise<MongoClientLike>} Connect
 */

/**
 * Checks what the connected user may do, from MongoDB's connectionStatus answer.
 *
 * @param {AuthInfo} authInfo
 * @returns {readonly string[]} the user's roles, as role@db
 */
export function assessPrivileges(authInfo) {
  if (authInfo.authenticatedUsers.length === 0) {
    throw new OpsError(
      "BACKUP_MONGO_URI did not log in as a user. Use the read only backup user's credentials.",
    );
  }
  const extra = new Set(
    authInfo.authenticatedUserPrivileges.flatMap(({ actions }) =>
      actions.filter((a) => !READ_ACTIONS.has(a)),
    ),
  );
  if (extra.size > 0) {
    throw new OpsError(
      `The backup user can do more than read (${[...extra].sort().join(", ")}). Give it only the ` +
        `"Only read any database" role. See docs/runbooks/backup-restore.md.`,
    );
  }
  return Object.freeze(authInfo.authenticatedUserRoles.map(({ role, db }) => `${role}@${db}`).sort());
}

/**
 * Connects with the backup credentials and proves they are read only and point at a database that has data, so a
 * wrong database name never produces an empty backup that looks fine.
 *
 * @param {{ uri: string, connect: Connect }} params
 * @returns {Promise<{ roles: readonly string[], database: string, collections: number }>}
 */
export async function checkReadOnly({ uri, connect }) {
  const client = await connect(uri);
  try {
    const db = client.db();
    const { authInfo } = await db.command({ connectionStatus: 1, showPrivileges: true });
    const roles = assessPrivileges(authInfo);
    const collections = (await db.listCollections().toArray()).length;
    if (collections === 0) {
      throw new OpsError(
        `Database "${db.databaseName}" has no collections. Put the production database name in BACKUP_MONGO_URI, ` +
          "after the host: mongodb+srv://user:password@host/<database>",
      );
    }
    return Object.freeze({ roles, database: db.databaseName, collections });
  } finally {
    await client.close();
  }
}
