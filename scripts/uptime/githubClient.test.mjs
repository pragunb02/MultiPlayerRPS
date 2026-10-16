import { describe, expect, it } from "vitest";

import { OpsError } from "../lib/errors.mjs";
import { fakeFetch } from "../testing/fakeClock.mjs";
import { createGitHubClient } from "./githubClient.mjs";

const json = (/** @type {unknown} */ body, status = 200) => Response.json(body, { status });

/** @param {(url: string, init: RequestInit) => Response} answer */
function client(answer) {
  const { fetch, calls } = fakeFetch(answer);
  const github = createGitHubClient({
    fetch,
    token: "t0ken",
    apiUrl: "https://api.github.com",
    repository: "o/r",
  });
  return { github, calls };
}

describe("GitHub client", () => {
  it("sends authenticated JSON requests to the repository", async () => {
    const { github, calls } = client(() =>
      json({ number: 7, html_url: "https://github.com/o/r/issues/7" }, 201),
    );

    const issue = await github.createIssue({ title: "Site down", body: "b", labels: ["incident"] });

    expect(issue.number).toBe(7);
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/issues");
    expect(calls[0].init).toEqual({
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer t0ken",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Site down", body: "b", labels: ["incident"] }),
    });
  });

  it("sends GET requests without a body", async () => {
    const { github, calls } = client(() => json({ workflow_id: 42 }));

    expect(await github.getRun(9)).toEqual({ workflow_id: 42 });
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/actions/runs/9");
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).not.toHaveProperty("content-type");
  });

  it("lists the latest completed runs of a workflow", async () => {
    const { github, calls } = client(() => json({ workflow_runs: [{ id: 8 }] }));

    expect(await github.listCompletedRuns(42)).toEqual([{ id: 8 }]);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/actions/workflows/42/runs?status=completed&per_page=5",
    );
  });

  it("lists the jobs of a run", async () => {
    const { github, calls } = client(() => json({ jobs: [{ steps: [] }] }));

    expect(await github.listJobs(8)).toEqual([{ steps: [] }]);
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/actions/runs/8/jobs?per_page=100");
  });

  it("lists open issues with a label, oldest first", async () => {
    const { github, calls } = client(() => json([]));

    await github.listOpenIssues("incident");

    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/issues?state=open&labels=incident&sort=created&direction=asc&per_page=100",
    );
  });

  it("updates and comments on issues", async () => {
    const { github, calls } = client(() => json({}));

    await github.updateIssue(7, { state: "closed", state_reason: "completed" });
    await github.comment(7, "Back up");

    expect(calls.map(({ url, init }) => [init.method, url])).toEqual([
      ["PATCH", "https://api.github.com/repos/o/r/issues/7"],
      ["POST", "https://api.github.com/repos/o/r/issues/7/comments"],
    ]);
  });

  it("fails with the status and GitHub's message", async () => {
    const { github } = client(() => new Response("Resource not accessible by integration", { status: 403 }));

    await expect(github.comment(7, "x")).rejects.toThrow(OpsError);
    await expect(github.comment(7, "x")).rejects.toThrow(/answered 403: Resource not accessible/);
  });

  it("creates the label", async () => {
    const { github, calls } = client(() => json({}, 201));

    await github.ensureLabel({ name: "incident", color: "b60205", description: "Production is down" });

    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/labels");
  });

  it("accepts a label that already exists", async () => {
    const { github } = client(() => json({ message: "Validation Failed" }, 422));

    await expect(
      github.ensureLabel({ name: "incident", color: "b60205", description: "" }),
    ).resolves.toBeUndefined();
  });

  it("fails when the label can not be created", async () => {
    const { github } = client(() => new Response("nope", { status: 403 }));

    await expect(github.ensureLabel({ name: "incident", color: "b60205", description: "" })).rejects.toThrow(
      /answered 403: nope/,
    );
  });
});
