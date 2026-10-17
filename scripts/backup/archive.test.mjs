import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpsError } from "../lib/errors.mjs";
import { AGE_HEADER, backupObjectKey, checkEncryptedArchive } from "./archive.mjs";

describe("backupObjectKey", () => {
  it("names the backup after the time it was taken, without characters some stores reject", () => {
    expect(backupObjectKey(new Date("2026-10-16T02:23:05.123Z"))).toBe(
      "mongo/classicade-2026-10-16T02-23-05Z.archive.gz.age",
    );
  });
});

describe("checkEncryptedArchive", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-archive-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  /** @param {string | Buffer} content */
  async function fileWith(content) {
    const path = join(dir, "backup.age");
    await writeFile(path, content);
    return path;
  }

  it("accepts an age file and reports its size", async () => {
    const path = await fileWith(Buffer.concat([Buffer.from(AGE_HEADER), Buffer.alloc(1000, 7)]));

    expect(await checkEncryptedArchive(path)).toEqual({ bytes: AGE_HEADER.length + 1000 });
  });

  it("refuses a plain dump, so unencrypted data is never uploaded", async () => {
    const path = await fileWith(Buffer.alloc(2000, 0x1f));

    await expect(checkEncryptedArchive(path)).rejects.toThrow(/not an age encrypted file/);
  });

  it("refuses an armored age file, because the pipeline writes binary ones", async () => {
    const path = await fileWith(`-----BEGIN AGE ENCRYPTED FILE-----\n${"x".repeat(1000)}`);

    await expect(checkEncryptedArchive(path)).rejects.toThrow(OpsError);
  });

  it("refuses an encrypted file too small to hold a dump", async () => {
    const path = await fileWith(`${AGE_HEADER}-> X25519 abc\n`);

    await expect(checkEncryptedArchive(path)).rejects.toThrow(/too small/);
  });

  it("refuses an empty file", async () => {
    const path = await fileWith("");

    await expect(checkEncryptedArchive(path)).rejects.toThrow(/not an age encrypted file/);
  });
});
