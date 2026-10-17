// Usage: node scripts/comment-only-diff.mjs <base> [folder ...]
// Checks that the changes since <base> (for example `origin/main`) in the given folders only touch comments.
// Every changed JavaScript or CSS file must keep exactly the same code tokens. Other files fail the check, because
// nothing proves they are comment changes. The comparison lives in scripts/commentOnly.mjs, where it is tested.
/* eslint-disable no-console */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { filesWithCodeChanges, isCheckable } from "./commentOnly.mjs";

const [base, ...folders] = process.argv.slice(2);
if (base === undefined) {
  console.error("Usage: node scripts/comment-only-diff.mjs <base> [folder ...]");
  process.exit(2);
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const changed = git("diff", "--name-status", "--no-renames", base, "--", ...folders)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"));

const notModified = changed.filter(([status]) => status !== "M").map(([status, path]) => `${status} ${path}`);
const modified = changed.filter(([status]) => status === "M").map(([, path]) => path);
const unreadable = modified.filter((path) => !isCheckable(path));
const files = modified
  .filter(isCheckable)
  .map((path) => ({ path, before: git("show", `${base}:${path}`), after: readFileSync(path, "utf8") }));
const codeChanged = filesWithCodeChanges(files);

const failures = [
  ...notModified.map((entry) => `added or removed: ${entry}`),
  ...unreadable.map((path) => `not JavaScript or CSS: ${path}`),
  ...codeChanged.map((path) => `code changed: ${path}`),
];
console.log(
  `${files.length} changed files compared, ${files.length - codeChanged.length} change only comments.`,
);
for (const failure of failures) console.error(failure);
process.exitCode = failures.length === 0 ? 0 : 1;
