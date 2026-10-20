import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { ProtobufLogsSerializer, ProtobufMetricsSerializer } from "@opentelemetry/otlp-transformer";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { startTelemetry } from "./dependency/telemetry/telemetry.js";
import { createTelemetrySchema, METRICS } from "./dependency/telemetry/telemetrySchema.js";
import { MATCH_STEPS, startServer } from "./server.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";
import { createLogger } from "./utils/logger.js";

// ADR-055 point 7: nothing personal leaves the server. The real composition root runs on an in-memory MongoDB with
// telemetry switched on and exporting into memory, while players sign up, log in (also with a wrong password and as
// a legacy player), play as guests behind a forwarded address, make and join rooms, finish a game whose pipeline
// step then fails for good, and ask for addresses holding a room code, an email and a match id. Then every exported
// key and value is checked against the allowlist, and each planted canary is searched for in the bytes that would
// go on the wire.

const CANARY = Object.freeze({
  email: "canary.sam@example.com",
  legacyEmail: "canary.legacy@example.com",
  username: "CanarySam",
  legacyUsername: "Canary Legacy",
  password: "canary password 1",
  ip: "203.0.113.77",
});
const SCHEMA = createTelemetrySchema({ matchSteps: Object.values(MATCH_STEPS) });

let mongo;
let run;

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

/** Polls until `probe` answers something other than undefined, failing after 10 s. */
async function eventually(probe, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Drives every flow once and answers what was exported and the values that must not appear in it. */
async function driveEverything() {
  const uri = mongo.uri("telemetry-privacy");
  const seed = await mongoose.createConnection(uri).asPromise();
  await seed.db.collection("users").insertOne({
    username: CANARY.legacyUsername,
    email: CANARY.legacyEmail,
    password: bcrypt.hashSync(CANARY.password, 4),
    level: 3,
  });
  await seed.close();

  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const logExporter = new InMemoryLogRecordExporter();
  const telemetry = await startTelemetry({
    settings: {
      enabled: true,
      endpoint: "http://127.0.0.1:1",
      logs: true,
      exportIntervalMs: 600_000,
      serviceVersion: "unknown",
      environment: "test",
    },
    matchSteps: Object.values(MATCH_STEPS),
    onExportFailed: () => undefined,
    exporters: { metrics: metricExporter, logs: logExporter },
  });
  const stdout = [];
  const logger = createLogger({
    level: "info",
    destination: { write: (line) => stdout.push(line) },
    forward: telemetry.forward,
  });
  // The gamification step fails for good on its first attempt, with personal data in the error's message.
  const failGamification = (steps) =>
    steps.map((step) =>
      step.name === MATCH_STEPS.GAMIFICATION
        ? {
            ...step,
            run: async () => {
              throw new Error(`gamification store down for ${CANARY.email}`);
            },
          }
        : step,
    );
  const server = await startServer({
    config: testConfig({ MONGO_URI: uri, TRUST_PROXY_HOPS: "1" }),
    logger,
    metrics: telemetry.metrics,
    pipeline: { steps: failGamification, policy: { maxAttempts: 1 } },
  });
  const url = `http://127.0.0.1:${server.port}`;
  const sockets = [];
  const seen = { sessions: [], playerIds: [], socketIds: [], roomCodes: [], matchIds: [] };
  const call = (path, { method = "GET", body, cookie } = {}) =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        "X-Forwarded-For": CANARY.ip,
        ...(body && { "Content-Type": "application/json" }),
        ...(cookie && { cookie }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
  const cookieOf = (res) => res.headers.get("set-cookie")?.split(";")[0];
  const remember = async (res) => {
    const cookie = cookieOf(res);
    if (cookie) seen.sessions.push(cookie.split("=")[1]);
    const body = await res.json();
    if (body.identity?.id) seen.playerIds.push(body.identity.id);
    return { cookie, body };
  };
  const guest = async () => {
    const { cookie, body } = await remember(await call("/api/session/guest", { method: "POST" }));
    const socket = connect(url, {
      transports: ["websocket"],
      extraHeaders: { cookie, "X-Forwarded-For": CANARY.ip },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    seen.socketIds.push(socket.id);
    return { cookie, socket, identity: body.identity };
  };
  const send = (socket, event, payload) => socket.timeout(3_000).emitWithAck(event, payload);

  try {
    // Accounts: sign up, log in, a wrong password, a legacy player, an email in the path.
    const signedUp = await remember(
      await call("/api/auth/signup", {
        method: "POST",
        body: { username: CANARY.username, email: CANARY.email, password: CANARY.password },
      }),
    );
    expect(signedUp.body.identity.displayName).toBe(CANARY.username);
    await remember(
      await call("/api/auth/login", {
        method: "POST",
        body: { email: CANARY.email, password: CANARY.password },
      }),
    );
    expect(
      (await call("/api/auth/login", { method: "POST", body: { email: CANARY.email, password: "wrong 1" } }))
        .status,
    ).toBe(401);
    const legacy = await remember(
      await call("/api/auth/login", {
        method: "POST",
        body: { email: CANARY.legacyEmail, password: CANARY.password },
      }),
    );
    expect(legacy.body.identity.kind).toBe("user");
    await call(`/api/players/${encodeURIComponent(CANARY.email)}`);

    // Guests play one game of Rock Paper Scissors to the end.
    const alice = await guest();
    const bob = await guest();
    const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "rps",
      options: { bestOf: 1 },
    });
    seen.roomCodes.push(room.code);
    await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });
    await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "scissors" } });
    expect((await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: "ZZZ999" })).ok).toBe(false);

    // The game reaches the match pipeline, whose gamification step then fails for good.
    const failed = await eventually(() =>
      stdout.map((line) => JSON.parse(line)).find((entry) => entry.msg === "match pipeline failed"),
    );
    seen.matchIds.push(failed.matchId);
    await call(`/api/matches/${failed.matchId}`, { cookie: alice.cookie });
    await call(`/room/${room.code}`);
    await call(`/api/rooms/${room.code}?email=${CANARY.email}`);

    // Two flushes, so a value the scrubber had to replace would show in telemetry.scrubbed too.
    await telemetry.flush();
    await telemetry.flush();
    return {
      metrics: metricExporter.getMetrics(),
      logs: logExporter.getFinishedLogRecords(),
      canaries: [
        ...Object.entries(CANARY).filter(([name]) => name !== "password"),
        ...Object.entries(seen).flatMap(([name, values]) => values.map((value) => [name, value])),
      ],
    };
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await server.close();
    await telemetry.shutdown();
  }
}

/** Every data point of every export, with the metric it belongs to. */
const pointsOf = (metrics) =>
  metrics.flatMap((resourceMetrics) =>
    resourceMetrics.scopeMetrics.flatMap((scope) =>
      scope.metrics.flatMap((metric) =>
        metric.dataPoints.map((point) => ({ name: metric.descriptor.name, point })),
      ),
    ),
  );

/** The bytes the exporters would send, as text, so a canary in any field can be found. */
const wire = ({ metrics, logs }) =>
  [
    ...metrics.map((resourceMetrics) => ProtobufMetricsSerializer.serializeRequest(resourceMetrics)),
    ProtobufLogsSerializer.serializeRequest(logs),
  ]
    .map((bytes) => Buffer.from(bytes).toString("latin1"))
    .join("\n");

describe("operations telemetry sends no personal data (ADR-055, integration)", () => {
  beforeAll(async () => {
    run = await driveEverything();
  }, 60_000);

  it("exported the flows it was shown, so the checks below are not checking nothing", () => {
    const points = pointsOf(run.metrics);
    const routes = new Set(
      points
        .filter(({ name }) => name === METRICS.HTTP_DURATION)
        .map(({ point }) => point.attributes["http.route"]),
    );
    const events = new Set(
      points
        .filter(({ name }) => name === METRICS.SOCKET_DURATION)
        .map(({ point }) => point.attributes["socket.event"]),
    );

    expect([...routes]).toEqual(
      expect.arrayContaining([
        "/api/auth/signup",
        "/api/auth/login",
        "/api/session/guest",
        "/api/matches/:matchId",
        "unmatched",
      ]),
    );
    expect([...events]).toEqual(
      expect.arrayContaining([SOCKET_EVENTS.ROOM_CREATE, SOCKET_EVENTS.ROOM_JOIN, SOCKET_EVENTS.GAME_MOVE]),
    );
    expect(points.find(({ name }) => name === METRICS.PIPELINE_FAILED)?.point).toEqual(
      expect.objectContaining({ attributes: { step: MATCH_STEPS.GAMIFICATION }, value: 1 }),
    );
    expect(points.some(({ name }) => name === METRICS.ROOMS_OPEN)).toBe(true);
    expect(run.logs.map(({ body }) => body)).toContain("match pipeline failed");
  });

  it("sends only metrics, keys and values that the allowlist names", () => {
    for (const { name, point } of pointsOf(run.metrics)) {
      const rules = SCHEMA.metrics[name];
      expect(rules, name).toBeDefined();
      for (const [key, value] of Object.entries(point.attributes)) {
        expect(rules[key]?.(value), `${name} ${key}=${value}`).toBe(true);
      }
    }
  });

  it("sends only named log lines with allowed fields", () => {
    for (const record of run.logs) {
      expect(Object.hasOwn(SCHEMA.logs.lines, record.body), record.body).toBe(true);
      for (const [key, value] of Object.entries(record.attributes)) {
        expect(SCHEMA.logs.fields[key]?.(value), `${record.body} ${key}=${value}`).toBe(true);
      }
    }
  });

  it("describes the server only by its four resource keys", () => {
    const resources = [
      ...run.metrics.map(({ resource }) => resource),
      ...run.logs.map(({ resource }) => resource),
    ];

    for (const resource of resources) {
      expect(Object.keys(resource.attributes).sort()).toEqual([
        "deployment.environment.name",
        "service.instance.id",
        "service.name",
        "service.version",
      ]);
    }
  });

  it("needed no scrubbing: every value was clean where it was recorded", () => {
    expect(pointsOf(run.metrics).filter(({ name }) => name === METRICS.SCRUBBED)).toEqual([]);
  });

  it("puts none of the planted canaries anywhere in the bytes that would leave", () => {
    const sent = wire(run);

    expect(run.canaries.length).toBeGreaterThan(12);
    for (const [name, value] of run.canaries) {
      expect(sent.includes(value), `${name} ${value}`).toBe(false);
      expect(sent.toLowerCase().includes(value.toLowerCase()), `${name} ${value}`).toBe(false);
    }
  });
});
