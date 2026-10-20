// Folds the changelog fragments in docs/changes into docs/PROGRESS.md and docs/BACKLOG.md, then deletes them
// (CC-299, ADR-068). The coordinator runs it on a fresh main and opens the result as a docs pull request.
//
//   node scripts/bin/collect-changes.mjs                    fold, format with Prettier, delete the fragments
//   node scripts/bin/collect-changes.mjs --check            check every fragment and fold in memory only
//   node scripts/bin/collect-changes.mjs --check --base REF also fail on a changelog edited by hand since REF
//
// This file only reads and writes files and asks git. The behaviour lives in scripts/changes/collectChanges.mjs,
// where it is tested. git runs without a shell and the ref is checked before it is passed on.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

import {
  CHANGES_FOLDER,
  collectChanges,
  guardChangelog,
  parseFragment,
  parseOptions,
  withMergedPr,
} from "../changes/collectChanges.mjs";
import { OpsError } from "../lib/errors.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROGRESS = "docs/PROGRESS.md";
const BACKLOG = "docs/BACKLOG.md";
const README = "README.md";

const git = (/** @type {string[]} */ args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const read = (/** @type {string} */ file) => readFileSync(path.join(root, file), "utf8");

const fragmentNames = () =>
  readdirSync(path.join(root, CHANGES_FOLDER))
    .filter((name) => name !== README)
    .sort();

const formatted = async (/** @type {string} */ file, /** @type {string} */ text) => {
  const filepath = path.join(root, file);
  return format(text, { ...(await resolveConfig(filepath)), filepath });
};

/** The fragments main had at the ref that this pull request deletes. */
const removedSince = (/** @type {string} */ base) => {
  const now = new Set(fragmentNames());
  // With a path instead of a tree, a ref from before docs/changes existed lists nothing instead of failing.
  return git(["ls-tree", "--name-only", base, "--", `${CHANGES_FOLDER}/`])
    .split("\n")
    .map((file) => path.posix.basename(file))
    .filter((name) => name !== "" && name !== README && !now.has(name))
    .map((name) => parseFragment({ name, text: git(["show", `${base}:${CHANGES_FOLDER}/${name}`]) }));
};

const main = async () => {
  const { check, base } = parseOptions(process.argv.slice(2));
  const names = fragmentNames();
  const parsed = names.map((name) => parseFragment({ name, text: read(`${CHANGES_FOLDER}/${name}`) }));
  // The merge commit on main that added each fragment names its pull request. A check needs no number.
  const fragments = check
    ? parsed
    : parsed.map((fragment, index) =>
        withMergedPr({
          fragment,
          subject: git([
            "log",
            "--first-parent",
            "--diff-filter=A",
            "--format=%s",
            "-1",
            "--",
            `${CHANGES_FOLDER}/${names[index]}`,
          ]).trim(),
        }),
      );
  const ticketFiles = readdirSync(path.join(root, "docs/tickets"));
  const before = { progress: read(PROGRESS), backlog: read(BACKLOG) };
  const folded = collectChanges({ ...before, fragments, ticketFiles });
  const after = {
    progress: await formatted(PROGRESS, folded.progress),
    backlog: await formatted(BACKLOG, folded.backlog),
  };

  if (check) {
    const problems =
      base === ""
        ? []
        : guardChangelog({
            baseProgress: git(["show", `${base}:${PROGRESS}`]),
            headProgress: before.progress,
            removed: removedSince(base),
          });
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    if (problems.length > 0) {
      process.stderr.write(
        `Add a fragment, ${CHANGES_FOLDER}/CC-###.md, instead (${CHANGES_FOLDER}/README.md).\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${names.length} changelog fragment(s) are valid and fold cleanly.\n`);
    return;
  }

  if (after.progress !== before.progress) writeFileSync(path.join(root, PROGRESS), after.progress);
  if (after.backlog !== before.backlog) writeFileSync(path.join(root, BACKLOG), after.backlog);
  for (const name of names) rmSync(path.join(root, CHANGES_FOLDER, name));
  process.stdout.write(
    `Folded ${names.length} fragment(s) into ${PROGRESS} and ${BACKLOG}: ${names.join(", ")}\n`,
  );
};

main().catch((error) => {
  if (!(error instanceof OpsError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
