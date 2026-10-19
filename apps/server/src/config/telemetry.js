const DEFAULT_EXPORT_INTERVAL_MS = 60_000;
const MIN_EXPORT_INTERVAL_MS = 1_000;
const MAX_EXPORT_INTERVAL_MS = 600_000;
const COMMIT = /^[0-9a-f]{7,40}$/;
const COMMIT_SHOWN = 12;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * @typedef {{ enabled: false }
 *   | {
 *       enabled: true,
 *       endpoint: string,
 *       headers: Readonly<Record<string, string>>,
 *       logs: boolean,
 *       exportIntervalMs: number,
 *       serviceVersion: string,
 *       environment: string,
 *     }} TelemetrySettings
 *   `headers` is never enumerable, so serializing or logging the settings cannot print the token
 */

/**
 * Operations telemetry to Grafana Cloud (ADR-055). It is off unless OTEL_EXPORTER_OTLP_ENDPOINT is set, and the
 * two variables come together: an endpoint without its token, or a token without an endpoint, is a deploy mistake
 * and stops the boot. Every problem names the variable and never its value, because the headers hold the token.
 * An empty value counts as not set, so a copy of .env.example stays off.
 *
 * Read: OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, OTEL_SDK_DISABLED (true turns it off and keeps
 * the secrets in place), OTEL_LOGS_EXPORTER (otlp or none), OTEL_METRIC_EXPORT_INTERVAL (milliseconds, default
 * 60000) and RENDER_GIT_COMMIT (the service version). OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES are not
 * read, so what describes the server stays the fixed list in ADR-055.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ isProduction: boolean, nodeEnv: string, errors: string[] }} context
 * @returns {Readonly<TelemetrySettings>}
 */
export function parseTelemetry(env, { isProduction, nodeEnv, errors }) {
  const endpointRaw = valueOf(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const headersRaw = valueOf(env.OTEL_EXPORTER_OTLP_HEADERS);
  const disabled = parseDisabled(env.OTEL_SDK_DISABLED, { errors });
  const logs = parseLogsExporter(env.OTEL_LOGS_EXPORTER, { errors });
  const exportIntervalMs = parseInterval(env.OTEL_METRIC_EXPORT_INTERVAL, { errors });

  if (endpointRaw !== undefined && headersRaw === undefined) {
    errors.push("OTEL_EXPORTER_OTLP_HEADERS is required when OTEL_EXPORTER_OTLP_ENDPOINT is set");
  }
  if (endpointRaw === undefined && headersRaw !== undefined) {
    errors.push("OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_EXPORTER_OTLP_HEADERS is set");
  }
  if (endpointRaw === undefined || headersRaw === undefined) {
    return OFF;
  }
  const endpoint = parseEndpoint(endpointRaw, { isProduction, errors });
  const headers = parseHeaders(headersRaw, { errors });
  if (disabled) {
    return OFF;
  }

  const settings = {
    enabled: true,
    endpoint,
    logs,
    exportIntervalMs,
    serviceVersion: COMMIT.test(env.RENDER_GIT_COMMIT ?? "")
      ? env.RENDER_GIT_COMMIT.slice(0, COMMIT_SHOWN)
      : "unknown",
    environment: nodeEnv,
  };
  Object.defineProperty(settings, "headers", { value: headers, enumerable: false });
  return Object.freeze(settings);
}

const OFF = Object.freeze({ enabled: false });

/**
 * @param {string | undefined} raw
 * @returns {string | undefined} the trimmed value, or undefined when it is missing or empty
 */
function valueOf(raw) {
  const value = raw?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function parseDisabled(raw, { errors }) {
  const value = valueOf(raw);
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  errors.push(`OTEL_SDK_DISABLED must be true or false (got "${raw}")`);
  return false;
}

function parseLogsExporter(raw, { errors }) {
  const value = valueOf(raw);
  if (value === undefined || value === "otlp") return true;
  if (value === "none") return false;
  errors.push(`OTEL_LOGS_EXPORTER must be otlp or none (got "${raw}")`);
  return true;
}

function parseInterval(raw, { errors }) {
  const value = valueOf(raw);
  if (value === undefined) return DEFAULT_EXPORT_INTERVAL_MS;
  const ms = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!(ms >= MIN_EXPORT_INTERVAL_MS && ms <= MAX_EXPORT_INTERVAL_MS)) {
    errors.push(
      `OTEL_METRIC_EXPORT_INTERVAL must be a whole number of milliseconds from ${MIN_EXPORT_INTERVAL_MS} to ${MAX_EXPORT_INTERVAL_MS} (got "${raw}")`,
    );
    return DEFAULT_EXPORT_INTERVAL_MS;
  }
  return ms;
}

/**
 * The OTLP base address. The exporters add /v1/metrics and /v1/logs to it. A user, a query or a fragment has no
 * place there and could carry a secret into an error message, so they are refused. Production sends over HTTPS
 * only. Plain HTTP is for a collector on this machine.
 */
function parseEndpoint(raw, { isProduction, errors }) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  const valid =
    url !== undefined &&
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    !raw.includes("?") &&
    !raw.includes("#");
  if (!valid) {
    errors.push(
      "OTEL_EXPORTER_OTLP_ENDPOINT must be an http:// or https:// URL without a user, query or fragment",
    );
    return "";
  }
  if (isProduction && url.protocol !== "https:") {
    errors.push("OTEL_EXPORTER_OTLP_ENDPOINT must start with https:// in production");
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Comma separated name=value pairs, as the OpenTelemetry standard writes them. Values are percent encoded
 * (Grafana's tile writes the space after Basic as %20), so they are decoded here once.
 */
function parseHeaders(raw, { errors }) {
  const headers = {};
  let valid = true;
  for (const pair of raw.split(",")) {
    const at = pair.indexOf("=");
    const name = at === -1 ? "" : pair.slice(0, at).trim();
    const value = at === -1 ? undefined : decode(pair.slice(at + 1).trim());
    if (!HEADER_NAME.test(name) || value === undefined || value === "") {
      valid = false;
      continue;
    }
    headers[name.toLowerCase()] = value;
  }
  if (!valid) {
    errors.push(
      "OTEL_EXPORTER_OTLP_HEADERS must be comma separated name=value pairs, for example Authorization=Basic%20...",
    );
  }
  return Object.freeze(headers);
}

/** @param {string} value */
function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
