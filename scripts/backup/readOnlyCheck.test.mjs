import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OpsError } from "../lib/errors.mjs";
import { startMongoWithUsers } from "../testing/mongoWithUsers.mjs";
import { assessPrivileges, checkReadOnly } from "./readOnlyCheck.mjs";

/** @param {readonly string[]} actions */
function authInfo(actions) {
  return {
    authenticatedUsers: [{ user: "backup", db: "admin" }],
    authenticatedUserRoles: [
      { role: "readAnyDatabase", db: "admin" },
      { role: "read", db: "app" },
    ],
    authenticatedUserPrivileges: [{ resource: { db: "", collection: "" }, actions }],
  };
}

describe("assessPrivileges", () => {
  it("accepts a user that can only read, and lists its roles", () => {
    expect(assessPrivileges(authInfo(["find", "listCollections", "collStats"]))).toEqual([
      "read@app",
      "readAnyDatabase@admin",
    ]);
  });

  it("refuses a user that can write, naming what it can do beyond reading", () => {
    expect(() => assessPrivileges(authInfo(["find", "remove", "insert", "insert"]))).toThrow(
      /more than read \(insert, remove\)/,
    );
  });

  it("refuses a connection that is not logged in", () => {
    const anonymous = { authenticatedUsers: [], authenticatedUserRoles: [], authenticatedUserPrivileges: [] };

    expect(() => assessPrivileges(anonymous)).toThrow(OpsError);
  });
});

describe("checkReadOnly against MongoDB with access control", () => {
  /** @type {Awaited<ReturnType<typeof startMongoWithUsers>>} */
  let mongo;
  const connect = (/** @type {string} */ uri) => MongoClient.connect(uri);

  beforeAll(async () => {
    mongo = await startMongoWithUsers();
    const admin = await MongoClient.connect(mongo.hostUri);
    await admin.db("classicade").collection("users").insertOne({ username: "ada" });
    await admin.db("classicade").collection("matches").insertOne({ game: "chess" });
    await admin.close();
  });
  afterAll(() => mongo.stop());

  it("passes for a read only user and counts the collections", async () => {
    const result = await checkReadOnly({ uri: mongo.uri({ as: "backup", db: "classicade" }), connect });

    expect(result).toEqual({ roles: ["readAnyDatabase@admin"], database: "classicade", collections: 2 });
  });

  it("refuses a user that can write", async () => {
    const uri = mongo.uri({ as: "writer", db: "classicade" });

    await expect(checkReadOnly({ uri, connect })).rejects.toThrow(/more than read/);
  });

  it("refuses the admin user", async () => {
    await expect(
      checkReadOnly({ uri: mongo.uri({ as: "admin", db: "classicade" }), connect }),
    ).rejects.toThrow(/more than read/);
  });

  it("refuses a database without collections, so a wrong name never makes an empty backup", async () => {
    const uri = mongo.uri({ as: "backup", db: "clasicade" });

    await expect(checkReadOnly({ uri, connect })).rejects.toThrow(/"clasicade" has no collections/);
  });

  it("closes the connection when the check fails", async () => {
    let closed = false;
    const tracking = async (/** @type {string} */ uri) => {
      const client = await MongoClient.connect(uri);
      const close = client.close.bind(client);
      return Object.assign(client, { close: () => ((closed = true), close()) });
    };

    await expect(checkReadOnly({ uri: mongo.uri({ as: "writer" }), connect: tracking })).rejects.toThrow();
    expect(closed).toBe(true);
  });
});
