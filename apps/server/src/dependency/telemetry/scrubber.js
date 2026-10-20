import { SCRUBBED_VALUE, UNKNOWN_KEY } from "./telemetrySchema.js";

/**
 * @typedef {{ signal: "metrics" | "logs", key: string }} Scrubbed  one value the scrubber changed
 * @typedef {{ attributes: Record<string, unknown> }} ResourceLike
 */

/**
 * The last check before anything leaves the server (ADR-055 point 7). The exporters hand it every export, and it
 * answers a copy where each key and value has been checked against the schema again: an unknown metric is
 * dropped, an unknown key is removed, a value that breaks its rule becomes `other`, a log line that is not a named
 * line becomes `other`, and a resource with anything wrong is replaced by the server's own. Each change is
 * reported to `onScrubbed`, which counts it in `telemetry.scrubbed`, so a mistake shows on the dashboard instead
 * of leaving. The values it was given are never changed.
 *
 * @param {{
 *   schema: ReturnType<typeof import("./telemetrySchema.js").createTelemetrySchema>,
 *   resource: ResourceLike,   the resource the server built from the schema, which replaces any other
 *   onScrubbed: (scrubbed: Scrubbed) => void,
 * }} deps
 */
export function createScrubber({ schema, resource, onScrubbed }) {
  /**
   * @param {"metrics" | "logs"} signal
   * @param {Readonly<Record<string, import("./telemetrySchema.js").Rule>>} rules
   * @param {Readonly<Record<string, unknown>>} attributes
   */
  function scrubAttributes(signal, rules, attributes) {
    const kept = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (!Object.hasOwn(rules, key)) {
        onScrubbed({ signal, key: UNKNOWN_KEY });
      } else if (rules[key](value)) {
        kept[key] = value;
      } else {
        onScrubbed({ signal, key });
        kept[key] = SCRUBBED_VALUE;
      }
    }
    return kept;
  }

  /** @param {"metrics" | "logs"} signal @param {ResourceLike} given */
  function scrubResource(signal, given) {
    if (given === resource) return resource;
    const before = Object.keys(given.attributes).length;
    const kept = scrubAttributes(signal, schema.resource, given.attributes);
    const clean =
      Object.keys(kept).length === before && Object.values(kept).every((v) => v !== SCRUBBED_VALUE);
    return clean ? given : resource;
  }

  return Object.freeze({
    /**
     * @param {import("@opentelemetry/sdk-metrics").ResourceMetrics} resourceMetrics
     * @returns {import("@opentelemetry/sdk-metrics").ResourceMetrics}
     */
    scrubMetrics(resourceMetrics) {
      return {
        ...resourceMetrics,
        resource: /** @type {any} */ (scrubResource("metrics", resourceMetrics.resource)),
        scopeMetrics: resourceMetrics.scopeMetrics.map((scopeMetrics) => ({
          ...scopeMetrics,
          metrics: scopeMetrics.metrics.flatMap((metric) => {
            const rules = schema.metrics[metric.descriptor.name];
            if (rules === undefined) {
              onScrubbed({ signal: "metrics", key: "metric" });
              return [];
            }
            return [
              {
                ...metric,
                dataPoints: metric.dataPoints.map((point) => ({
                  ...point,
                  attributes: scrubAttributes("metrics", rules, point.attributes),
                })),
              },
            ];
          }),
        })),
      };
    },

    /**
     * @param {ReadonlyArray<import("@opentelemetry/sdk-logs").ReadableLogRecord>} records
     * @returns {import("@opentelemetry/sdk-logs").ReadableLogRecord[]}
     */
    scrubLogRecords(records) {
      return records.map((record) => {
        const named = typeof record.body === "string" && Object.hasOwn(schema.logs.lines, record.body);
        if (!named) onScrubbed({ signal: "logs", key: "body" });
        const clean = {
          hrTime: record.hrTime,
          hrTimeObserved: record.hrTimeObserved,
          severityNumber: record.severityNumber,
          severityText: record.severityText,
          body: named ? record.body : SCRUBBED_VALUE,
          resource: /** @type {any} */ (scrubResource("logs", record.resource)),
          instrumentationScope: record.instrumentationScope,
          attributes: scrubAttributes("logs", schema.logs.fields, record.attributes),
          droppedAttributesCount: record.droppedAttributesCount,
        };
        if (record.eventName !== undefined) onScrubbed({ signal: "logs", key: "eventName" });
        return clean;
      });
    },
  });
}
