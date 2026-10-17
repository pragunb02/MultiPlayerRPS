import { appendFile } from "node:fs/promises";

import { OpsError } from "./errors.mjs";

// Helpers for talking to the GitHub Actions runner through workflow commands and the files it hands each step.
// See https://docs.github.com/actions/reference/workflow-commands-for-github-actions

/** @param {unknown} value */
function escapeData(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** @param {unknown} value */
function escapeProperty(value) {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/**
 * A line that shows up as a notice, warning or error on the run page.
 *
 * @param {{ level: "notice" | "warning" | "error", title: string, message: string }} annotation
 */
export function annotation({ level, title, message }) {
  return `::${level} title=${escapeProperty(title)}::${escapeData(message)}\n`;
}

/**
 * Tells the runner to hide this value in every later log line of the job. The runner swallows the line itself.
 *
 * @param {string} secret
 */
export function maskCommand(secret) {
  return `::add-mask::${escapeData(secret)}\n`;
}

/**
 * Reads the path of one of the runner's step files. Fails when it is missing, so a command never quietly drops its
 * result when it is run outside a workflow.
 *
 * @param {Record<string, string | undefined>} env
 * @param {"GITHUB_OUTPUT" | "GITHUB_STEP_SUMMARY"} name
 */
export function runnerFile(env, name) {
  const file = env[name];
  if (!file) {
    throw new OpsError(`${name} is not set. Run this inside GitHub Actions, or set ${name} to a file path.`);
  }
  return file;
}

/**
 * Sets step outputs that later steps read as steps.<id>.outputs.<name>.
 *
 * @param {{ file: string, outputs: Record<string, string> }} params
 */
export async function writeOutputs({ file, outputs }) {
  const lines = Object.entries(outputs).map(([name, value]) => {
    if (/[\r\n]/.test(value)) {
      throw new OpsError(`Output ${name} must be a single line.`);
    }
    return `${name}=${value}\n`;
  });
  await appendFile(file, lines.join(""));
}

/**
 * Adds Markdown to the summary shown on the run page.
 *
 * @param {{ file: string, markdown: string }} params
 */
export async function appendSummary({ file, markdown }) {
  await appendFile(file, `${markdown}\n`);
}
