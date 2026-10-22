import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exampleTelemetryEvent, exampleValue } from "@classicade/shared/testing";
import {
  API_ENDPOINTS,
  bucketOf,
  checkTelemetryEvent,
  CLIENT_COMMON_FIELDS,
  CONTROL_PATTERN,
  endpointOf,
  fitsTelemetryField,
  GAMES,
  isTelemetryBuild,
  OTHER_ENDPOINT,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  roundMs,
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_EVENTS,
  TELEMETRY_ROUTES,
  TELEMETRY_SOURCES,
  telemetryEventNamed,
} from "../index.js";

const CATALOGUE_DOC = readFileSync(new URL("../../../../docs/analytics/EVENTS.md", import.meta.url), "utf8");
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ROOM_CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const EMAIL = /@/;
const IP = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[0-9a-f]{1,4}:[0-9a-f]{1,4}:/i;
const ID_LIKE = /(?:guest|user|bot|deleted)_[0-9a-f]/;

const clientNames = TELEMETRY_EVENT_NAMES.filter(
  (name) => TELEMETRY_EVENTS[name].by === TELEMETRY_SOURCES.CLIENT,
);
const serverNames = TELEMETRY_EVENT_NAMES.filter(
  (name) => TELEMETRY_EVENTS[name].by === TELEMETRY_SOURCES.SERVER,
);

describe("the telemetry catalogue (CC-174, CC-175, EVENTS.md)", () => {
  it("names every event in snake case, past tense, at most 40 characters, and each is in EVENTS.md", () => {
    TELEMETRY_EVENT_NAMES.forEach((name) => {
      expect(name).toMatch(SNAKE);
      expect(name.length).toBeLessThanOrEqual(40);
      expect(name).toMatch(/(?:ed|_started|_measured)$/);
      expect(CATALOGUE_DOC).toContain(`\`${name}\``);
    });
  });

  it("names every field in snake case", () => {
    TELEMETRY_EVENT_NAMES.forEach((name) =>
      Object.keys(TELEMETRY_EVENTS[name].fields).forEach((field) => expect(field).toMatch(SNAKE)),
    );
  });

  it("every value on every list is a fixed word: no room code, email, address or player id", () => {
    const lists = [
      ...Object.values(CLIENT_COMMON_FIELDS),
      ...TELEMETRY_EVENT_NAMES.flatMap((name) => Object.values(TELEMETRY_EVENTS[name].fields)),
    ].filter((field) => field.kind === "list");
    const values = lists.flatMap((field) => field.values).map(String);

    expect(values.filter((value) => ROOM_CODE.test(value) || EMAIL.test(value) || IP.test(value))).toEqual(
      [],
    );
    expect(values.filter((value) => ID_LIKE.test(value))).toEqual([]);
  });

  it("routes are templates, with only a game's slug ever filled in", () => {
    const slugs = GAMES.map(({ slug }) => slug);
    TELEMETRY_ROUTES.filter((route) => route.startsWith("/")).forEach((route) => {
      const filled = route.split("/").filter((part) => part !== "" && !part.startsWith(":"));
      expect(filled.every((part) => /^[a-z-]+$/.test(part))).toBe(true);
    });
    expect(TELEMETRY_ROUTES).toContain(`/games/${slugs[0]}/rooms/:code`);
    expect(TELEMETRY_ROUTES).toContain("/games/:slug/rooms/:code");
  });

  it("a control name is lowercase words and dots, never a code, an id or an email", () => {
    ["home.play_guest", "admin.range.last7", "feedback.type.bug", "room.rematch.ask"].forEach((name) =>
      expect(CONTROL_PATTERN.test(name)).toBe(true),
    );
    [
      "room.AB2CD3",
      "user_0123456789abcdef01234567",
      "seat.user_0123456789abcdef01234567",
      "guest_00000000-0000-4000-8000-000000000001",
      "me@example.com",
      "a.b.c.d.e.f.g",
      "10.0.0.1",
      "Home.play",
    ].forEach((name) => expect(CONTROL_PATTERN.test(name)).toBe(false));
  });

  it("a build is the web stamp or the server's calendar version", () => {
    ["0.1.0+abc1234", "0.1.0+local", "2026.10.20+a40ce5b", "dev", "unknown"].forEach((build) =>
      expect(isTelemetryBuild(build)).toBe(true),
    );
    ["0.1.0+ABC1234", "AB2CD3", "0.1.0+abc1234@x", "", 7].forEach((build) =>
      expect(isTelemetryBuild(build)).toBe(false),
    );
  });

  it("an unknown event name throws", () => {
    expect(() => telemetryEventNamed("page_view")).toThrow(RangeError);
    expect(telemetryEventNamed("page_viewed").by).toBe(TELEMETRY_SOURCES.CLIENT);
  });
});

describe("checkTelemetryEvent (CC-175)", () => {
  it.each(clientNames)("keeps a valid %s from the browser", (name) => {
    const event = exampleTelemetryEvent(name, { withOptional: true });

    expect(checkTelemetryEvent(event, TELEMETRY_SOURCES.CLIENT)).toEqual({ ok: true, event });
  });

  it.each(serverNames)("keeps a valid %s from the server, and never from a browser", (name) => {
    const event = exampleTelemetryEvent(name);

    expect(checkTelemetryEvent(event, TELEMETRY_SOURCES.SERVER).ok).toBe(true);
    expect(checkTelemetryEvent(event, TELEMETRY_SOURCES.CLIENT)).toEqual({
      ok: false,
      problem: "wrong source",
    });
  });

  it("refuses an unknown name, an extra key, a missing field and a value outside its list", () => {
    const valid = exampleTelemetryEvent("control_pressed");

    expect(checkTelemetryEvent({ ...valid, name: "page_view" }, "client").ok).toBe(false);
    expect(checkTelemetryEvent({ ...valid, player_id: "user_1" }, "client")).toEqual({
      ok: false,
      problem: "unknown field",
    });
    expect(checkTelemetryEvent({ ...valid, control: undefined }, "client")).toEqual({
      ok: false,
      problem: "missing control",
    });
    expect(checkTelemetryEvent({ ...valid, device: "watch" }, "client")).toEqual({
      ok: false,
      problem: "bad device",
    });
    expect(checkTelemetryEvent({ ...valid, route: "/games/chess/rooms/AB2CD3" }, "client").ok).toBe(false);
    expect(checkTelemetryEvent("page_viewed", "client").ok).toBe(false);
    expect(checkTelemetryEvent(["page_viewed"], "client").ok).toBe(false);
  });

  it("a dead or rage click names a control or an element, exactly one", () => {
    const base = exampleTelemetryEvent("dead_clicked");
    const { control, ...withNeither } = base;

    expect(control).toBeDefined();
    expect(checkTelemetryEvent(withNeither, "client").ok).toBe(false);
    expect(checkTelemetryEvent({ ...base, element: "img" }, "client").ok).toBe(false);
    expect(checkTelemetryEvent({ ...withNeither, element: "div:button" }, "client").ok).toBe(true);
    expect(checkTelemetryEvent({ ...withNeither, element: "iframe" }, "client").ok).toBe(false);
  });

  it("times are whole milliseconds rounded to 10, and a layout shift has two decimals", () => {
    const speed = exampleTelemetryEvent("page_speed_measured");

    expect(checkTelemetryEvent({ ...speed, lcp_ms: 1234 }, "client").ok).toBe(false);
    expect(checkTelemetryEvent({ ...speed, lcp_ms: 1230 }, "client").ok).toBe(true);
    expect(checkTelemetryEvent({ ...speed, lcp_ms: -10 }, "client").ok).toBe(false);
    expect(checkTelemetryEvent({ ...speed, cls: 0.123 }, "client").ok).toBe(false);
    expect(checkTelemetryEvent({ ...speed, cls: 0.12 }, "client").ok).toBe(true);
    expect(roundMs(1234.4, 100_000)).toBe(1230);
    expect(roundMs(10_000_000, 100_000)).toBe(100_000);
  });

  it("answers a copy with only the catalogue's keys, frozen", () => {
    const { event } = /** @type {{ event: object }} */ (
      checkTelemetryEvent(exampleTelemetryEvent("page_viewed"), "client")
    );

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.keys(event).sort()).toEqual(["device", "is_landing", "name", "player_kind", "route"]);
  });
});

describe("endpoints and buckets (CC-174)", () => {
  it("turns an API address into its template, ignoring the query, and anything else into other", () => {
    expect(endpointOf("/api/matches/abc123?limit=5")).toBe("/api/matches/:matchId");
    expect(endpointOf("/api/friends/requests")).toBe("/api/friends/requests");
    expect(endpointOf("/api/friends/someone")).toBe("/api/friends/:handle");
    expect(endpointOf("/api/flags/a_flag/success")).toBe("/api/flags/:name/success");
    expect(endpointOf("/api/nothing/here")).toBe(OTHER_ENDPOINT);
    expect(API_ENDPOINTS.every((endpoint) => endpointOf(endpoint) === endpoint)).toBe(true);
  });

  it("puts a number in its bucket", () => {
    const labels = ["0", "1-5", "6-20", "21+"];
    expect([0, 1, 5, 6, 20, 21, 500].map((value) => bucketOf(value, [1, 6, 21], labels))).toEqual([
      "0",
      "1-5",
      "1-5",
      "6-20",
      "6-20",
      "21+",
      "21+",
    ]);
  });

  it("has an example value for every kind of field, and no value fits a kind it does not know", () => {
    expect(() => exampleValue({ kind: "nothing", optional: false })).toThrow(RangeError);
    expect(fitsTelemetryField({ kind: "nothing", optional: false }, "anything")).toBe(false);
  });
});
