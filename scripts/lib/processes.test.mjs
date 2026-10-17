import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpsError } from "./errors.mjs";
import { runCommand, runPiped } from "./processes.mjs";

// Real child processes, all of them this same Node binary, so the tests need nothing installed.
const node = (/** @type {string} */ code) => ({ command: process.execPath, args: ["-e", code] });
const missing = { command: "classicade-no-such-tool", args: [] };

describe("runCommand", () => {
  it("resolves when the command exits cleanly", async () => {
    await expect(runCommand({ spawn, command: node("process.exit(0)") })).resolves.toBeUndefined();
  });

  it("rejects with the exit code", async () => {
    await expect(runCommand({ spawn, command: node("process.exit(4)") })).rejects.toThrow("exit code 4");
  });

  it("rejects with the signal when the command is killed", async () => {
    const command = node("process.kill(process.pid, 'SIGTERM')");

    await expect(runCommand({ spawn, command })).rejects.toThrow("signal SIGTERM");
  });

  it("says when a tool is not installed", async () => {
    await expect(runCommand({ spawn, command: missing })).rejects.toThrow(/is not installed/);
  });

  it("reports other start failures", async () => {
    // A process that can not start for a reason other than a missing binary, such as a file without execute rights.
    const fakeSpawn = /** @type {any} */ (
      () => {
        const child = new EventEmitter();
        queueMicrotask(() =>
          child.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" })),
        );
        return child;
      }
    );

    await expect(runCommand({ spawn: fakeSpawn, command: missing })).rejects.toThrow(
      /classicade-no-such-tool failed/,
    );
  });
});

describe("runPiped", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-pipe-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("streams the producer's output into the consumer", async () => {
    const out = join(dir, "out");

    await runPiped({
      spawn,
      producer: node("process.stdout.write('backup bytes')"),
      consumer: node(`process.stdin.pipe(require('fs').createWriteStream(${JSON.stringify(out)}))`),
    });

    expect(await readFile(out, "utf8")).toBe("backup bytes");
  });

  it("fails when the producer fails, after the consumer has finished", async () => {
    const promise = runPiped({
      spawn,
      producer: node("process.exit(3)"),
      consumer: node("process.stdin.resume()"),
    });

    await expect(promise).rejects.toThrow(OpsError);
    await expect(promise).rejects.toThrow("exit code 3");
  });

  it("reports every failure when both sides fail", async () => {
    const promise = runPiped({ spawn, producer: missing, consumer: node("process.exit(5)") });

    await expect(promise).rejects.toThrow(/is not installed.*exit code 5/);
  });
});
