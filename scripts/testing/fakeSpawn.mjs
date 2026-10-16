import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

/**
 * A spawn that records each command and finishes it with the exit code given for that command name, so the commands
 * a script would run can be checked without the tools installed.
 *
 * @param {Record<string, number>} [exitCodes] by command name, 0 when not listed
 */
export function fakeSpawn(exitCodes = {}) {
  /** @type {{ command: string, args: readonly string[] }[]} */
  const calls = [];
  const spawn = /** @type {any} */ (
    (/** @type {string} */ command, /** @type {readonly string[]} */ args) => {
      calls.push({ command, args });
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough() });
      setImmediate(() => child.emit("close", exitCodes[command] ?? 0, null));
      return child;
    }
  );
  return { spawn, calls };
}
