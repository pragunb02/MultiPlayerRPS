import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpsError } from "../lib/errors.mjs";
import { fakeSpawn } from "../testing/fakeSpawn.mjs";
import { AGE_HEADER } from "./archive.mjs";
import { createBackupCli } from "./cli.mjs";

const PUBLIC_KEY = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";
const SECRETS = Object.freeze({
  BACKUP_MONGO_URI: "mongodb+srv://backup:s3cret@cluster0.example.net/classicade",
  BACKUP_AGE_RECIPIENTS: PUBLIC_KEY,
  BACKUP_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  BACKUP_S3_BUCKET: "classicade-backups",
  BACKUP_S3_ACCESS_KEY_ID: "key-id",
  BACKUP_S3_SECRET_ACCESS_KEY: "key-secret",
});

/**
 * A stand in for MongoClient with a fixed login and fixed collections.
 *
 * @param {{ actions?: readonly string[], collections?: readonly string[] }} [setup]
 */
function fakeConnect({ actions = ["find"], collections = ["users"] } = {}) {
  /** @type {string[]} */
  const connectedTo = [];
  const connect = async (/** @type {string} */ uri) => {
    connectedTo.push(uri);
    const db = {
      databaseName: "classicade",
      command: async () => ({
        authInfo: {
          authenticatedUsers: [{ user: "backup", db: "admin" }],
          authenticatedUserRoles: [{ role: "readAnyDatabase", db: "admin" }],
          authenticatedUserPrivileges: [{ resource: { db: "" }, actions }],
        },
      }),
      listCollections: () => ({ toArray: async () => collections.map((name) => ({ name })) }),
      collection: () => ({
        countDocuments: async () => 3,
        listIndexes: () => ({ toArray: async () => [{ name: "_id_" }] }),
      }),
    };
    return { db: () => db, close: async () => {} };
  };
  return { connect, connectedTo };
}

function capture() {
  const chunks = /** @type {string[]} */ ([]);
  return { write: (/** @type {string} */ text) => chunks.push(text), text: () => chunks.join("") };
}

describe("backup command line", () => {
  let dir = "";
  let output = "";
  let summary = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-backup-cli-"));
    output = join(dir, "output");
    summary = join(dir, "summary");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  /**
   * @param {readonly string[]} argv
   * @param {{ env?: Record<string, string>, connect?: any, spawn?: any }} [setup]
   */
  async function run(argv, { env = {}, connect = fakeConnect().connect, spawn = fakeSpawn().spawn } = {}) {
    const stdout = capture();
    const stderr = capture();
    const cli = createBackupCli({ connect, spawn, now: () => new Date("2026-10-16T02:23:05Z") });
    const code = await cli({
      argv,
      env: { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env },
      stdout,
      stderr,
    });
    return { code, stdout: stdout.text(), stderr: stderr.text() };
  }

  const readOutput = () => readFile(output, "utf8");

  it("prints usage for an unknown command", async () => {
    const result = await run(["explode"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^Usage:/);
  });

  it("prints usage when no command is given", async () => {
    expect((await run([])).code).toBe(2);
  });

  it("does not treat built in object names as commands", async () => {
    expect((await run(["toString"])).code).toBe(2);
  });

  describe("config", () => {
    it("skips with a notice, not a failure, when backups are not set up", async () => {
      const result = await run(["config"]);

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/^::notice title=Backup skipped::Backups are not set up yet/);
      expect(result.stdout).toContain("BACKUP_MONGO_URI");
      expect(await readOutput()).toBe("ready=false\n");
    });

    it("masks the password and marks the job ready when every secret is set", async () => {
      const result = await run(["config"], { env: SECRETS });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("::add-mask::s3cret\nBackup secrets are set.\n");
      expect(await readOutput()).toBe("ready=true\n");
    });

    it("fails with an error annotation when backups are half set up", async () => {
      const result = await run(["config"], {
        env: { BACKUP_MONGO_URI: SECRETS.BACKUP_MONGO_URI, GITHUB_ACTIONS: "true" },
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/^::error title=backup config::Backups are half set up/);
    });

    it("rejects arguments it does not take", async () => {
      expect((await run(["config", "--force", "yes"])).code).toBe(1);
    });
  });

  describe("read-only", () => {
    it("reports the roles and the number of collections, but no names or data", async () => {
      const { connect, connectedTo } = fakeConnect({ collections: ["users", "matches"] });

      const result = await run(["read-only"], { env: SECRETS, connect });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe(
        "Read only: yes (readAnyDatabase@admin). Database classicade: 2 collections.\n",
      );
      expect(connectedTo).toEqual([SECRETS.BACKUP_MONGO_URI]);
    });

    it("fails for a user that can write", async () => {
      const result = await run(["read-only"], {
        env: SECRETS,
        connect: fakeConnect({ actions: ["insert"] }).connect,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/more than read \(insert\)/);
    });

    it("fails when the connection string is not set", async () => {
      expect((await run(["read-only"])).stderr).toMatch(/BACKUP_MONGO_URI is not set/);
    });
  });

  describe("prepare-upload", () => {
    it("checks the archive, sets the bucket key output and writes the run summary", async () => {
      const file = join(dir, "backup.age");
      await writeFile(file, Buffer.concat([Buffer.from(AGE_HEADER), Buffer.alloc(500)]));

      const result = await run(["prepare-upload", "--file", file]);

      expect(result.code).toBe(0);
      expect(await readOutput()).toBe("key=mongo/classicade-2026-10-16T02-23-05Z.archive.gz.age\n");
      expect(await readFile(summary, "utf8")).toContain("Encrypted archive of 522 bytes");
    });

    it("fails for a file that is not encrypted", async () => {
      const file = join(dir, "plain.gz");
      await writeFile(file, Buffer.alloc(500, 1));

      expect((await run(["prepare-upload", "--file", file])).stderr).toMatch(/not an age encrypted file/);
    });
  });

  describe("restore", () => {
    it("restores and prints what landed in the scratch database", async () => {
      const archive = join(dir, "backup.age");
      const identity = join(dir, "key.txt");
      await writeFile(archive, "x");
      await writeFile(identity, "x");
      // The target is empty before the restore and has the restored collection after it.
      let restored = false;
      const { spawn, calls } = fakeSpawn();
      const recording = /** @type {any} */ (
        (/** @type {string} */ command, /** @type {string[]} */ args) => {
          restored = command === "mongorestore";
          return spawn(command, args);
        }
      );
      const connect = (/** @type {string} */ uri) =>
        fakeConnect({ collections: restored ? ["users"] : [] }).connect(uri);

      const result = await run(
        [
          "restore",
          "--archive",
          archive,
          "--identity",
          identity,
          "--uri",
          "mongodb://localhost:27017",
          "--from-db",
          "classicade",
          "--to-db",
          "restore_2026_10_16",
        ],
        { connect, spawn: recording },
      );

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(calls.map(({ command }) => command)).toEqual(["age", "mongorestore"]);
      expect(result.stdout).toContain("Restored into restore_2026_10_16:\ncollection");
      expect(result.stdout).toMatch(/users\s+3\s+1/);
    });

    it("needs every option", async () => {
      expect((await run(["restore", "--archive", "a"])).stderr).toMatch(/Missing option/);
    });
  });

  describe("summary", () => {
    it("prints document and index counts", async () => {
      const result = await run(["summary", "--uri", "mongodb://localhost:27017", "--db", "restore_x"]);

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/users\s+3\s+1/);
    });
  });

  it("prints the stack of an unexpected error, because it is a bug in the scripts", async () => {
    const connect = async () => {
      throw new TypeError("driver exploded");
    };

    const result = await run(["read-only"], { env: SECRETS, connect });

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^TypeError: driver exploded\n\s+at /);
  });

  it("prints a thrown value that is not an error", async () => {
    const connect = async () => {
      throw "not an error";
    };

    expect((await run(["read-only"], { env: SECRETS, connect })).stderr).toBe("not an error\n");
  });

  it("prints only the message of an expected failure", async () => {
    const connect = async () => {
      throw new OpsError("Atlas is paused");
    };

    expect((await run(["read-only"], { env: SECRETS, connect })).stderr).toBe("Atlas is paused\n");
  });
});
