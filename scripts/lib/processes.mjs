import { OpsError } from "./errors.mjs";

/**
 * @typedef {{ command: string, args: readonly string[] }} Command
 * @typedef {typeof import("node:child_process").spawn} Spawn
 */

/**
 * Resolves when the process exits cleanly and rejects with a readable reason otherwise.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {string} command
 * @returns {Promise<void>}
 */
function exited(child, command) {
  return new Promise((resolve, reject) => {
    child.once("error", (err) => {
      const reason =
        /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT" ? "is not installed" : "failed";
      reject(
        new OpsError(`${command} ${reason}. See docs/runbooks/backup-restore.md for the tools.`, {
          cause: err,
        }),
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new OpsError(`${command} stopped with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
      }
    });
  });
}

/**
 * Runs one command with its output and errors shown in this terminal.
 *
 * @param {{ spawn: Spawn, command: Command }} params
 */
export function runCommand({ spawn, command }) {
  return exited(
    spawn(command.command, command.args, { stdio: ["ignore", "inherit", "inherit"] }),
    command.command,
  );
}

/**
 * Runs "producer | consumer". The bytes flow from one process straight into the other, so a decrypted backup is
 * never written to disk or held in this process's memory.
 *
 * @param {{ spawn: Spawn, producer: Command, consumer: Command }} params
 */
export async function runPiped({ spawn, producer, consumer }) {
  const first = spawn(producer.command, producer.args, { stdio: ["ignore", "pipe", "inherit"] });
  const second = spawn(consumer.command, consumer.args, { stdio: [first.stdout, "inherit", "inherit"] });
  // The consumer now holds its own copy of the pipe. Ours would keep the producer from ever counting as closed.
  first.stdout?.destroy();
  // Wait for both, so neither is left running. When one side fails the other usually fails too, and the real cause
  // can be either, so every failure is reported.
  const results = await Promise.allSettled([
    exited(first, producer.command),
    exited(second, consumer.command),
  ]);
  const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (failures.length > 0) {
    throw new OpsError(failures.map((failure) => failure.message).join(" "), { cause: failures[0] });
  }
}
