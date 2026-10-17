import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Decimal128, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMongoWithUsers } from "../testing/mongoWithUsers.mjs";
import { checkEncryptedArchive } from "./archive.mjs";
import { createBackupCli } from "./cli.mjs";

// The whole backup and restore, with the real tools: dump with the read only user, encrypt, decrypt, restore into a
// scratch database, compare. It needs mongodump, mongorestore and age on the PATH. CI installs them and sets
// REQUIRE_BACKUP_TOOLS=1, so there a missing tool fails instead of skipping.
const TOOLS = ["mongodump", "mongorestore", "age", "age-keygen"];
const missingTools = TOOLS.filter((tool) => spawnSync(tool, ["--version"]).error);
const required = process.env.REQUIRE_BACKUP_TOOLS === "1";
const DUMP_SCRIPT = fileURLToPath(new URL("./dump-and-encrypt.sh", import.meta.url));
const run = promisify(execFile);

describe.skipIf(missingTools.length > 0 && !required)("backup round trip with the real tools", () => {
  /** @type {Awaited<ReturnType<typeof startMongoWithUsers>>} */
  let mongo;
  /** @type {MongoClient} */
  let admin;
  let dir = "";
  let archive = "";
  let key = "";

  const cli = createBackupCli({ connect: (uri) => MongoClient.connect(uri), spawn, now: () => new Date() });

  /** @param {{ toDb: string, identity?: string }} params */
  async function restore({ toDb, identity = key }) {
    const out = /** @type {string[]} */ ([]);
    const io = { write: (/** @type {string} */ text) => out.push(text) };
    const argv = ["restore", "--archive", archive, "--identity", identity, "--uri", mongo.hostUri];
    const code = await cli({
      argv: [...argv, "--from-db", "classicade", "--to-db", toDb],
      env: {},
      stdout: io,
      stderr: io,
    });
    return { code, output: out.join("") };
  }

  /** @param {string} db */
  async function contents(db) {
    const names = (await admin.db(db).listCollections().toArray()).map(({ name }) => name).sort();
    return Promise.all(
      names.map(async (name) => ({
        name,
        documents: await admin.db(db).collection(name).find().sort({ _id: 1 }).toArray(),
        indexes: (await admin.db(db).collection(name).indexes()).map(({ name, key, unique }) => ({
          name,
          key,
          unique,
        })),
      })),
    );
  }

  beforeAll(async () => {
    expect(missingTools, "backup tools missing on the PATH").toEqual([]);
    mongo = await startMongoWithUsers();
    admin = await MongoClient.connect(mongo.hostUri);
    const app = admin.db("classicade");
    await app.collection("users").insertMany([
      {
        _id: new ObjectId(),
        email: "ada@example.com",
        createdAt: new Date("2026-01-02T03:04:05Z"),
        xp: 1200,
      },
      { _id: new ObjectId(), email: "alan@example.com", profile: { level: 3, badges: ["first-win"] } },
    ]);
    await app.collection("users").createIndex({ email: 1 }, { unique: true });
    await app
      .collection("matches")
      .insertOne({ game: "chess", moves: ["e4", "e5"], stake: Decimal128.fromString("1.50") });
    await app
      .collection("player_sessions")
      .insertOne({ _id: "session-1", expires: new Date("2026-11-01T00:00:00Z") });
    await admin.db("other").collection("things").insertOne({ secret: "must not be in the backup" });

    dir = await mkdtemp(join(tmpdir(), "cc-roundtrip-"));
    archive = join(dir, "backup.age");
    key = join(dir, "key.txt");
    const recipients = join(dir, "recipients.txt");
    await run("age-keygen", ["-o", key]);
    await writeFile(recipients, (await run("age-keygen", ["-y", key])).stdout);

    // Exactly what the nightly workflow runs, with the read only user.
    await run("bash", [DUMP_SCRIPT, recipients, archive], {
      env: { ...process.env, BACKUP_MONGO_URI: mongo.uri({ as: "backup", db: "classicade" }) },
    });
  });

  afterAll(async () => {
    await admin?.close();
    await mongo?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("writes an age encrypted file with no readable data in it", async () => {
    await expect(checkEncryptedArchive(archive)).resolves.toEqual({ bytes: expect.any(Number) });
    expect((await readFile(archive)).includes("ada@example.com")).toBe(false);
  });

  it("restores every document and index of the backed up database into the scratch database", async () => {
    const { code, output } = await restore({ toDb: "restore_roundtrip" });

    expect(output).toMatch(/users\s+2\s+2/);
    expect(code).toBe(0);
    expect(await contents("restore_roundtrip")).toEqual(await contents("classicade"));
  });

  it("backs up only the database named in the connection string", async () => {
    const restored = await contents("restore_roundtrip");

    expect(restored.map(({ name }) => name)).toEqual(["matches", "player_sessions", "users"]);
  });

  it("refuses to restore over a scratch database that already has data", async () => {
    const { code, output } = await restore({ toDb: "restore_roundtrip" });

    expect(code).toBe(1);
    expect(output).toMatch(/already has collections/);
  });

  it("can not be decrypted with any other key", async () => {
    const otherKey = join(dir, "other-key.txt");
    await run("age-keygen", ["-o", otherKey]);

    const { code, output } = await restore({ toDb: "restore_wrong_key", identity: otherKey });

    expect(code).toBe(1);
    expect(output).toMatch(/age stopped with exit code/);
    expect(await contents("restore_wrong_key")).toEqual([]);
  });
});
