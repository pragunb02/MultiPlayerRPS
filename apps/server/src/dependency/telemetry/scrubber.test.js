import { describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createScrubber } from "./scrubber.js";
import { createTelemetrySchema, METRICS } from "./telemetrySchema.js";

const schema = createTelemetrySchema({ matchSteps: ["record match"] });
const TRUSTED = Object.freeze({
  attributes: Object.freeze({
    "service.name": "classicade-server",
    "service.version": "unknown",
    "deployment.environment.name": "test",
  }),
});

// Personal data a mistake could put into telemetry. None of it may leave (ADR-055 point 2).
const LEAKS = Object.freeze({
  email: "canary.sam@example.com",
  ip: "203.0.113.77",
  playerId: "user_65f0c2a1b2c3d4e5f6a7b8c9",
  guestId: "guest_2b1d0c9e-8f7a-4b6c-9d5e-4f3a2b1c0d9e",
  sessionId: "s:Kq3x9ZpLw0vY7uTn2RmB5cJ8aH1dG4fE",
  roomCode: "AB2CDE",
  matchId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  socketId: "pV3n8K2qL9xT0wZaAAAB",
  rawPath: "/room/AB2CDE",
});

function setup() {
  const scrubbed = [];
  const scrubber = createScrubber({ schema, resource: TRUSTED, onScrubbed: (item) => scrubbed.push(item) });
  return { scrubber, scrubbed };
}

/** One export of one metric with the given data point attributes, shaped like the SDK's ResourceMetrics. */
const exportOf = ({ name = METRICS.HTTP_DURATION, attributes, resource = TRUSTED }) => ({
  resource,
  scopeMetrics: [
    {
      scope: { name: "classicade-server" },
      metrics: [
        {
          descriptor: { name, unit: "ms", description: "", valueType: 1 },
          dataPointType: 0,
          aggregationTemporality: 1,
          dataPoints: [{ startTime: [0, 0], endTime: [1, 0], attributes, value: { count: 1, sum: 3 } }],
        },
      ],
    },
  ],
});

const goodHttp = Object.freeze({
  "http.route": "/api/session",
  "http.request.method": "GET",
  "http.response.status_class": "2xx",
});

const pointsOf = (resourceMetrics) =>
  resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics.flatMap((metric) => metric.dataPoints));

/** A log record as the forwarder hands it to the Logs SDK, after the SDK made it readable. */
const recordOf = ({ body = "socket handler failed", attributes = {}, resource = TRUSTED } = {}) => ({
  hrTime: [1, 0],
  hrTimeObserved: [1, 0],
  severityNumber: 17,
  severityText: "ERROR",
  body,
  attributes,
  droppedAttributesCount: 0,
  resource,
  instrumentationScope: { name: "classicade-server" },
});

describe("createScrubber, metrics", () => {
  it("passes a clean export through unchanged and counts nothing", () => {
    const { scrubber, scrubbed } = setup();
    const clean = exportOf({ attributes: goodHttp });

    expect(scrubber.scrubMetrics(clean)).toEqual(clean);
    expect(scrubbed).toEqual([]);
  });

  it.each(Object.entries(LEAKS))("replaces a route holding a %s with other, and counts it", (_, leak) => {
    const { scrubber, scrubbed } = setup();
    const out = scrubber.scrubMetrics(exportOf({ attributes: { ...goodHttp, "http.route": leak } }));

    expect(pointsOf(out)[0].attributes["http.route"]).toBe("other");
    expect(JSON.stringify(out)).not.toContain(leak);
    expect(scrubbed).toEqual([{ signal: "metrics", key: "http.route" }]);
  });

  it.each(Object.entries(LEAKS))(
    "removes an attribute key the schema does not list, holding a %s",
    (_, leak) => {
      const { scrubber, scrubbed } = setup();
      const out = scrubber.scrubMetrics(exportOf({ attributes: { ...goodHttp, "client.address": leak } }));

      expect(pointsOf(out)[0].attributes).toEqual(goodHttp);
      expect(JSON.stringify(out)).not.toContain(leak);
      expect(scrubbed).toEqual([{ signal: "metrics", key: "unknown" }]);
    },
  );

  it("replaces a socket event that is not a SOCKET_EVENTS name", () => {
    const { scrubber } = setup();
    const out = scrubber.scrubMetrics(
      exportOf({
        name: METRICS.SOCKET_DURATION,
        attributes: { "socket.event": `room:${LEAKS.roomCode}`, outcome: "ok" },
      }),
    );

    expect(pointsOf(out)[0].attributes).toEqual({ "socket.event": "other", outcome: "ok" });
  });

  it("keeps a known socket event", () => {
    const { scrubber, scrubbed } = setup();
    const attributes = { "socket.event": SOCKET_EVENTS.ROOM_JOIN, outcome: "refused" };

    expect(
      pointsOf(scrubber.scrubMetrics(exportOf({ name: METRICS.SOCKET_DURATION, attributes })))[0].attributes,
    ).toEqual(attributes);
    expect(scrubbed).toEqual([]);
  });

  it("drops a metric the schema does not list, with everything in it", () => {
    const { scrubber, scrubbed } = setup();
    const out = scrubber.scrubMetrics(exportOf({ name: "http.client.ip", attributes: { ip: LEAKS.ip } }));

    expect(out.scopeMetrics[0].metrics).toEqual([]);
    expect(JSON.stringify(out)).not.toContain(LEAKS.ip);
    expect(scrubbed).toEqual([{ signal: "metrics", key: "metric" }]);
  });

  it("puts back the server's own resource when the one exported carries anything else", () => {
    const { scrubber, scrubbed } = setup();
    const resource = { attributes: { ...TRUSTED.attributes, "host.name": LEAKS.email } };
    const out = scrubber.scrubMetrics(exportOf({ attributes: goodHttp, resource }));

    expect(out.resource).toBe(TRUSTED);
    expect(JSON.stringify(out)).not.toContain(LEAKS.email);
    expect(scrubbed).toEqual([{ signal: "metrics", key: "unknown" }]);
  });

  it("keeps a resource that is a clean copy of the server's own", () => {
    const { scrubber, scrubbed } = setup();
    const copy = { attributes: { ...TRUSTED.attributes } };

    expect(scrubber.scrubMetrics(exportOf({ attributes: goodHttp, resource: copy })).resource).toBe(copy);
    expect(scrubbed).toEqual([]);
  });

  it("puts back the server's own resource when a resource value breaks its rule", () => {
    const { scrubber, scrubbed } = setup();
    const resource = { attributes: { ...TRUSTED.attributes, "service.version": LEAKS.email } };

    expect(scrubber.scrubMetrics(exportOf({ attributes: goodHttp, resource })).resource).toBe(TRUSTED);
    expect(scrubbed).toEqual([{ signal: "metrics", key: "service.version" }]);
  });

  it("never changes the export it was given", () => {
    const { scrubber } = setup();
    const original = exportOf({ attributes: { ...goodHttp, "http.route": LEAKS.rawPath } });

    scrubber.scrubMetrics(original);

    expect(pointsOf(original)[0].attributes["http.route"]).toBe(LEAKS.rawPath);
  });
});

describe("createScrubber, logs", () => {
  it("passes a named line with allowed fields through unchanged", () => {
    const { scrubber, scrubbed } = setup();
    const record = recordOf({ attributes: { event: SOCKET_EVENTS.GAME_MOVE, "error.type": "TypeError" } });

    expect(scrubber.scrubLogRecords([record])).toEqual([record]);
    expect(scrubbed).toEqual([]);
  });

  it.each(Object.entries(LEAKS))("replaces a body that is not a named line, holding a %s", (_, leak) => {
    const { scrubber, scrubbed } = setup();
    const [out] = scrubber.scrubLogRecords([recordOf({ body: `login failed for ${leak}` })]);

    expect(out.body).toBe("other");
    expect(JSON.stringify(out)).not.toContain(leak);
    expect(scrubbed).toEqual([{ signal: "logs", key: "body" }]);
  });

  it.each(Object.entries(LEAKS))("removes a field the schema does not list, holding a %s", (_, leak) => {
    const { scrubber, scrubbed } = setup();
    const [out] = scrubber.scrubLogRecords([
      recordOf({ attributes: { playerId: leak, step: "record match" } }),
    ]);

    expect(out.attributes).toEqual({ step: "record match" });
    expect(JSON.stringify(out)).not.toContain(leak);
    expect(scrubbed).toEqual([{ signal: "logs", key: "unknown" }]);
  });

  it.each(Object.entries(LEAKS))("replaces an allowed field whose value is a %s", (_, leak) => {
    const { scrubber, scrubbed } = setup();
    const [out] = scrubber.scrubLogRecords([recordOf({ attributes: { errorCode: leak } })]);

    expect(out.attributes).toEqual({ errorCode: "other" });
    expect(scrubbed).toEqual([{ signal: "logs", key: "errorCode" }]);
  });

  it("drops an event name and the resource's extra keys", () => {
    const { scrubber, scrubbed } = setup();
    const record = {
      ...recordOf({ resource: { attributes: { "process.owner": "sam" } } }),
      eventName: LEAKS.email,
    };
    const [out] = scrubber.scrubLogRecords([record]);

    expect(out.eventName).toBeUndefined();
    expect(out.resource).toBe(TRUSTED);
    expect(JSON.stringify(out)).not.toMatch(/sam/);
    expect(scrubbed).toEqual([
      { signal: "logs", key: "unknown" },
      { signal: "logs", key: "eventName" },
    ]);
  });

  it("refuses a body that is not text", () => {
    const { scrubber } = setup();
    const [out] = scrubber.scrubLogRecords([recordOf({ body: { email: LEAKS.email } })]);

    expect(out.body).toBe("other");
  });
});
