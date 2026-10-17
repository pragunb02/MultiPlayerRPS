import { OpsError } from "../lib/errors.mjs";

/**
 * The few GitHub REST calls the uptime monitor makes, with the workflow's own token. The workflow lets that token
 * write issues of this repository and nothing else.
 *
 * @typedef {{ number: number, body: string | null, created_at: string }} Issue
 * @typedef {{ id: number, run_started_at: string }} WorkflowRun
 * @typedef {{ steps?: readonly { name: string, conclusion: string | null }[] }} Job
 */

/**
 * @param {{ fetch: typeof fetch, token: string, apiUrl: string, repository: string }} params
 */
export function createGitHubClient({ fetch, token, apiUrl, repository }) {
  /**
   * @param {string} method
   * @param {string} path  relative to the repository
   * @param {object} [body]
   */
  function send(method, path, body) {
    return fetch(`${apiUrl}/repos/${repository}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {object} [body]
   */
  async function request(method, path, body) {
    const response = await send(method, path, body);
    if (!response.ok) {
      throw new OpsError(`GitHub ${method} ${path} answered ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  return Object.freeze({
    /** @param {number} runId @returns {Promise<{ workflow_id: number }>} */
    getRun: (runId) => request("GET", `/actions/runs/${runId}`),

    /** @param {number} workflowId @returns {Promise<readonly WorkflowRun[]>} newest first */
    async listCompletedRuns(workflowId) {
      const path = `/actions/workflows/${workflowId}/runs?status=completed&per_page=5`;
      return (await request("GET", path)).workflow_runs;
    },

    /** @param {number} runId @returns {Promise<readonly Job[]>} */
    async listJobs(runId) {
      return (await request("GET", `/actions/runs/${runId}/jobs?per_page=100`)).jobs;
    },

    /** @param {string} label @returns {Promise<readonly Issue[]>} oldest first */
    listOpenIssues: (label) =>
      request(
        "GET",
        `/issues?state=open&labels=${encodeURIComponent(label)}&sort=created&direction=asc&per_page=100`,
      ),

    /**
     * Creates the label. GitHub answers 422 when it already exists, which is just as good.
     *
     * @param {{ name: string, color: string, description: string }} label
     */
    async ensureLabel(label) {
      const response = await send("POST", "/labels", label);
      if (!response.ok && response.status !== 422) {
        throw new OpsError(`GitHub POST /labels answered ${response.status}: ${await response.text()}`);
      }
    },

    /** @param {{ title: string, body: string, labels: readonly string[] }} issue @returns {Promise<{ number: number, html_url: string }>} */
    createIssue: (issue) => request("POST", "/issues", issue),

    /** @param {number} number @param {{ title?: string, body?: string, state?: "closed", state_reason?: "completed" }} changes */
    updateIssue: (number, changes) => request("PATCH", `/issues/${number}`, changes),

    /** @param {number} number @param {string} body */
    comment: (number, body) => request("POST", `/issues/${number}/comments`, { body }),
  });
}
