import { randomBytes } from "node:crypto";

import { MongoMemoryServer } from "mongodb-memory-server";

/** A fresh password per test run, so no password is ever written into the repository. */
const throwawayPassword = () => randomBytes(18).toString("base64url");

/**
 * A throwaway MongoDB with access control on, like Atlas, and the users a backup setup has: a read only backup user,
 * a user that can write (which the backup must refuse), and an admin for seeding and restoring. The backup user's
 * password has characters that must be URL encoded in a connection string, as real ones often do.
 */
export const USERS = Object.freeze({
  admin: { user: "admin", password: throwawayPassword() },
  backup: { user: "backup", password: `${throwawayPassword()}@/%` },
  writer: { user: "writer", password: throwawayPassword() },
});

/**
 * @returns {Promise<{
 *   uri: (params: { as: keyof typeof USERS, db?: string }) => string,
 *   hostUri: string,
 *   stop: () => Promise<void>,
 * }>}
 */
export async function startMongoWithUsers() {
  const server = await MongoMemoryServer.create({
    auth: {
      enable: true,
      customRootName: USERS.admin.user,
      customRootPwd: USERS.admin.password,
      extraUsers: [
        {
          createUser: USERS.backup.user,
          pwd: USERS.backup.password,
          roles: [{ role: "readAnyDatabase", db: "admin" }],
        },
        {
          createUser: USERS.writer.user,
          pwd: USERS.writer.password,
          roles: [{ role: "readWrite", db: "classicade" }],
        },
      ],
    },
  });
  const host = new URL(server.getUri()).host;
  return {
    uri: ({ as, db = "" }) =>
      `mongodb://${USERS[as].user}:${encodeURIComponent(USERS[as].password)}@${host}/${db}?authSource=admin`,
    hostUri: `mongodb://${encodeURIComponent(USERS.admin.user)}:${encodeURIComponent(USERS.admin.password)}@${host}/?authSource=admin`,
    stop: () => server.stop(),
  };
}
