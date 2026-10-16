import { annotation, appendSummary, maskCommand, runnerFile, writeOutputs } from "../lib/actions.mjs";
import { parseNamedArgs } from "../lib/args.mjs";
import { OpsError } from "../lib/errors.mjs";
import { backupObjectKey, checkEncryptedArchive } from "./archive.mjs";
import { checkBackupConfig } from "./backupConfig.mjs";
import { checkReadOnly } from "./readOnlyCheck.mjs";
import { formatSummary, restoreBackup, summarizeDatabase } from "./restore.mjs";

/**
 * @typedef {{
 *   argv: readonly string[],
 *   env: Record<string, string | undefined>,
 *   stdout: { write: (text: string) => unknown },
 * }} Invocation
 * @typedef {{
 *   connect: import("./readOnlyCheck.mjs").Connect,
 *   spawn: import("../lib/processes.mjs").Spawn,
 *   now: () => Date,
 * }} Dependencies
 */

const USAGE = `Usage: node scripts/bin/backup.mjs <command>

In the backup workflow:
  config                       skip cleanly when the backup secrets are not set, fail when they are half set
  read-only                    prove BACKUP_MONGO_URI is read only and points at a database with data
  prepare-upload --file <f>    check <f> is age encrypted and choose its bucket key

On your own computer (docs/runbooks/backup-restore.md):
  restore --archive <f> --identity <key> --uri <mongodb://host> --from-db <db> --to-db restore_<name>
  summary --uri <mongodb://host> --db <db>
`;

/**
 * Builds the backup command line. The real tools and the clock are passed in by scripts/bin/backup.mjs, and fakes by
 * the tests.
 *
 * @param {Dependencies} dependencies
 */
export function createBackupCli({ connect, spawn, now }) {
  /** @type {Record<string, (invocation: Invocation) => Promise<void>>} */
  const commands = {
    async config({ argv, env, stdout }) {
      parseNamedArgs({ argv, names: [] });
      const config = checkBackupConfig(env);
      const output = runnerFile(env, "GITHUB_OUTPUT");
      if (!config.configured) {
        stdout.write(
          annotation({
            level: "notice",
            title: "Backup skipped",
            message:
              "Backups are not set up yet, so nothing was backed up. Add the secrets in " +
              `docs/runbooks/backup-restore.md to turn them on: ${config.missing.join(", ")}.`,
          }),
        );
        await writeOutputs({ file: output, outputs: { ready: "false" } });
        return;
      }
      config.masks.forEach((secret) => stdout.write(maskCommand(secret)));
      await writeOutputs({ file: output, outputs: { ready: "true" } });
      stdout.write("Backup secrets are set.\n");
    },

    async "read-only"({ argv, env, stdout }) {
      parseNamedArgs({ argv, names: [] });
      const uri = env.BACKUP_MONGO_URI;
      if (!uri) {
        throw new OpsError("BACKUP_MONGO_URI is not set.");
      }
      const { roles, database, collections } = await checkReadOnly({ uri, connect });
      stdout.write(
        `Read only: yes (${roles.join(", ")}). Database ${database}: ${collections} collections.\n`,
      );
    },

    async "prepare-upload"({ argv, env, stdout }) {
      const { file } = parseNamedArgs({ argv, names: ["file"] });
      const { bytes } = await checkEncryptedArchive(file);
      const key = backupObjectKey(now());
      await writeOutputs({ file: runnerFile(env, "GITHUB_OUTPUT"), outputs: { key } });
      await appendSummary({
        file: runnerFile(env, "GITHUB_STEP_SUMMARY"),
        markdown: `### Backup\n\nEncrypted archive of ${bytes} bytes, uploading as \`${key}\`.`,
      });
      stdout.write(`Encrypted archive is ${bytes} bytes. Key: ${key}\n`);
    },

    async restore({ argv, stdout }) {
      const options = parseNamedArgs({ argv, names: ["archive", "identity", "uri", "from-db", "to-db"] });
      const summary = await restoreBackup({ options, connect, spawn });
      stdout.write(`\nRestored into ${options["to-db"]}:\n${formatSummary(summary)}`);
    },

    async summary({ argv, stdout }) {
      const { uri, db } = parseNamedArgs({ argv, names: ["uri", "db"] });
      stdout.write(formatSummary(await summarizeDatabase({ uri, database: db, connect })));
    },
  };

  /**
   * Runs one command and returns the exit code. Expected failures print just their message. Anything else prints
   * its stack too, because it is a bug in these scripts.
   *
   * @param {Invocation & { stderr: { write: (text: string) => unknown } }} invocation
   * @returns {Promise<number>}
   */
  return async function run({ argv, env, stdout, stderr }) {
    const [name, ...rest] = argv;
    const command = Object.hasOwn(commands, name ?? "") ? commands[/** @type {string} */ (name)] : undefined;
    if (!command) {
      stderr.write(USAGE);
      return 2;
    }
    try {
      await command({ argv: rest, env, stdout });
      return 0;
    } catch (err) {
      const message = err instanceof OpsError ? err.message : String(err instanceof Error ? err.stack : err);
      stderr.write(
        env.GITHUB_ACTIONS === "true"
          ? annotation({ level: "error", title: `backup ${name}`, message })
          : `${message}\n`,
      );
      return 1;
    }
  };
}
