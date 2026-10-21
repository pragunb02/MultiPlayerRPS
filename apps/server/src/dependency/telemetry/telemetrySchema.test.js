import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, GAME_IDS, ROOM_STATUS, SOCKET_EVENTS } from "@classicade/shared";
import { ROUTE_PATTERN, ROUTE_UNMATCHED, SOCKET_OUTCOMES } from "../../utils/operationsMetrics.js";
import { createTelemetrySchema, METRICS, OTHER_METHOD } from "./telemetrySchema.js";

const schema = createTelemetrySchema({ matchSteps: ["record match", "judge"] });
const allows = (rules, key, value) => rules[key] !== undefined && rules[key](value);

describe("createTelemetrySchema", () => {
  it("lists every metric ADR-055 names and nothing else", () => {
    expect(Object.keys(schema.metrics).sort()).toEqual(Object.values(METRICS).sort());
    expect(Object.values(METRICS).sort()).toEqual([
      "accounts.password_checks",
      "bots.thinking.duration",
      "http.server.request.duration",
      "match_pipeline.attempts",
      "match_pipeline.failed",
      "nodejs.eventloop.delay.p50",
      "nodejs.eventloop.delay.p99",
      "process.memory.heap_used",
      "process.memory.rss",
      "realtime.connections",
      "rooms.open",
      "socket.event.duration",
      "telemetry.logs.suppressed",
      "telemetry.scrubbed",
    ]);
  });

  it("gives each metric only its own attribute keys", () => {
    const keys = Object.fromEntries(
      Object.entries(schema.metrics).map(([name, rules]) => [name, Object.keys(rules)]),
    );

    expect(keys).toEqual({
      [METRICS.HTTP_DURATION]: ["http.route", "http.request.method", "http.response.status_class"],
      [METRICS.SOCKET_DURATION]: ["socket.event", "outcome"],
      [METRICS.ROOMS_OPEN]: ["game", "status"],
      [METRICS.CONNECTIONS]: [],
      [METRICS.PIPELINE_ATTEMPTS]: ["step"],
      [METRICS.PIPELINE_FAILED]: ["step"],
      [METRICS.BOT_THINKING_DURATION]: ["game", "outcome"],
      [METRICS.PASSWORD_CHECKS]: ["outcome"],
      [METRICS.EVENT_LOOP_P50]: [],
      [METRICS.EVENT_LOOP_P99]: [],
      [METRICS.MEMORY_RSS]: [],
      [METRICS.MEMORY_HEAP_USED]: [],
      [METRICS.SCRUBBED]: ["signal", "key"],
      [METRICS.LOGS_SUPPRESSED]: [],
    });
  });

  it.each([
    "/api/auth/login",
    "/api/leaderboards/:boardId",
    "/api/account/birth-year",
    "/robots.txt",
    "/health",
    "/",
    ROUTE_UNMATCHED,
    ROUTE_PATTERN,
  ])("allows the route template %s", (route) => {
    expect(allows(schema.metrics[METRICS.HTTP_DURATION], "http.route", route)).toBe(true);
  });

  it.each([
    ["a room code", "/room/AB2CDE"],
    ["a player id", "/api/players/user_65f0c2a1b2c3d4e5f6a7b8c9"],
    ["a guest id", "/api/players/guest_1f0e"],
    ["an email", "/api/sam@example.com"],
    ["an IP address", "/203.0.113.7"],
    ["a query string", "/api/matches?page=2"],
    ["a match id", "/api/matches/3f2504e0-4f89-11d3-9a0c-0305e82c3301"],
    ["a word with a digit", "/api/v2"],
    ["no leading slash", "api/session"],
    ["a trailing slash", "/api/"],
    ["more than 128 characters", `/${"a".repeat(128)}`],
  ])("refuses a route holding %s", (_, route) => {
    expect(allows(schema.metrics[METRICS.HTTP_DURATION], "http.route", route)).toBe(false);
  });

  it("allows the known methods and status classes only", () => {
    const rules = schema.metrics[METRICS.HTTP_DURATION];

    expect(["GET", "POST", "DELETE", OTHER_METHOD].every((m) => rules["http.request.method"](m))).toBe(true);
    expect(rules["http.request.method"]("get")).toBe(false);
    expect(["2xx", "4xx", "5xx"].every((c) => rules["http.response.status_class"](c))).toBe(true);
    expect(rules["http.response.status_class"]("404")).toBe(false);
  });

  it("allows socket events from SOCKET_EVENTS and the four outcomes only", () => {
    const rules = schema.metrics[METRICS.SOCKET_DURATION];

    expect(rules["socket.event"](SOCKET_EVENTS.GAME_MOVE)).toBe(true);
    expect(rules["socket.event"]("room:AB2CDE")).toBe(false);
    expect(Object.values(SOCKET_OUTCOMES)).toEqual(["ok", "refused", "failed", "rate_limited"]);
    expect(Object.values(SOCKET_OUTCOMES).every((o) => rules.outcome(o))).toBe(true);
    expect(rules.outcome("timeout")).toBe(false);
  });

  it("allows games from the catalogue, room statuses and the given pipeline steps", () => {
    expect(schema.metrics[METRICS.ROOMS_OPEN].game(GAME_IDS.CHESS)).toBe(true);
    expect(schema.metrics[METRICS.ROOMS_OPEN].game("ludo")).toBe(false);
    expect(schema.metrics[METRICS.ROOMS_OPEN].status(ROOM_STATUS.PLAYING)).toBe(true);
    expect(schema.metrics[METRICS.ROOMS_OPEN].status("closed")).toBe(false);
    expect(schema.metrics[METRICS.PIPELINE_FAILED].step("judge")).toBe(true);
    expect(schema.metrics[METRICS.PIPELINE_FAILED].step("apply bonus")).toBe(false);
  });

  it("allows the computer players' thinking by game and the four outcomes only (ADR-067)", () => {
    const rules = schema.metrics[METRICS.BOT_THINKING_DURATION];

    expect(["ok", "timeout", "crashed", "failed"].every(rules.outcome)).toBe(true);
    expect(rules.outcome("closed")).toBe(false);
    expect(rules.game(GAME_IDS.CHESS)).toBe(true);
    expect(rules.game("bot_queenvee_strong")).toBe(false);
    expect(schema.logs.lines["computer player ran out of time to think"]).toBe(40);
    expect(schema.logs.lines["computer player's thinking crashed"]).toBe(40);
  });

  it("allows new password checks by their four outcomes only, with nothing about the player (CC-261)", () => {
    const rules = schema.metrics[METRICS.PASSWORD_CHECKS];

    expect(METRICS.PASSWORD_CHECKS).toBe("accounts.password_checks");
    expect(["clear", "common", "breached", "unavailable"].every(rules.outcome)).toBe(true);
    expect(rules.outcome("riya@example.com")).toBe(false);
    expect(rules.outcome("ok")).toBe(false);
    expect(schema.logs.lines["saving the upgraded password hash failed"]).toBe(40);
  });

  it("allows a scrubbed key only when it is a known key, or the word unknown", () => {
    const rules = schema.metrics[METRICS.SCRUBBED];

    expect(
      ["http.route", "error.type", "service.version", "body", "metric", "eventName", "unknown"].every(
        rules.key,
      ),
    ).toBe(true);
    expect(rules.key("user.email")).toBe(false);
    expect(["metrics", "logs"].every(rules.signal)).toBe(true);
    expect(rules.signal("traces")).toBe(false);
  });

  it("forwards the named lines from their own level, never below info, and request lines only at error level", () => {
    expect(schema.logs.lines["match pipeline failed"]).toBe(50);
    expect(schema.logs.lines["socket handler failed"]).toBe(50);
    expect(schema.logs.lines["computer player will try again"]).toBe(40);
    expect(schema.logs.lines["request completed"]).toBe(50);
    expect(schema.logs.lines["socket connected"]).toBeUndefined();
    expect(schema.logs.lines["server listening"]).toBe(30);
    expect(schema.logs.lines["shutting down"]).toBe(30);
    expect(schema.logs.lines["telemetry export failed"]).toBeUndefined();
  });

  it("names only lines the server really writes, so a renamed message cannot quietly stop being forwarded", () => {
    const src = fileURLToPath(new URL("../..", import.meta.url));
    const code = readdirSync(src, { recursive: true })
      .filter((file) => file.endsWith(".js") && !file.endsWith(".test.js") && !file.includes("dependency"))
      .map((file) => readFileSync(path.join(src, file), "utf8"))
      .join("\n");

    for (const message of Object.keys(schema.logs.lines)) {
      expect(code.includes(`"${message}"`), message).toBe(true);
    }
  });

  it("never forwards anything below info", () => {
    expect(Math.min(...Object.values(schema.logs.lines))).toBe(30);
  });

  it("allows only the ADR's log fields, each with a closed rule", () => {
    const { fields } = schema.logs;

    expect(Object.keys(fields).sort()).toEqual(
      ["attempts", "error.type", "errorCode", "event", "game", "route", "status", "step"].sort(),
    );
    expect(fields.errorCode(ERROR_CODES.INTERNAL)).toBe(true);
    expect(fields.errorCode("E11000 duplicate key sam@example.com")).toBe(false);
    expect(fields["error.type"]("MongoServerError")).toBe(true);
    expect(fields["error.type"]("Error: sam@example.com")).toBe(false);
    expect(fields.attempts(10)).toBe(true);
    expect(fields.attempts(1.5)).toBe(false);
    expect(fields.attempts("10")).toBe(false);
    expect(fields.status(503)).toBe(true);
    expect(fields.status(ROOM_STATUS.WAITING)).toBe(true);
    expect(fields.status(42)).toBe(false);
    expect(fields.event(SOCKET_EVENTS.ROOM_JOIN)).toBe(true);
    expect(fields.route("/room/AB2CDE")).toBe(false);
  });

  it("describes the server with four fixed resource keys", () => {
    const { resource } = schema;

    expect(Object.keys(resource)).toEqual([
      "service.name",
      "service.version",
      "service.instance.id",
      "deployment.environment.name",
    ]);
    expect(resource["service.instance.id"]("2b1d0c9e-8f7a-4b6c-9d5e-4f3a2b1c0d9e")).toBe(true);
    expect(resource["service.instance.id"]("srv-sam-laptop")).toBe(false);
    expect(resource["service.name"]("classicade-server")).toBe(true);
    expect(resource["service.name"]("unknown_service:node")).toBe(false);
    expect(resource["service.version"]("0123456789ab")).toBe(true);
    expect(resource["service.version"]("unknown")).toBe(true);
    expect(resource["service.version"]("v1 by sam")).toBe(false);
    expect(resource["deployment.environment.name"]("production")).toBe(true);
  });

  it("is frozen all the way down", () => {
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.metrics[METRICS.HTTP_DURATION])).toBe(true);
    expect(Object.isFrozen(schema.logs.lines)).toBe(true);
  });
});
