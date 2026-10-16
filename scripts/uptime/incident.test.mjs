import { describe, expect, it } from "vitest";

import {
  MARKER,
  formatResults,
  incidentBody,
  incidentTitle,
  readIncidentState,
  recoveryComment,
} from "./incident.mjs";

const BASE = "https://nocapgaming.onrender.com";
const RUN = "https://github.com/o/r/actions/runs/9";

/** @param {boolean} ok */
const result = (name = "health", ok = false) => ({
  name,
  url: `${BASE}/health`,
  ok,
  ms: 95_000,
  attempts: [
    { at: "2026-10-16T10:10:00.000Z", ms: 45_000, ok, outcome: ok ? "HTTP 200, database up" : "HTTP 503" },
  ],
});

describe("incident text", () => {
  it("formats every check with every attempt", () => {
    expect(formatResults([result("health", false), result("home page", true)])).toBe(
      [
        `- **health** DOWN after 95000 ms, ${BASE}/health`,
        "  - attempt 1 at 2026-10-16T10:10:00.000Z: HTTP 503 (45000 ms)",
        `- **home page** up after 95000 ms, ${BASE}/health`,
        "  - attempt 1 at 2026-10-16T10:10:00.000Z: HTTP 200, database up (45000 ms)",
      ].join("\n"),
    );
  });

  it("titles the incident with the host and the first failure in UTC", () => {
    expect(incidentTitle({ baseUrl: BASE, failingSince: "2026-10-16T10:00:03.512Z" })).toBe(
      "Site down: nocapgaming.onrender.com not answering since 2026-10-16 10:00 UTC",
    );
  });

  it("writes a body the monitor can recognise and read back", () => {
    const state = { firstFailureAt: "2026-10-16T10:00:00.000Z", failedChecks: 3 };

    const body = incidentBody({
      baseUrl: BASE,
      state,
      checkedAt: "2026-10-16T10:20:00.000Z",
      runUrl: RUN,
      results: [result()],
    });

    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain(`**${BASE} is down.** Failing: health.`);
    expect(body).toContain("| Failed checks in a row | 3 |");
    expect(body).toContain("| Down for at least | 20 min |");
    expect(body).toContain(`([run](${RUN}))`);
    expect(readIncidentState({ body, createdAt: "2026-10-16T10:10:00Z" })).toEqual(state);
  });

  it("says at least one minute for a very short outage", () => {
    const state = { firstFailureAt: "2026-10-16T10:00:00.000Z", failedChecks: 2 };

    const body = incidentBody({
      baseUrl: BASE,
      state,
      checkedAt: "2026-10-16T10:00:10.000Z",
      runUrl: RUN,
      results: [],
    });

    expect(body).toContain("| Down for at least | 1 min |");
  });

  it("writes the recovery comment with the outage length", () => {
    const state = { firstFailureAt: "2026-10-16T10:00:00.000Z", failedChecks: 4 };

    const comment = recoveryComment({
      state,
      checkedAt: "2026-10-16T10:42:00.000Z",
      runUrl: RUN,
      results: [result("health", true)],
    });

    expect(comment).toMatch(/^\*\*Back up\*\* at 2026-10-16T10:42:00.000Z/);
    expect(comment).toContain(
      "about 42 min after the first failed check (2026-10-16T10:00:00.000Z, 4 failed checks",
    );
  });
});

describe("readIncidentState", () => {
  const createdAt = "2026-10-16T10:10:00Z";

  it.each([
    ["the state comment was deleted", "Someone rewrote this issue."],
    ["the state is not JSON", "<!-- uptime-state {broken} -->"],
    ["the state has the wrong shape", '<!-- uptime-state {"firstFailureAt":1,"failedChecks":"2"} -->'],
  ])("falls back to the issue's creation time when %s", (_, body) => {
    expect(readIncidentState({ body, createdAt })).toEqual({ firstFailureAt: createdAt, failedChecks: 1 });
  });
});
