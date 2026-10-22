import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import {
  createAllowListAttributesProcessor,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { createLogForwarder } from "./logForwarder.js";
import { createScrubber } from "./scrubber.js";
import { createTelemetrySchema, HTTP_METHODS, METRICS, OTHER_METHOD } from "./telemetrySchema.js";

// The SDK's code for an export that went through (ExportResultCode.SUCCESS in @opentelemetry/core).
const EXPORT_SUCCESS = 0;
// Milliseconds. Socket events and API routes take a few milliseconds to a few seconds, so eleven boundaries are
// enough and keep each route at 14 series instead of 18 (ADR-055 point 2, the series budget).
const DURATION_BOUNDARIES = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
const EXPORT_TIMEOUT_MS = 30_000;
const SHUTDOWN_FLUSH_MS = 5_000;
const FAILURE_REPORT_INTERVAL_MS = 60_000;
const EVENT_LOOP_RESOLUTION_MS = 10;
const NS_PER_MS = 1e6;
const SCOPE = "classicade-server";

/**
 * The OpenTelemetry side of telemetry, loaded only when it is on (see telemetry.js). Builds a meter provider and a
 * logger provider that are never registered as the global ones, so no library can find them and add its own data.
 * Each exporter is wrapped by the scrubber, and each metric has a View that keeps only its listed attribute keys.
 *
 * @param {Parameters<typeof import("./telemetry.js").startTelemetry>[0] & { now: () => number }} deps
 *   `shutdownWithinMs` is the time the last flush gets, 5 seconds unless a test makes it shorter
 * @returns {Readonly<import("./telemetry.js").Telemetry>}
 */
export function startOpenTelemetry({
  settings,
  matchSteps,
  onExportFailed,
  exporters,
  now,
  shutdownWithinMs = SHUTDOWN_FLUSH_MS,
}) {
  const schema = createTelemetrySchema({ matchSteps });
  const resource = resourceFromAttributes({
    "service.name": schema.serviceName,
    "service.version": settings.serviceVersion,
    // A random id for this process only. It tells two servers apart when there are several (CC-061) and says
    // nothing about the machine or anyone using it.
    "service.instance.id": randomUUID(),
    "deployment.environment.name": settings.environment,
  });
  const reportFailure = atMostEvery(FAILURE_REPORT_INTERVAL_MS, onExportFailed, now);
  // The counter is made once the meter exists, below. Nothing is scrubbed before the first export, which is later.
  const scrubber = createScrubber({ schema, resource, onScrubbed: (item) => countScrubbed(item) });

  const metricExporter =
    exporters?.metrics ??
    new OTLPMetricExporter({ url: `${settings.endpoint}/v1/metrics`, headers: { ...settings.headers } });
  const meterProvider = new MeterProvider({
    resource,
    views: Object.entries(schema.metrics).map(([name, rules]) => ({
      instrumentName: name,
      attributesProcessors: [createAllowListAttributesProcessor(Object.keys(rules))],
    })),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: scrubbingMetricExporter({ exporter: metricExporter, scrubber, reportFailure }),
        exportIntervalMillis: settings.exportIntervalMs,
        exportTimeoutMillis: Math.min(EXPORT_TIMEOUT_MS, settings.exportIntervalMs),
      }),
    ],
  });
  const meter = meterProvider.getMeter(SCOPE);
  const scrubbed = meter.createCounter(METRICS.SCRUBBED, {
    description: "Values the scrubber replaced before export. Should stay at zero.",
  });
  function countScrubbed({ signal, key }) {
    scrubbed.add(1, { signal, key });
  }
  const suppressed = meter.createCounter(METRICS.LOGS_SUPPRESSED, {
    description: "Log lines not sent because the same line was sent 30 times that minute.",
  });

  const loggerProvider = settings.logs
    ? new LoggerProvider({
        resource,
        processors: [
          new BatchLogRecordProcessor({
            exporter: scrubbingLogExporter({
              exporter:
                exporters?.logs ??
                new OTLPLogExporter({
                  url: `${settings.endpoint}/v1/logs`,
                  headers: { ...settings.headers },
                }),
              scrubber,
              reportFailure,
            }),
            scheduledDelayMillis: settings.exportIntervalMs,
            exportTimeoutMillis: Math.min(EXPORT_TIMEOUT_MS, settings.exportIntervalMs),
          }),
        ],
      })
    : undefined;
  const otelLogger = loggerProvider?.getLogger(SCOPE);

  const loopDelay = startRuntimeGauges(meter);
  const metrics = createOperationsMetrics(meter);

  let stopped;
  return Object.freeze({
    metrics,
    forward:
      otelLogger &&
      createLogForwarder({
        schema,
        emit: (record) => otelLogger.emit(record),
        onSuppressed: () => suppressed.add(1),
        now,
      }),
    async flush() {
      await meterProvider.forceFlush();
      await loggerProvider?.forceFlush();
    },
    // The last flush gets a fixed time and no more, so an endpoint that never answers cannot hold up a deploy.
    // By then the game has already closed its sockets and the database, so a lost last minute is all it costs.
    shutdown() {
      stopped ??= (async () => {
        loopDelay.disable();
        let timer;
        const limit = new Promise((resolve) => {
          timer = setTimeout(resolve, shutdownWithinMs);
          timer.unref();
        });
        await Promise.race([
          Promise.allSettled([
            meterProvider.shutdown({ timeoutMillis: shutdownWithinMs }),
            loggerProvider?.shutdown(),
          ]),
          limit,
        ]);
        clearTimeout(timer);
      })();
      return stopped;
    },
  });
}

/**
 * The instruments of ADR-055 point 1. Each records the values it is given: the service layer passes values from
 * closed sets, and anything else is the scrubber's to catch and count. Two values are put in a closed set here,
 * because the request decides them: a method outside the standard list is `_OTHER` (the OpenTelemetry name), and
 * a status is only its class.
 *
 * @param {import("@opentelemetry/api").Meter} meter
 * @returns {Readonly<import("../../utils/operationsMetrics.js").OperationsMetrics>}
 */
function createOperationsMetrics(meter) {
  const histogram = (name, description) =>
    meter.createHistogram(name, {
      unit: "ms",
      description,
      advice: { explicitBucketBoundaries: [...DURATION_BOUNDARIES] },
    });
  const httpDuration = histogram(METRICS.HTTP_DURATION, "Time to answer an HTTP request, by route template.");
  const socketDuration = histogram(METRICS.SOCKET_DURATION, "Time to acknowledge a socket event.");
  const attempts = meter.createCounter(METRICS.PIPELINE_ATTEMPTS, {
    description: "Attempts at a match pipeline step.",
  });
  const failed = meter.createCounter(METRICS.PIPELINE_FAILED, {
    description: "Match pipeline steps that failed for good, after every retry.",
  });
  const thinkingDuration = histogram(
    METRICS.BOT_THINKING_DURATION,
    "Time a computer player took to choose a move, waiting for a thread included.",
  );
  const passwordChecks = meter.createCounter(METRICS.PASSWORD_CHECKS, {
    description: "Checks of a new password against the common and breached passwords, by outcome.",
  });
  const methods = new Set(HTTP_METHODS);

  return Object.freeze({
    recordHttpRequest({ route, method, status, durationMs }) {
      httpDuration.record(durationMs, {
        "http.route": route,
        "http.request.method": methods.has(method) ? method : OTHER_METHOD,
        "http.response.status_class": `${Math.trunc(status / 100)}xx`,
      });
    },
    recordSocketEvent({ event, outcome, durationMs }) {
      socketDuration.record(durationMs, { "socket.event": event, outcome });
    },
    recordPipelineStep({ step, failedForGood }) {
      attempts.add(1, { step });
      if (failedForGood) failed.add(1, { step });
    },
    recordBotThinking({ game, outcome, durationMs }) {
      thinkingDuration.record(durationMs, { game, outcome });
    },
    recordPasswordCheck({ outcome }) {
      passwordChecks.add(1, { outcome });
    },
    watch({ rooms, connections }) {
      const open = meter.createObservableGauge(METRICS.ROOMS_OPEN, {
        description: "Open rooms per game and status.",
      });
      const connected = meter.createObservableGauge(METRICS.CONNECTIONS, {
        description: "Realtime connections.",
      });
      meter.addBatchObservableCallback(
        async (observer) => {
          observer.observe(connected, connections());
          for (const row of await rooms()) {
            observer.observe(open, row.rooms, { game: row.gameId, status: row.status });
          }
        },
        [open, connected],
      );
    },
  });
}

/**
 * Event-loop delay (median and 99th percentile since the last reading, from Node's own monitor) and memory (RSS
 * and the JavaScript heap in use), read once per export.
 *
 * @param {import("@opentelemetry/api").Meter} meter
 * @returns {{ disable: () => void }} the event-loop monitor, to stop at shutdown
 */
function startRuntimeGauges(meter) {
  const loopDelay = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  loopDelay.enable();
  const gauge = (name, unit, description) => meter.createObservableGauge(name, { unit, description });
  const p50 = gauge(METRICS.EVENT_LOOP_P50, "ms", "Median event-loop delay since the last reading.");
  const p99 = gauge(METRICS.EVENT_LOOP_P99, "ms", "99th percentile event-loop delay since the last reading.");
  const rss = gauge(METRICS.MEMORY_RSS, "By", "Resident memory of the process.");
  const heapUsed = gauge(METRICS.MEMORY_HEAP_USED, "By", "JavaScript heap in use.");
  meter.addBatchObservableCallback(
    (observer) => {
      observer.observe(p50, loopDelay.percentile(50) / NS_PER_MS);
      observer.observe(p99, loopDelay.percentile(99) / NS_PER_MS);
      loopDelay.reset();
      const memory = process.memoryUsage();
      observer.observe(rss, memory.rss);
      observer.observe(heapUsed, memory.heapUsed);
    },
    [p50, p99, rss, heapUsed],
  );
  return loopDelay;
}

/**
 * @param {{
 *   exporter: import("@opentelemetry/sdk-metrics").PushMetricExporter,
 *   scrubber: ReturnType<typeof createScrubber>,
 *   reportFailure: (failure: { signal: "metrics" | "logs", error: unknown }) => void,
 * }} deps
 * @returns {import("@opentelemetry/sdk-metrics").PushMetricExporter}
 */
function scrubbingMetricExporter({ exporter, scrubber, reportFailure }) {
  return {
    export(resourceMetrics, done) {
      exporter.export(
        scrubber.scrubMetrics(resourceMetrics),
        reportingFailures("metrics", done, reportFailure),
      );
    },
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown(),
    selectAggregationTemporality: exporter.selectAggregationTemporality?.bind(exporter),
  };
}

/**
 * @param {{
 *   exporter: import("@opentelemetry/sdk-logs").LogRecordExporter,
 *   scrubber: ReturnType<typeof createScrubber>,
 *   reportFailure: (failure: { signal: "metrics" | "logs", error: unknown }) => void,
 * }} deps
 * @returns {import("@opentelemetry/sdk-logs").LogRecordExporter}
 */
function scrubbingLogExporter({ exporter, scrubber, reportFailure }) {
  return {
    export(records, done) {
      exporter.export(scrubber.scrubLogRecords(records), reportingFailures("logs", done, reportFailure));
    },
    forceFlush: () => exporter.forceFlush?.() ?? Promise.resolve(),
    shutdown: () => exporter.shutdown(),
  };
}

const reportingFailures = (signal, done, reportFailure) => (result) => {
  if (result.code !== EXPORT_SUCCESS) reportFailure({ signal, error: result.error });
  done(result);
};

/**
 * Calls `report` at most once in each `intervalMs`, so a revoked token or an unreachable endpoint gives one
 * warning a minute instead of one per export.
 *
 * @template T
 * @param {number} intervalMs
 * @param {(value: T) => void} report
 * @param {() => number} now
 * @returns {(value: T) => void}
 */
export function atMostEvery(intervalMs, report, now) {
  let last = Number.NEGATIVE_INFINITY;
  return (value) => {
    if (now() - last < intervalMs) return;
    last = now();
    report(value);
  };
}
