import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fakeClock, fakeFetch } from "../testing/fakeClock.mjs";
import { DOWN_STEP_NAME, MARKER, incidentBody } from "./incident.mjs";
import { monitorOnce, runUptimeMonitor } from "./monitor.mjs";

const SITE = "https://nocapgaming.onrender.com";
const API = "https://api.github.com/repos/o/r";
const RUN_ID = 900;
const HEALTHY = '{"status":"ok","database":"up"}';

/**
 * @typedef {{ number: number, body: string, created_at: string, state: string, comments: string[], title?: string }} FakeIssue
 */

/**
 * The site and the GitHub API as one fetch, with GitHub's issues and runs held in memory.
 *
 * @param {{
 *   siteUp: boolean,
 *   previousRuns?: { id: number, run_started_at: string, down: boolean }[],
 *   issues?: FakeIssue[],
 *   labelExists?: boolean,
 * }} world
 */
function fakeWorld({ siteUp, previousRuns = [], issues = [], labelExists = true }) {
  const state = { issues, labels: labelExists ? ["incident"] : /** @type {string[]} */ ([]) };
  const { fetch, calls } = fakeFetch(async (url, init) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.startsWith(SITE)) {
      if (!siteUp) {
        return new Response("", { status: 503 });
      }
      return url.endsWith("/health")
        ? new Response(HEALTHY)
        : new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
    }
    const path = url.slice(API.length);
    if (path === `/actions/runs/${RUN_ID}`) {
      return Response.json({ workflow_id: 42 });
    }
    if (path.startsWith("/actions/workflows/42/runs")) {
      const inProgress = { id: RUN_ID, run_started_at: "2026-10-16T10:10:00Z" };
      return Response.json({ workflow_runs: [inProgress, ...previousRuns] });
    }
    const jobs = /^\/actions\/runs\/(\d+)\/jobs/.exec(path);
    if (jobs) {
      const run = previousRuns.find(({ id }) => id === Number(jobs[1]));
      const conclusion = run?.down ? "success" : "skipped";
      return Response.json({
        jobs: [
          {
            steps: [
              { name: "Set up job", conclusion: "success" },
              { name: DOWN_STEP_NAME, conclusion },
            ],
          },
          {},
        ],
      });
    }
    if (path.startsWith("/issues?")) {
      return Response.json(state.issues.filter((issue) => issue.state === "open"));
    }
    if (path === "/labels") {
      if (state.labels.includes(body.name)) {
        return Response.json({ message: "Validation Failed" }, { status: 422 });
      }
      state.labels.push(body.name);
      return Response.json(body, { status: 201 });
    }
    if (path === "/issues" && method === "POST") {
      const issue = {
        number: state.issues.length + 1,
        created_at: "2026-10-16T10:10:30Z",
        state: "open",
        comments: [],
        ...body,
      };
      state.issues.push(issue);
      return Response.json(
        { ...issue, html_url: `https://github.com/o/r/issues/${issue.number}` },
        { status: 201 },
      );
    }
    const issuePath = /^\/issues\/(\d+)(\/comments)?$/.exec(path);
    if (issuePath) {
      const issue = /** @type {FakeIssue} */ (
        state.issues.find(({ number }) => number === Number(issuePath[1]))
      );
      if (issuePath[2]) {
        issue.comments.push(body.body);
      } else {
        Object.assign(issue, body);
      }
      return Response.json(issue);
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
  return { fetch, calls, state };
}

function capture() {
  const chunks = /** @type {string[]} */ ([]);
  return { write: (/** @type {string} */ text) => chunks.push(text), text: () => chunks.join("") };
}

/** @param {{ firstFailureAt: string, failedChecks: number }} incidentState */
function openIncident(incidentState) {
  const body = incidentBody({
    baseUrl: SITE,
    state: incidentState,
    checkedAt: incidentState.firstFailureAt,
    runUrl: "r",
    results: [],
  });
  return { number: 1, body, created_at: "2026-10-16T09:50:30Z", state: "open", comments: [] };
}

describe("uptime monitor", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-uptime-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  /** @param {Record<string, string>} [overrides] */
  const env = (overrides = {}) => ({
    UPTIME_BASE_URL: SITE,
    GITHUB_REPOSITORY: "o/r",
    GITHUB_RUN_ID: String(RUN_ID),
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_TOKEN: "t0ken",
    GITHUB_OUTPUT: join(dir, "output"),
    GITHUB_STEP_SUMMARY: join(dir, "summary"),
    ...overrides,
  });

  /** @param {ReturnType<typeof fakeWorld>} world */
  async function check(world) {
    const stdout = capture();
    const clock = fakeClock("2026-10-16T10:10:00Z");
    const action = await monitorOnce({ env: env(), fetch: world.fetch, ...clock, stdout });
    return { action, stdout: stdout.text(), output: await readFile(join(dir, "output"), "utf8") };
  }

  it("does nothing more than record the state when the site is up and there is no incident", async () => {
    const world = fakeWorld({ siteUp: true });

    const { action, output, stdout } = await check(world);

    expect(action).toBe("none");
    expect(output).toBe("state=up\n");
    expect(stdout).toMatch(/^https:\/\/nocapgaming.onrender.com is up\./);
    expect(await readFile(join(dir, "summary"), "utf8")).toMatch(/^### Up/);
    expect(world.calls.filter(({ url }) => url.includes("/actions/"))).toEqual([]);
  });

  it("only warns on the first failed check, because one failure could be a blip", async () => {
    const world = fakeWorld({
      siteUp: false,
      previousRuns: [{ id: 899, run_started_at: "2026-10-16T10:00:00Z", down: false }],
    });

    const { action, output, stdout } = await check(world);

    expect(action).toBe("watch");
    expect(output).toBe("state=down\n");
    expect(stdout).toContain("::warning title=Site down::First failed check.");
    expect(world.state.issues).toEqual([]);
  });

  it("treats the very first run of the workflow as following an up check", async () => {
    expect((await check(fakeWorld({ siteUp: false }))).action).toBe("watch");
  });

  it("opens a labelled incident with timings when the check before also failed", async () => {
    const world = fakeWorld({
      siteUp: false,
      labelExists: false,
      previousRuns: [{ id: 899, run_started_at: "2026-10-16T10:00:00Z", down: true }],
    });

    const { action, stdout } = await check(world);

    expect(action).toBe("open");
    expect(world.state.labels).toEqual(["incident"]);
    const [issue] = world.state.issues;
    expect(issue.title).toBe("Site down: nocapgaming.onrender.com not answering since 2026-10-16 10:00 UTC");
    expect(issue).toMatchObject({ labels: ["incident"], state: "open" });
    expect(issue.body).toContain("| First failed check | 2026-10-16T10:00:00Z |");
    expect(issue.body).toContain("| Failed checks in a row | 2 |");
    expect(issue.body).toContain("attempt 1 at 2026-10-16T10:10:00.000Z: HTTP 503");
    expect(issue.body).toContain("https://github.com/o/r/actions/runs/900");
    expect(stdout).toContain("::error title=Incident opened::https://github.com/o/r/issues/1");
  });

  it("updates the open incident while the site stays down, without asking about earlier runs", async () => {
    const world = fakeWorld({
      siteUp: false,
      issues: [openIncident({ firstFailureAt: "2026-10-16T09:50:00Z", failedChecks: 2 })],
    });

    const { action } = await check(world);

    expect(action).toBe("update");
    expect(world.state.issues[0].body).toContain("| Failed checks in a row | 3 |");
    expect(world.state.issues[0].body).toContain("| Down for at least | 22 min |");
    expect(world.calls.filter(({ url }) => url.includes("/actions/"))).toEqual([]);
  });

  it("comments with the outage length and closes the incident when the site is back", async () => {
    const world = fakeWorld({
      siteUp: true,
      issues: [openIncident({ firstFailureAt: "2026-10-16T09:50:00Z", failedChecks: 2 })],
    });

    const { action } = await check(world);

    expect(action).toBe("close");
    expect(world.state.issues[0]).toMatchObject({ state: "closed", state_reason: "completed" });
    expect(world.state.issues[0].comments[0]).toMatch(
      /^\*\*Back up\*\* at 2026-10-16T10:10:00.000Z.*about 20 min/,
    );
  });

  it("leaves incidents filed by hand alone", async () => {
    const manual = {
      number: 5,
      body: "Chess clocks are broken",
      created_at: "2026-10-16T09:00:00Z",
      state: "open",
      comments: [],
    };
    const nobody = {
      number: 6,
      body: /** @type {any} */ (null),
      created_at: "2026-10-16T09:00:00Z",
      state: "open",
      comments: [],
    };
    const world = fakeWorld({ siteUp: true, issues: [manual, nobody] });

    expect((await check(world)).action).toBe("none");
    expect(manual.state).toBe("open");
  });

  it("recognises its own incident by the marker", () => {
    expect(openIncident({ firstFailureAt: "2026-10-16T09:50:00Z", failedChecks: 2 }).body).toContain(MARKER);
  });

  it("handles an incident whose body lost its state", async () => {
    const world = fakeWorld({
      siteUp: false,
      issues: [{ ...openIncident({ firstFailureAt: "x", failedChecks: 1 }), body: MARKER }],
    });

    await check(world);

    expect(world.state.issues[0].body).toContain("| First failed check | 2026-10-16T09:50:30Z |");
  });

  describe("runUptimeMonitor", () => {
    it("exits 0 when the site is down, because the incident issue reports it", async () => {
      const world = fakeWorld({ siteUp: false });
      const stderr = capture();

      const code = await runUptimeMonitor({
        env: env(),
        fetch: world.fetch,
        ...fakeClock("2026-10-16T10:10:00Z"),
        stdout: capture(),
        stderr,
      });

      expect(code).toBe(0);
      expect(stderr.text()).toBe("");
    });

    it("exits 1 with an error annotation when it is not run by the workflow", async () => {
      const stderr = capture();

      const code = await runUptimeMonitor({
        env: env({ UPTIME_BASE_URL: "" }),
        fetch: fakeWorld({ siteUp: true }).fetch,
        ...fakeClock("2026-10-16T10:10:00Z"),
        stdout: capture(),
        stderr,
      });

      expect(code).toBe(1);
      expect(stderr.text()).toBe(
        "::error title=Uptime monitor failed::UPTIME_BASE_URL is not set. The uptime workflow sets it.\n",
      );
    });

    it("exits 1 with the stack when something unexpected breaks", async () => {
      const stderr = capture();
      const fetch = /** @type {typeof globalThis.fetch} */ (
        async () => {
          throw new RangeError("boom");
        }
      );
      const world = fakeWorld({ siteUp: true });
      const failingGitHub = /** @type {typeof globalThis.fetch} */ (
        async (url, init) => (String(url).startsWith(SITE) ? world.fetch(url, init) : fetch(url, init))
      );

      const code = await runUptimeMonitor({
        env: env(),
        fetch: failingGitHub,
        ...fakeClock("2026-10-16T10:10:00Z"),
        stdout: capture(),
        stderr,
      });

      expect(code).toBe(1);
      expect(stderr.text()).toMatch(/^::error title=Uptime monitor failed::RangeError: boom%0A\s+at /);
    });

    it("prints a thrown value that is not an error", async () => {
      const stderr = capture();
      const world = fakeWorld({ siteUp: true });
      const throwsString = /** @type {typeof globalThis.fetch} */ (
        async (url, init) => {
          if (String(url).startsWith(SITE)) {
            return world.fetch(url, init);
          }
          throw "rate limited";
        }
      );

      await runUptimeMonitor({
        env: env(),
        fetch: throwsString,
        ...fakeClock("2026-10-16T10:10:00Z"),
        stdout: capture(),
        stderr,
      });

      expect(stderr.text()).toBe("::error title=Uptime monitor failed::rate limited\n");
    });
  });
});
