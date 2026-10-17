import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OpsError } from "../lib/errors.mjs";
import { fakeSpawn } from "../testing/fakeSpawn.mjs";
import { startMongoWithUsers } from "../testing/mongoWithUsers.mjs";
import { checkRestoreTarget, formatSummary, restoreBackup, summarizeDatabase } from "./restore.mjs";

describe("formatSummary", () => {
  it("lines up counts under their headings", () => {
    const text = formatSummary([
      { name: "matches", documents: 1200, indexes: 3 },
      { name: "player_sessions", documents: 4, indexes: 2 },
    ]);

    expect(text).toBe(
      "collection        documents  indexes\n" +
        "matches                1200        3\n" +
        "player_sessions           4        2\n",
    );
  });

  it("says so when there are no collections", () => {
    expect(formatSummary([])).toBe("(no collections)\n");
  });
});

describe("restoring into MongoDB", () => {
  /** @type {Awaited<ReturnType<typeof startMongoWithUsers>>} */
  let mongo;
  let dir = "";
  let archive = "";
  let identity = "";
  const connect = (/** @type {string} */ uri) => MongoClient.connect(uri);

  /** @param {Partial<import("./restore.mjs").RestoreOptions>} [overrides] */
  const options = (overrides = {}) => ({
    archive,
    identity,
    uri: mongo.hostUri,
    "from-db": "classicade",
    "to-db": "restore_check",
    ...overrides,
  });

  beforeAll(async () => {
    mongo = await startMongoWithUsers();
    const admin = await MongoClient.connect(mongo.hostUri);
    await admin
      .db("restore_taken")
      .collection("users")
      .insertMany([{ username: "ada" }, { username: "alan" }]);
    await admin.db("restore_taken").collection("users").createIndex({ username: 1 }, { unique: true });
    await admin.db("restore_taken").collection("matches").insertOne({ game: "chess" });
    await admin.close();
    dir = await mkdtemp(join(tmpdir(), "cc-restore-"));
    archive = join(dir, "backup.age");
    identity = join(dir, "key.txt");
    await writeFile(archive, "ciphertext");
    await writeFile(identity, "AGE-SECRET-KEY-1TEST");
  });
  afterAll(async () => {
    await mongo.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("summarizes collections with their document and index counts, by name", async () => {
    const summary = await summarizeDatabase({ uri: mongo.hostUri, database: "restore_taken", connect });

    expect(summary).toEqual([
      { name: "matches", documents: 1, indexes: 1 },
      { name: "users", documents: 2, indexes: 2 },
    ]);
  });

  it("accepts an empty scratch database as the target", async () => {
    await expect(checkRestoreTarget({ options: options(), connect })).resolves.toBeUndefined();
  });

  it.each([
    ["a target that is not a scratch database", { "to-db": "classicade" }, /must start with restore_/],
    ["a target name with a dot", { "to-db": "restore_a.b" }, /must start with restore_/],
    ["a source name that is not a database name", { "from-db": "a.b" }, /--from-db/],
    [
      "a URI that names a database",
      { uri: "mongodb://localhost:27017/classicade" },
      /must not name a database/,
    ],
    ["a backup file that does not exist", { archive: "/no/such/backup.age" }, /backup file/],
    ["a key file that does not exist", { identity: "/no/such/key.txt" }, /private key file/],
    ["a scratch database that already has data", { "to-db": "restore_taken" }, /already has collections/],
  ])("refuses %s", async (_, overrides, message) => {
    const check = checkRestoreTarget({ options: options(overrides), connect });

    await expect(check).rejects.toThrow(OpsError);
    await expect(checkRestoreTarget({ options: options(overrides), connect })).rejects.toThrow(message);
  });

  it("accepts a URI with only options after the host", async () => {
    const uri = mongo.hostUri.replace("/?", "?");

    await expect(checkRestoreTarget({ options: options({ uri }), connect })).resolves.toBeUndefined();
  });

  it("refuses a key file it can not read", async () => {
    const locked = join(dir, "locked.txt");
    await writeFile(locked, "AGE-SECRET-KEY-1TEST");
    await chmod(locked, 0o000);

    await expect(checkRestoreTarget({ options: options({ identity: locked }), connect })).rejects.toThrow(
      /private key file/,
    );
  });

  it("pipes age into mongorestore, renaming the source database to the scratch one", async () => {
    const { spawn, calls } = fakeSpawn();

    const summary = await restoreBackup({ options: options(), connect, spawn });

    expect(calls).toEqual([
      { command: "age", args: ["--decrypt", "--identity", identity, archive] },
      {
        command: "mongorestore",
        args: [
          `--uri=${mongo.hostUri}`,
          "--gzip",
          "--archive",
          "--nsInclude=classicade.*",
          "--nsFrom=classicade.*",
          "--nsTo=restore_check.*",
          "--stopOnError",
        ],
      },
    ]);
    expect(summary).toEqual([]);
  });

  it("runs nothing when the target check fails", async () => {
    const { spawn, calls } = fakeSpawn();

    await expect(restoreBackup({ options: options({ "to-db": "prod" }), connect, spawn })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("fails when the restore fails", async () => {
    const { spawn } = fakeSpawn({ mongorestore: 1 });

    await expect(restoreBackup({ options: options(), connect, spawn })).rejects.toThrow(
      /mongorestore stopped/,
    );
  });
});
