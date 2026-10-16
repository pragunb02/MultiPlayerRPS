import { annotation, appendSummary, runnerFile, writeOutputs } from "../lib/actions.mjs";
import { OpsError } from "../lib/errors.mjs";
import { createGitHubClient } from "./githubClient.mjs";
import {
  DOWN_STEP_NAME,
  INCIDENT_LABEL,
  MARKER,
  formatResults,
  incidentBody,
  incidentTitle,
  readIncidentState,
  recoveryComment,
} from "./incident.mjs";
import { checkSite } from "./probe.mjs";

/**
 * @typedef {Record<string, string | undefined>} Env
 * @typedef {ReturnType<typeof createGitHubClient>} GitHub
 * @typedef {{ write: (text: string) => unknown }} Output
 * @typedef {{
 *   env: Env,
 *   fetch: typeof fetch,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<void>,
 *   stdout: Output,
 *   stderr: Output,
 * }} MonitorDependencies
 */

/** @param {Env} env @param {string} name */
function required(env, name) {
  const value = env[name];
  if (!value) {
    throw new OpsError(`${name} is not set. The uptime workflow sets it.`);
  }
  return value;
}

/**
 * Whether the run before this one found the site down. A run records that by running its "Site is down" step, which
 * GitHub keeps with the run, so the monitor needs no storage of its own.
 *
 * @param {{ github: GitHub, runId: number }} params
 * @returns {Promise<{ down: false } | { down: true, at: string }>}
 */
export async function previousCheck({ github, runId }) {
  const { workflow_id } = await github.getRun(runId);
  const previous = (await github.listCompletedRuns(workflow_id)).find(({ id }) => id !== runId);
  if (!previous) {
    return { down: false };
  }
  const jobs = await github.listJobs(previous.id);
  const down = jobs.some(({ steps = [] }) =>
    steps.some(({ name, conclusion }) => name === DOWN_STEP_NAME && conclusion === "success"),
  );
  return down ? { down: true, at: previous.run_started_at } : { down: false };
}

/**
 * One uptime check: probe the site, then open, update or close the incident issue.
 *
 * @param {Omit<MonitorDependencies, "stderr">} dependencies
 */
export async function monitorOnce({ env, fetch, now, sleep, stdout }) {
  const baseUrl = required(env, "UPTIME_BASE_URL");
  const repository = required(env, "GITHUB_REPOSITORY");
  const runId = Number(required(env, "GITHUB_RUN_ID"));
  const runUrl = `${required(env, "GITHUB_SERVER_URL")}/${repository}/actions/runs/${runId}`;
  const output = runnerFile(env, "GITHUB_OUTPUT");
  const summary = runnerFile(env, "GITHUB_STEP_SUMMARY");
  const github = createGitHubClient({
    fetch,
    token: required(env, "GITHUB_TOKEN"),
    apiUrl: required(env, "GITHUB_API_URL"),
    repository,
  });

  const { up, results } = await checkSite({ baseUrl, fetch, now, sleep });
  const checkedAt = new Date(now()).toISOString();
  stdout.write(`${baseUrl} is ${up ? "up" : "DOWN"}.\n${formatResults(results)}\n`);
  await writeOutputs({ file: output, outputs: { state: up ? "up" : "down" } });
  await appendSummary({ file: summary, markdown: `### ${up ? "Up" : "Down"}\n\n${formatResults(results)}` });

  const incident = (await github.listOpenIssues(INCIDENT_LABEL)).find(({ body }) => body?.includes(MARKER));
  if (up && !incident) {
    return "none";
  }
  if (incident) {
    const known = readIncidentState({
      body: /** @type {string} */ (incident.body),
      createdAt: incident.created_at,
    });
    if (up) {
      await github.comment(incident.number, recoveryComment({ state: known, checkedAt, runUrl, results }));
      await github.updateIssue(incident.number, { state: "closed", state_reason: "completed" });
      stdout.write(`Back up. Closed incident #${incident.number}.\n`);
      return "close";
    }
    const state = { ...known, failedChecks: known.failedChecks + 1 };
    await github.updateIssue(incident.number, {
      body: incidentBody({ baseUrl, state, checkedAt, runUrl, results }),
    });
    stdout.write(`Still down. Updated incident #${incident.number}.\n`);
    return "update";
  }
  // One failed check could be a blip, so an incident opens only when two checks in a row fail.
  const previous = await previousCheck({ github, runId });
  if (!previous.down) {
    const message = "First failed check. An incident opens if the next check fails too.";
    stdout.write(annotation({ level: "warning", title: "Site down", message }));
    return "watch";
  }
  const state = { firstFailureAt: previous.at, failedChecks: 2 };
  await github.ensureLabel({ name: INCIDENT_LABEL, color: "b60205", description: "Production is down" });
  const issue = await github.createIssue({
    title: incidentTitle({ baseUrl, failingSince: state.firstFailureAt }),
    body: incidentBody({ baseUrl, state, checkedAt, runUrl, results }),
    labels: [INCIDENT_LABEL],
  });
  stdout.write(annotation({ level: "error", title: "Incident opened", message: issue.html_url }));
  return "open";
}

/**
 * Runs one check and returns the exit code. A down site is not a failure of this job, because the incident issue
 * reports it. The job fails only when the monitor itself is broken, and GitHub emails the owner about that.
 *
 * @param {MonitorDependencies} dependencies
 */
export async function runUptimeMonitor({ stderr, ...dependencies }) {
  try {
    await monitorOnce(dependencies);
    return 0;
  } catch (err) {
    const message = err instanceof OpsError ? err.message : String(err instanceof Error ? err.stack : err);
    stderr.write(annotation({ level: "error", title: "Uptime monitor failed", message }));
    return 1;
  }
}
