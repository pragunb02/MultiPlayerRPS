/**
 * What the uptime monitor does with the incident issue, and what it writes in it. Pure functions, so every case is
 * tested without GitHub.
 */

export const INCIDENT_LABEL = "incident";

/** Marks issues this monitor opened, so it never edits or closes an incident someone filed by hand. */
export const MARKER = "<!-- classicade-uptime-monitor -->";

/**
 * The name of the workflow step that runs only when the site is down. The next run reads it from this run's job to
 * learn whether the previous check failed. Keep it the same as the step name in .github/workflows/uptime.yml.
 */
export const DOWN_STEP_NAME = "Site is down";

const STATE = /<!-- uptime-state (\{.*\}) -->/;

/**
 * @typedef {import("./probe.mjs").CheckResult} CheckResult
 * @typedef {{ firstFailureAt: string, failedChecks: number }} IncidentState
 */

/**
 * Reads the state the monitor keeps in the issue body. If someone edited it away, the issue's creation time stands
 * in for the first failure, which is at most one check later than the real one.
 *
 * @param {{ body: string, createdAt: string }} issue
 * @returns {IncidentState}
 */
export function readIncidentState({ body, createdAt }) {
  const parsed = parseState(body);
  const valid = typeof parsed.firstFailureAt === "string" && Number.isInteger(parsed.failedChecks);
  return valid
    ? { firstFailureAt: parsed.firstFailureAt, failedChecks: parsed.failedChecks }
    : { firstFailureAt: createdAt, failedChecks: 1 };
}

/** @param {string} body @returns {Record<string, unknown>} */
function parseState(body) {
  const match = STATE.exec(body);
  try {
    return match ? JSON.parse(match[1]) : {};
  } catch {
    // Hand edited into something that is not JSON. Treated like a missing state.
    return {};
  }
}

/** @param {number} ms */
function minutes(ms) {
  return Math.max(1, Math.round(ms / 60_000));
}

/** @param {readonly CheckResult[]} results */
export function formatResults(results) {
  return results
    .map(({ name, url, ok, ms, attempts }) => {
      const lines = attempts.map(
        ({ at, ms: took, outcome }, i) => `  - attempt ${i + 1} at ${at}: ${outcome} (${took} ms)`,
      );
      return [`- **${name}** ${ok ? "up" : "DOWN"} after ${ms} ms, ${url}`, ...lines].join("\n");
    })
    .join("\n");
}

/** @param {readonly CheckResult[]} results */
function failingNames(results) {
  return results.filter(({ ok }) => !ok).map(({ name }) => name);
}

/**
 * The incident issue body, rewritten on every failed check while it is open.
 *
 * @param {{ baseUrl: string, state: IncidentState, checkedAt: string, runUrl: string, results: readonly CheckResult[] }} params
 */
export function incidentBody({ baseUrl, state, checkedAt, runUrl, results }) {
  return [
    MARKER,
    `<!-- uptime-state ${JSON.stringify({ firstFailureAt: state.firstFailureAt, failedChecks: state.failedChecks })} -->`,
    `**${baseUrl} is down.** Failing: ${failingNames(results).join(", ")}.`,
    "",
    "| | |",
    "| --- | --- |",
    `| First failed check | ${state.firstFailureAt} |`,
    `| Latest failed check | ${checkedAt} ([run](${runUrl})) |`,
    `| Failed checks in a row | ${state.failedChecks} |`,
    `| Down for at least | ${minutes(Date.parse(checkedAt) - Date.parse(state.firstFailureAt))} min |`,
    "",
    "Latest check:",
    "",
    formatResults(results),
    "",
    "The uptime workflow (docs/DEPLOYMENT.md, Uptime monitoring) closes this issue when the site answers again. " +
      "What to check first: Render events and logs, and whether the Atlas cluster is paused.",
  ].join("\n");
}

/** @param {{ baseUrl: string, failingSince: string }} params */
export function incidentTitle({ baseUrl, failingSince }) {
  return `Site down: ${new URL(baseUrl).host} not answering since ${failingSince.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The comment left when the site is back, just before the issue is closed.
 *
 * @param {{ state: IncidentState, checkedAt: string, runUrl: string, results: readonly CheckResult[] }} params
 */
export function recoveryComment({ state, checkedAt, runUrl, results }) {
  const down = minutes(Date.parse(checkedAt) - Date.parse(state.firstFailureAt));
  return [
    `**Back up** at ${checkedAt} ([run](${runUrl})), about ${down} min after the first failed check ` +
      `(${state.firstFailureAt}, ${state.failedChecks} failed checks in a row).`,
    "",
    formatResults(results),
  ].join("\n");
}
