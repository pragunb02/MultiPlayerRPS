import http from "node:http";
import { metrics as globalMetrics } from "@opentelemetry/api";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createLogger } from "../../utils/logger.js";
import { NO_TELEMETRY, startTelemetry } from "./telemetry.js";
import { METRICS } from "./telemetrySchema.js";

const SETTINGS = Object.freeze({
  enabled: true,
  endpoint: "http://127.0.0.1:1",
  logs: true,
  exportIntervalMs: 60_000,
  serviceVersion: "0123456789ab",
  environment: "test",
});
const STEPS = ["record match", "judge"];
const running = [];

afterEach(async () => {
  for (const telemetry of running.splice(0)) await telemetry.shutdown();
});

/** Telemetry switched on, exporting into memory instead of over the network. */
async function start({
  settings = SETTINGS,
  onExportFailed = () => undefined,
  metricExporter,
  logExporter,
} = {}) {
  const exporters = {
    metrics: metricExporter ?? new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    logs: logExporter ?? new InMemoryLogRecordExporter(),
  };
  const telemetry = await startTelemetry({ settings, matchSteps: STEPS, onExportFailed, exporters });
  running.push(telemetry);
  return { telemetry, ...exporters };
}

/** Every data point of one metric in the last export, as `{ attributes, value }`. */
function pointsOf(exporter, name) {
  const last = exporter.getMetrics().at(-1);
  return last.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints.map(({ attributes, value }) => ({ attributes, value })));
}

describe("startTelemetry when off", () => {
  it("answers the same empty telemetry without loading the SDK", async () => {
    const loadSdk = vi.fn();

    const telemetry = await startTelemetry({
      settings: { enabled: false },
      matchSteps: STEPS,
      onExportFailed: () => undefined,
      loadSdk,
    });

    expect(loadSdk).not.toHaveBeenCalled();
    expect(telemetry).toBe(NO_TELEMETRY);
    expect(telemetry.forward).toBeUndefined();
    expect(Object.isFrozen(telemetry.metrics)).toBe(true);
  });

  it("does nothing when its methods are called", async () => {
    const { metrics } = NO_TELEMETRY;

    expect(
      metrics.recordHttpRequest({ route: "/", method: "GET", status: 200, durationMs: 1 }),
    ).toBeUndefined();
    expect(metrics.recordSocketEvent({ event: "x", outcome: "ok", durationMs: 1 })).toBeUndefined();
    expect(metrics.recordPipelineStep({ step: "judge", failedForGood: false })).toBeUndefined();
    expect(metrics.recordBotThinking({ game: "chess", outcome: "ok", durationMs: 1 })).toBeUndefined();
    expect(metrics.recordTelemetryDropped({ reason: "cap", count: 1 })).toBeUndefined();
    expect(metrics.recordTelemetryRollup({ outcome: "ok" })).toBeUndefined();
    expect(metrics.watch({ rooms: async () => [], connections: () => 0 })).toBeUndefined();
    await expect(NO_TELEMETRY.flush()).resolves.toBeUndefined();
    await expect(NO_TELEMETRY.shutdown()).resolves.toBeUndefined();
  });
});

describe("startTelemetry when on", () => {
  it("times a request by route template, method and status class", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordHttpRequest({
      route: "/api/session",
      method: "GET",
      status: 204,
      durationMs: 12,
    });
    telemetry.metrics.recordHttpRequest({
      route: "/api/session",
      method: "PROPFIND",
      status: 503,
      durationMs: 7,
    });
    await telemetry.flush();

    expect(pointsOf(exporter, METRICS.HTTP_DURATION)).toEqual([
      {
        attributes: {
          "http.route": "/api/session",
          "http.request.method": "GET",
          "http.response.status_class": "2xx",
        },
        value: expect.objectContaining({ count: 1, sum: 12 }),
      },
      {
        attributes: {
          "http.route": "/api/session",
          "http.request.method": "_OTHER",
          "http.response.status_class": "5xx",
        },
        value: expect.objectContaining({ count: 1, sum: 7 }),
      },
    ]);
  });

  it("buckets durations in milliseconds with a short list of boundaries", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordSocketEvent({ event: SOCKET_EVENTS.GAME_MOVE, outcome: "ok", durationMs: 30 });
    await telemetry.flush();

    const [{ value }] = pointsOf(exporter, METRICS.SOCKET_DURATION);
    expect(value.buckets.boundaries).toEqual([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
  });

  it("times a socket event by name and outcome", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordSocketEvent({
      event: SOCKET_EVENTS.ROOM_JOIN,
      outcome: "refused",
      durationMs: 3,
    });
    await telemetry.flush();

    expect(pointsOf(exporter, METRICS.SOCKET_DURATION)).toEqual([
      {
        attributes: { "socket.event": SOCKET_EVENTS.ROOM_JOIN, outcome: "refused" },
        value: expect.objectContaining({ count: 1, sum: 3 }),
      },
    ]);
  });

  it("counts match pipeline attempts per step, and the ones that failed for good", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordPipelineStep({ step: "record match", failedForGood: false });
    telemetry.metrics.recordPipelineStep({ step: "judge", failedForGood: false });
    telemetry.metrics.recordPipelineStep({ step: "judge", failedForGood: true });
    await telemetry.flush();

    expect(pointsOf(exporter, METRICS.PIPELINE_ATTEMPTS)).toEqual([
      { attributes: { step: "record match" }, value: 1 },
      { attributes: { step: "judge" }, value: 2 },
    ]);
    expect(pointsOf(exporter, METRICS.PIPELINE_FAILED)).toEqual([
      { attributes: { step: "judge" }, value: 1 },
    ]);
  });

  it("times computer players' thinking by game and outcome (ADR-067)", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordBotThinking({ game: "chess", outcome: "ok", durationMs: 200 });
    telemetry.metrics.recordBotThinking({ game: "chess", outcome: "timeout", durationMs: 10_000 });
    await telemetry.flush();

    expect(pointsOf(exporter, METRICS.BOT_THINKING_DURATION)).toEqual([
      {
        attributes: { game: "chess", outcome: "ok" },
        value: expect.objectContaining({ count: 1, sum: 200 }),
      },
      {
        attributes: { game: "chess", outcome: "timeout" },
        value: expect.objectContaining({ count: 1, sum: 10_000 }),
      },
    ]);
  });

  it("counts the nightly rollup's days by outcome only (CC-176)", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordTelemetryRollup({ outcome: "ok" });
    telemetry.metrics.recordTelemetryRollup({ outcome: "ok" });
    telemetry.metrics.recordTelemetryRollup({ outcome: "failed" });
    await telemetry.flush();

    expect(pointsOf(exporter, METRICS.TELEMETRY_ROLLUP_RUNS)).toEqual([
      { attributes: { outcome: "ok" }, value: 2 },
      { attributes: { outcome: "failed" }, value: 1 },
    ]);
  });

  it("counts usage counts that were not stored, by reason only (CC-175)", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordTelemetryDropped({ reason: "invalid", count: 3 });
    telemetry.metrics.recordTelemetryDropped({ reason: "invalid", count: 1 });
    telemetry.metrics.recordTelemetryDropped({ reason: "opted_out", count: 1 });
    await telemetry.flush();

    expect(pointsOf(exporter, METRICS.TELEMETRY_DROPPED)).toEqual([
      { attributes: { reason: "invalid" }, value: 4 },
      { attributes: { reason: "opted_out" }, value: 1 },
    ]);
  });

  it("reads open rooms and connections only when a reading is due", async () => {
    const { telemetry, metrics: exporter } = await start();
    const rooms = vi.fn(async () => [
      { gameId: "rps", status: "waiting", rooms: 2 },
      { gameId: "chess", status: "playing", rooms: 0 },
    ]);
    const connections = vi.fn(() => 5);

    telemetry.metrics.watch({ rooms, connections });
    expect(rooms).not.toHaveBeenCalled();
    await telemetry.flush();

    expect(rooms).toHaveBeenCalledOnce();
    expect(pointsOf(exporter, METRICS.ROOMS_OPEN)).toEqual([
      { attributes: { game: "rps", status: "waiting" }, value: 2 },
      { attributes: { game: "chess", status: "playing" }, value: 0 },
    ]);
    expect(pointsOf(exporter, METRICS.CONNECTIONS)).toEqual([{ attributes: {}, value: 5 }]);
  });

  it("measures event-loop delay and memory with no attributes", async () => {
    const { telemetry, metrics: exporter } = await start();

    await new Promise((resolve) => setTimeout(resolve, 50));
    await telemetry.flush();

    for (const name of [
      METRICS.EVENT_LOOP_P50,
      METRICS.EVENT_LOOP_P99,
      METRICS.MEMORY_RSS,
      METRICS.MEMORY_HEAP_USED,
    ]) {
      const points = pointsOf(exporter, name);
      expect(points).toHaveLength(1);
      expect(points[0].attributes).toEqual({});
      expect(points[0].value).toBeGreaterThanOrEqual(0);
    }
    expect(pointsOf(exporter, METRICS.MEMORY_RSS)[0].value).toBeGreaterThan(1_000_000);
  });

  it("describes the server with its four resource keys and nothing else", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordPipelineStep({ step: "judge", failedForGood: false });
    await telemetry.flush();

    expect(exporter.getMetrics().at(-1).resource.attributes).toEqual({
      "service.name": "classicade-server",
      "service.version": "0123456789ab",
      "service.instance.id": expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      "deployment.environment.name": "test",
    });
  });

  it("gives each process its own random instance id, so several servers never mix their series", async () => {
    const first = await start();
    const second = await start();

    for (const { telemetry } of [first, second]) {
      telemetry.metrics.recordPipelineStep({ step: "judge", failedForGood: false });
      await telemetry.flush();
    }

    const idOf = ({ metrics: exporter }) =>
      exporter.getMetrics().at(-1).resource.attributes["service.instance.id"];
    expect(idOf(first)).not.toBe(idOf(second));
  });

  it("counts log lines held back by the per-minute cap", async () => {
    const { telemetry, metrics: exporter } = await start();
    const logger = createLogger({
      level: "info",
      destination: { write: () => undefined },
      forward: telemetry.forward,
    });

    for (let i = 0; i < 32; i += 1) logger.error("unhandled error");
    await telemetry.flush();

    expect(pointsOf(exporter, METRICS.LOGS_SUPPRESSED)).toEqual([{ attributes: {}, value: 2 }]);
  });

  it("replaces a value that breaks its rule and counts it in telemetry.scrubbed", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordHttpRequest({ route: "/room/AB2CDE", method: "GET", status: 200, durationMs: 1 });
    await telemetry.flush();
    await telemetry.flush();

    expect(pointsOf(exporter, METRICS.HTTP_DURATION)[0].attributes["http.route"]).toBe("other");
    expect(JSON.stringify(exporter.getMetrics())).not.toContain("AB2CDE");
    expect(pointsOf(exporter, METRICS.SCRUBBED)).toEqual([
      { attributes: { signal: "metrics", key: "http.route" }, value: expect.any(Number) },
    ]);
  });

  it("never registers itself as the global OpenTelemetry provider", async () => {
    await start();

    expect(globalMetrics.getMeterProvider().constructor.name).toBe("NoopMeterProvider");
  });

  it("forwards named log lines, scrubbed, through the logger's second stream", async () => {
    const { telemetry, logs: exporter } = await start();
    const logger = createLogger({
      level: "info",
      destination: { write: () => undefined },
      forward: telemetry.forward,
    });

    logger.error(
      { step: "judge", attempts: 3, matchId: "m-1", err: new TypeError("sam@example.com") },
      "match pipeline failed",
    );
    logger.error({ route: "/room/AB2CDE" }, "unhandled error");
    logger.warn({ email: "sam@example.com" }, "not a named line");
    await telemetry.flush();

    const records = exporter.getFinishedLogRecords();
    expect(records.map(({ body, severityText, attributes }) => ({ body, severityText, attributes }))).toEqual(
      [
        {
          body: "match pipeline failed",
          severityText: "ERROR",
          attributes: { step: "judge", attempts: 3, "error.type": "TypeError" },
        },
        { body: "unhandled error", severityText: "ERROR", attributes: { route: "other" } },
      ],
    );
    expect(records[0].resource.attributes["service.name"]).toBe("classicade-server");
    expect(JSON.stringify(records.map(({ body, attributes }) => ({ body, attributes })))).not.toMatch(
      /sam@example|AB2CDE|m-1/,
    );
  });

  it("has no log stream with OTEL_LOGS_EXPORTER=none", async () => {
    const { telemetry } = await start({ settings: { ...SETTINGS, logs: false } });

    expect(telemetry.forward).toBeUndefined();
  });

  it("sends OTLP protobuf to the endpoint's metrics and logs paths with the configured headers", async () => {
    const received = [];
    const collector = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(200, { "Content-Type": "application/x-protobuf" }).end();
      });
    });
    await new Promise((resolve) => collector.listen(0, "127.0.0.1", resolve));
    const settings = { ...SETTINGS, endpoint: `http://127.0.0.1:${collector.address().port}` };
    Object.defineProperty(settings, "headers", { value: { authorization: "Basic dGVzdDp0b2tlbg==" } });
    try {
      const telemetry = await startTelemetry({
        settings,
        matchSteps: STEPS,
        onExportFailed: () => undefined,
      });
      running.push(telemetry);
      const logger = createLogger({
        level: "info",
        destination: { write: () => undefined },
        forward: telemetry.forward,
      });

      telemetry.metrics.recordPipelineStep({ step: "judge", failedForGood: true });
      logger.error({ step: "judge" }, "match pipeline failed");
      await telemetry.shutdown();
    } finally {
      await new Promise((resolve) => collector.close(resolve));
    }

    expect(received.map(({ path }) => path).sort()).toEqual(["/v1/logs", "/v1/metrics"]);
    for (const { headers, body } of received) {
      expect(headers["content-type"]).toBe("application/x-protobuf");
      expect(headers.authorization).toBe("Basic dGVzdDp0b2tlbg==");
      expect(body.toString("latin1")).toContain("classicade-server");
    }
  });

  it("reports a failed log export, from an exporter with only the required methods", async () => {
    const failures = [];
    const failingLogs = {
      export: (_, done) => done({ code: 1, error: new Error("403 Forbidden") }),
      shutdown: async () => undefined,
    };
    const bareMetrics = {
      export: (_, done) => done({ code: 0 }),
      forceFlush: async () => undefined,
      shutdown: async () => undefined,
    };
    const { telemetry } = await start({
      logExporter: failingLogs,
      metricExporter: bareMetrics,
      onExportFailed: (failure) => failures.push(failure),
    });
    const logger = createLogger({
      level: "info",
      destination: { write: () => undefined },
      forward: telemetry.forward,
    });

    logger.error("unhandled error");
    await telemetry.flush().catch(() => undefined);

    expect(failures).toEqual([{ signal: "logs", error: expect.any(Error) }]);
  });

  it("reports a failed export at most once a minute and keeps going", async () => {
    const failures = [];
    const failing = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    failing.export = (_, done) => done({ code: 1, error: new Error("401 Unauthorized") });
    const { telemetry } = await start({
      metricExporter: failing,
      onExportFailed: (failure) => failures.push(failure),
    });

    telemetry.metrics.recordPipelineStep({ step: "judge", failedForGood: false });
    await telemetry.flush().catch(() => undefined);
    await telemetry.flush().catch(() => undefined);

    expect(failures).toEqual([{ signal: "metrics", error: expect.any(Error) }]);
  });

  it("reports a failure again once a minute has passed", async () => {
    const failures = [];
    let clock = 0;
    const failing = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    failing.export = (_, done) => done({ code: 1, error: new Error("timeout") });
    const telemetry = await startTelemetry({
      settings: SETTINGS,
      matchSteps: STEPS,
      onExportFailed: (failure) => failures.push(failure),
      exporters: { metrics: failing, logs: new InMemoryLogRecordExporter() },
      now: () => clock,
    });
    running.push(telemetry);

    for (const at of [0, 59_999, 60_000]) {
      clock = at;
      await telemetry.flush().catch(() => undefined);
    }

    expect(failures).toHaveLength(2);
  });

  it("stops within its time limit even when the endpoint never answers", async () => {
    const silent = {
      export: () => undefined,
      forceFlush: async () => undefined,
      shutdown: async () => undefined,
    };
    const telemetry = await startTelemetry({
      settings: SETTINGS,
      matchSteps: STEPS,
      onExportFailed: () => undefined,
      exporters: { metrics: silent, logs: silent },
      shutdownWithinMs: 50,
    });
    const logger = createLogger({
      level: "info",
      destination: { write: () => undefined },
      forward: telemetry.forward,
    });
    telemetry.metrics.recordPipelineStep({ step: "judge", failedForGood: false });
    logger.error("unhandled error");

    const startedAt = Date.now();
    await telemetry.shutdown();

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("flushes on shutdown", async () => {
    const { telemetry, metrics: exporter } = await start();

    telemetry.metrics.recordPipelineStep({ step: "judge", failedForGood: false });
    await telemetry.shutdown();

    expect(pointsOf(exporter, METRICS.PIPELINE_ATTEMPTS)).toEqual([
      { attributes: { step: "judge" }, value: 1 },
    ]);
  });
});
