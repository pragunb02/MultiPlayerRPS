import { describe, expect, it } from "vitest";

import { fakeClock, fakeFetch } from "../testing/fakeClock.mjs";
import { CHECKS, checkSite, judgeHealth, judgePage, probe } from "./probe.mjs";

const HEALTHY = '{"status":"ok","database":"up"}';
const html = () =>
  new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } });
const timeout = () =>
  Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });

describe("judgeHealth", () => {
  it("passes a 200 that also names the deployed commit and version (CC-303)", () => {
    const body = JSON.stringify({
      status: "ok",
      database: "up",
      commit: "a40ce5b9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f",
      version: "2026.10.20+a40ce5b",
    });

    expect(judgeHealth({ status: 200, contentType: "application/json", body }).ok).toBe(true);
  });

  it("passes a 200 with the database up", () => {
    expect(judgeHealth({ status: 200, contentType: "application/json", body: HEALTHY })).toEqual({
      ok: true,
      outcome: "HTTP 200, database up",
    });
  });

  it("fails a 503 from a server whose database is down", () => {
    const body = '{"status":"unavailable","database":"down"}';

    expect(judgeHealth({ status: 503, contentType: "application/json", body })).toEqual({
      ok: false,
      outcome: "HTTP 503",
    });
  });

  it("fails a 200 that is not the health answer, such as a hosting error page", () => {
    expect(judgeHealth({ status: 200, contentType: "text/html", body: "<html>" }).ok).toBe(false);
  });
});

describe("judgePage", () => {
  it("passes a 200 with HTML", () => {
    expect(judgePage({ status: 200, contentType: "text/html; charset=utf-8", body: "" }).ok).toBe(true);
  });

  it("fails an error status", () => {
    expect(judgePage({ status: 502, contentType: "text/html", body: "" })).toEqual({
      ok: false,
      outcome: "HTTP 502",
    });
  });

  it("fails a 200 that is not HTML", () => {
    expect(judgePage({ status: 200, contentType: "application/json", body: "" }).outcome).toBe(
      "HTTP 200, but application/json",
    );
    expect(judgePage({ status: 200, contentType: "", body: "" }).outcome).toBe(
      "HTTP 200, but no content type",
    );
  });
});

describe("probe", () => {
  const timing = { budgetMs: 90_000, attemptTimeoutMs: 45_000, firstRetryDelayMs: 5_000 };

  it("passes on the first answer when the site is awake", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    const { fetch, calls } = fakeFetch(() => {
      clock.advance(300);
      return new Response(HEALTHY, { status: 200 });
    });

    const result = await probe({
      name: "health",
      url: "https://x/health",
      judge: judgeHealth,
      timing,
      fetch,
      ...clock,
    });

    expect(result).toEqual({
      name: "health",
      url: "https://x/health",
      ok: true,
      ms: 300,
      attempts: [{ at: "2026-10-16T10:00:00.000Z", ms: 300, ok: true, outcome: "HTTP 200, database up" }],
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(clock.sleeps).toEqual([]);
  });

  it("rides out a cold start: retries with growing waits until the site wakes up", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    let calls = 0;
    const { fetch } = fakeFetch(() => {
      calls += 1;
      if (calls < 4) {
        throw refused();
      }
      return new Response(HEALTHY);
    });

    const result = await probe({
      name: "health",
      url: "https://x/health",
      judge: judgeHealth,
      timing,
      fetch,
      ...clock,
    });

    expect(result.ok).toBe(true);
    expect(clock.sleeps).toEqual([5_000, 10_000, 20_000]);
    expect(result.attempts.map(({ outcome }) => outcome)).toEqual([
      "network error (ECONNREFUSED)",
      "network error (ECONNREFUSED)",
      "network error (ECONNREFUSED)",
      "HTTP 200, database up",
    ]);
  });

  it("gives up when the budget runs out, keeping every attempt's timing", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    const { fetch, calls } = fakeFetch((_, init) => {
      // Stands for a request that hangs until its timeout fires.
      clock.advance(45_000);
      expect(init.signal).toBeDefined();
      throw timeout();
    });

    const result = await probe({
      name: "health",
      url: "https://x/health",
      judge: judgeHealth,
      timing,
      fetch,
      ...clock,
    });

    expect(result.ok).toBe(false);
    expect(result.ms).toBe(95_000);
    expect(calls).toHaveLength(2);
    expect(clock.sleeps).toEqual([5_000]);
    expect(result.attempts.map(({ at, outcome }) => [at, outcome])).toEqual([
      ["2026-10-16T10:00:00.000Z", "no answer within 45 s"],
      ["2026-10-16T10:00:50.000Z", "no answer within 40 s"],
    ]);
  });

  it("keeps the last wait short enough to leave time for one more attempt", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    const { fetch } = fakeFetch(() => {
      throw refused();
    });

    await probe({ name: "health", url: "https://x/health", judge: judgeHealth, timing, fetch, ...clock });

    expect(clock.sleeps).toEqual([5_000, 10_000, 20_000, 40_000, 13_000]);
  });

  it("describes a network error without a code by its message", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    const { fetch } = fakeFetch(() => {
      throw new TypeError("bad port");
    });
    const short = { budgetMs: 1_000, attemptTimeoutMs: 1_000, firstRetryDelayMs: 500 };

    const result = await probe({
      name: "page",
      url: "https://x/",
      judge: judgePage,
      timing: short,
      fetch,
      ...clock,
    });

    expect(result.attempts).toEqual([expect.objectContaining({ outcome: "network error (bad port)" })]);
  });

  it("still gives the last attempt a real timeout when a sleep wakes up past the deadline", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    const { fetch, calls } = fakeFetch(() => {
      throw refused();
    });
    const lateSleep = async () => clock.advance(200_000);

    const result = await probe({
      name: "health",
      url: "https://x/health",
      judge: judgeHealth,
      timing,
      fetch,
      now: clock.now,
      sleep: lateSleep,
    });

    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(false);
  });

  it("fails a page answered without a content type", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    const { fetch } = fakeFetch(() => new Response(null, { status: 200 }));
    const short = { budgetMs: 1_000, attemptTimeoutMs: 1_000, firstRetryDelayMs: 500 };

    const result = await probe({
      name: "page",
      url: "https://x/",
      judge: judgePage,
      timing: short,
      fetch,
      ...clock,
    });

    expect(result.attempts).toEqual([expect.objectContaining({ outcome: "HTTP 200, but no content type" })]);
  });
});

describe("checkSite", () => {
  it("is up when the health check and the page both pass", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    const { fetch, calls } = fakeFetch((url) => (url.endsWith("/health") ? new Response(HEALTHY) : html()));

    const { up, results } = await checkSite({ baseUrl: "https://nocapgaming.onrender.com", fetch, ...clock });

    expect(up).toBe(true);
    expect(calls.map(({ url }) => url)).toEqual([
      "https://nocapgaming.onrender.com/health",
      "https://nocapgaming.onrender.com/",
    ]);
    expect(results.map(({ name }) => name)).toEqual(CHECKS.map(({ name }) => name));
  });

  it("is down when the page fails even though health passes", async () => {
    const clock = fakeClock("2026-10-16T10:00:00Z");
    const { fetch } = fakeFetch((url) =>
      url.endsWith("/health") ? new Response(HEALTHY) : new Response("", { status: 500 }),
    );

    const { up, results } = await checkSite({ baseUrl: "https://nocapgaming.onrender.com", fetch, ...clock });

    expect(up).toBe(false);
    expect(results.map(({ ok }) => ok)).toEqual([true, false]);
  });
});
