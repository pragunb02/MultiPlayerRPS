import { describe, expect, it } from "vitest";
import { parseTelemetry } from "./telemetry.js";

const ENDPOINT = "https://otlp-gateway-prod-ap-south-1.grafana.net/otlp";
const TOKEN = "glc_secret-token-value";
const HEADERS = `Authorization=Basic%20${TOKEN}`;

/** Parses the telemetry part of an environment and answers the settings and the problems found. */
function parse(env, { isProduction = false, nodeEnv = "development" } = {}) {
  const errors = [];
  const settings = parseTelemetry(env, { isProduction, nodeEnv, errors });
  return { settings, errors };
}

describe("parseTelemetry", () => {
  it("is off when the endpoint is not set, with no error", () => {
    const { settings, errors } = parse({});

    expect(errors).toEqual([]);
    expect(settings).toEqual({ enabled: false });
    expect(Object.isFrozen(settings)).toBe(true);
  });

  it("treats empty values, as copied from .env.example, as not set", () => {
    const { settings, errors } = parse({ OTEL_EXPORTER_OTLP_ENDPOINT: "", OTEL_EXPORTER_OTLP_HEADERS: "" });

    expect(errors).toEqual([]);
    expect(settings.enabled).toBe(false);
  });

  it("is on with both variables set, exporting every 60 seconds with logs, by default", () => {
    const { settings, errors } = parse(
      { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS: HEADERS },
      { isProduction: true, nodeEnv: "production" },
    );

    expect(errors).toEqual([]);
    expect(settings).toEqual({
      enabled: true,
      endpoint: ENDPOINT,
      logs: true,
      exportIntervalMs: 60_000,
      serviceVersion: "unknown",
      environment: "production",
    });
    expect(settings.headers).toEqual({ authorization: `Basic ${TOKEN}` });
  });

  it("drops a trailing slash so the signal paths join cleanly", () => {
    const { settings } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: `${ENDPOINT}/`,
      OTEL_EXPORTER_OTLP_HEADERS: HEADERS,
    });

    expect(settings.endpoint).toBe(ENDPOINT);
  });

  it("never shows the headers when the settings are serialized or logged", () => {
    const { settings } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: HEADERS,
    });

    expect(JSON.stringify(settings)).not.toContain(TOKEN);
    expect(JSON.stringify({ config: { telemetry: settings } })).not.toContain(TOKEN);
    expect(Object.keys(settings)).not.toContain("headers");
  });

  it("refuses an endpoint without headers, naming the missing variable", () => {
    const { errors } = parse({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT });

    expect(errors).toEqual([
      "OTEL_EXPORTER_OTLP_HEADERS is required when OTEL_EXPORTER_OTLP_ENDPOINT is set",
    ]);
  });

  it("refuses headers without an endpoint, and never repeats the headers' value", () => {
    const { errors } = parse({ OTEL_EXPORTER_OTLP_HEADERS: HEADERS });

    expect(errors).toEqual([
      "OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_EXPORTER_OTLP_HEADERS is set",
    ]);
    expect(errors.join()).not.toContain(TOKEN);
  });

  it("refuses an endpoint that is not https in production", () => {
    const { errors } = parse(
      { OTEL_EXPORTER_OTLP_ENDPOINT: "http://otlp.example.com/otlp", OTEL_EXPORTER_OTLP_HEADERS: HEADERS },
      { isProduction: true, nodeEnv: "production" },
    );

    expect(errors).toEqual(["OTEL_EXPORTER_OTLP_ENDPOINT must start with https:// in production"]);
  });

  it("allows a plain http endpoint outside production, for a collector on this machine", () => {
    const { settings, errors } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      OTEL_EXPORTER_OTLP_HEADERS: "x-test=1",
    });

    expect(errors).toEqual([]);
    expect(settings.endpoint).toBe("http://127.0.0.1:4318");
  });

  it.each([
    ["not a URL", "otlp-gateway"],
    ["another scheme", "ftp://otlp.example.com"],
    ["a user in the URL", "https://user:pass@otlp.example.com/otlp"],
    ["a query", "https://otlp.example.com/otlp?token=abc"],
    ["a fragment", "https://otlp.example.com/otlp#x"],
  ])("refuses an endpoint with %s, without repeating it", (_, endpoint) => {
    const { errors } = parse({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_EXPORTER_OTLP_HEADERS: HEADERS });

    expect(errors).toEqual([
      "OTEL_EXPORTER_OTLP_ENDPOINT must be an http:// or https:// URL without a user, query or fragment",
    ]);
    expect(errors.join()).not.toContain(endpoint);
  });

  it.each([["Authorization"], ["=Basic abc"], ["Authorization=Basic%ZZ"], [","]])(
    "refuses headers that are not name=value pairs (%s), without repeating them",
    (headers) => {
      const { errors } = parse({
        OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
        OTEL_EXPORTER_OTLP_HEADERS: headers,
      });

      expect(errors).toEqual([
        "OTEL_EXPORTER_OTLP_HEADERS must be comma separated name=value pairs, for example Authorization=Basic%20...",
      ]);
    },
  );

  it("reads several headers, names in lower case and values decoded", () => {
    const { settings } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: " Authorization = Basic%20abc= , X-Scope-OrgID=tenant ",
    });

    expect(settings.headers).toEqual({ authorization: "Basic abc=", "x-scope-orgid": "tenant" });
    expect(Object.isFrozen(settings.headers)).toBe(true);
  });

  it("is off with OTEL_SDK_DISABLED=true, keeping both variables in place", () => {
    const { settings, errors } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: HEADERS,
      OTEL_SDK_DISABLED: "true",
    });

    expect(errors).toEqual([]);
    expect(settings).toEqual({ enabled: false });
  });

  it("refuses an OTEL_SDK_DISABLED that is neither true nor false", () => {
    expect(parse({ OTEL_SDK_DISABLED: "yes" }).errors).toEqual([
      'OTEL_SDK_DISABLED must be true or false (got "yes")',
    ]);
    expect(parse({ OTEL_SDK_DISABLED: "false" }).errors).toEqual([]);
  });

  it("sends metrics only with OTEL_LOGS_EXPORTER=none", () => {
    const { settings } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: HEADERS,
      OTEL_LOGS_EXPORTER: "none",
    });

    expect(settings.logs).toBe(false);
    expect(parse({ OTEL_LOGS_EXPORTER: "otlp" }).errors).toEqual([]);
  });

  it("refuses another logs exporter", () => {
    expect(parse({ OTEL_LOGS_EXPORTER: "console" }).errors).toEqual([
      'OTEL_LOGS_EXPORTER must be otlp or none (got "console")',
    ]);
  });

  it("reads the export interval in milliseconds, within 1 second and 10 minutes", () => {
    const withInterval = (value) =>
      parse({
        OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
        OTEL_EXPORTER_OTLP_HEADERS: HEADERS,
        OTEL_METRIC_EXPORT_INTERVAL: value,
      });

    expect(withInterval("5000").settings.exportIntervalMs).toBe(5000);
    for (const bad of ["999", "600001", "1.5", "soon"]) {
      expect(withInterval(bad).errors).toEqual([
        `OTEL_METRIC_EXPORT_INTERVAL must be a whole number of milliseconds from 1000 to 600000 (got "${bad}")`,
      ]);
    }
  });

  it("takes the service version from the commit Render deploys, shortened", () => {
    const { settings } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: HEADERS,
      RENDER_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    });

    expect(settings.serviceVersion).toBe("0123456789ab");
  });

  it("ignores a commit that is not a hex commit id", () => {
    const { settings } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: HEADERS,
      RENDER_GIT_COMMIT: "someone@example.com",
    });

    expect(settings.serviceVersion).toBe("unknown");
  });

  it("ignores OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES, so the resource stays ours", () => {
    const { settings } = parse({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: HEADERS,
      OTEL_SERVICE_NAME: "someone-else",
      OTEL_RESOURCE_ATTRIBUTES: "user.email=a@b.c",
    });

    expect(JSON.stringify(settings)).not.toMatch(/someone-else|a@b\.c/);
  });
});
