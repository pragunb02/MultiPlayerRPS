import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLIENT_COMMON_FIELDS,
  CONTROL_PATTERN,
  fitsTelemetryField,
  GAMES,
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_EVENTS,
  TELEMETRY_ROUTES,
} from "@classicade/shared";
import { exampleTelemetryEvent } from "@classicade/shared/testing";
import { LEGACY_ROUTES, ROUTES } from "../../app/paths.js";
import { createTelemetryClient } from "./client.js";
import { routeOf } from "./routeOf.js";

const clientNames = TELEMETRY_EVENT_NAMES.filter((name) => TELEMETRY_EVENTS[name].by === "client");
// What must never leave the browser: a player id, an email, an address, a room code, a URL.
const FORBIDDEN = [
  /(?:guest|user|bot|deleted)_[0-9a-f]/,
  /@/,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  /\b[A-HJ-NP-Z2-9]{6}\b/,
  /https?:/,
  /[?#]/,
];

/** Builds every event through the real client and gives back the payloads it would send. */
function payloads(context) {
  const sent = [];
  const client = createTelemetryClient({
    build: "0.1.0+abc1234",
    send: async (body) => sent.push(JSON.parse(body)) > 0,
    beacon: (body) => sent.push(JSON.parse(body)) > 0,
    isOff: () => false,
    viewportWidth: () => 390,
    setTimer: () => 0,
    clearTimer: () => {},
    strict: true,
  });
  clientNames.forEach((name) => {
    const example = exampleTelemetryEvent(name, { withOptional: true });
    const fields = Object.fromEntries(
      Object.entries(example).filter(([key]) => key !== "name" && !(key in CLIENT_COMMON_FIELDS)),
    );
    client.track(name, fields, context);
  });
  client.flushNow();
  return sent;
}

describe("telemetry payloads (CC-174, ADR-034)", () => {
  // AC-4 (CC-174)
  it("every payload carries only catalogue fields", () => {
    const sent = payloads({ route: routeOf("/games/chess/rooms/AB2CD3"), playerKind: "guest" });

    const events = sent.flatMap((batch) => {
      expect(Object.keys(batch).sort()).toEqual(["build", "events"]);
      return batch.events;
    });
    expect(events.map(({ name }) => name)).toEqual(clientNames);
    events.forEach(({ name, ...fields }) => {
      const allowed = { ...CLIENT_COMMON_FIELDS, ...TELEMETRY_EVENTS[name].fields };
      Object.entries(fields).forEach(([key, value]) => {
        expect({ name, key, known: key in allowed }).toEqual({ name, key, known: true });
        expect({ name, key, fits: fitsTelemetryField(allowed[key], value) }).toEqual({
          name,
          key,
          fits: true,
        });
      });
      Object.values(fields)
        .filter((value) => typeof value === "string")
        .forEach((value) => FORBIDDEN.forEach((pattern) => expect(value).not.toMatch(pattern)));
    });
    expect(events[0].route).toBe("/games/chess/rooms/:code");
  });

  it("every screen of paths.js is a telemetry route, with codes, handles and tokens left as templates", () => {
    const filled = (route) =>
      `/${route
        .replace(":slug", "chess")
        .replace(":code", "AB2CD3")
        .replace(":handle", "q7k2m9x4p1")
        .replace(":token", "AbCdEfGhIjKlMnOpQrSt_-")
        .replace(":kind", "chess")
        .replace(":board", "weekly")
        .replace(":section", "players")}`;
    [
      ...Object.values(ROUTES),
      ...Object.values(LEGACY_ROUTES).filter((route) => !route.includes(".")),
    ].forEach((route) => {
      const telemetryRoute = routeOf(filled(route));
      expect({ route, known: TELEMETRY_ROUTES.includes(telemetryRoute) }).toEqual({ route, known: true });
      FORBIDDEN.forEach((pattern) => expect(telemetryRoute).not.toMatch(pattern));
    });
    expect(routeOf("/")).toBe("/");
    expect(routeOf("/games/tic-tac-toe/rooms/AB2CD3")).toBe("/games/tic-tac-toe/rooms/:code");
    expect(routeOf("/games/not-a-game")).toBe("/games/:slug");
    expect(routeOf("/admin/feedback")).toBe("/admin/feedback");
    expect(routeOf("/admin/players")).toBe("/admin/:section");
    expect(routeOf("/players/q7k2m9x4p1")).toBe("/players/:handle");
    expect(routeOf("/nowhere/at/all")).toBe("not_found");
    expect(GAMES.every(({ slug }) => routeOf(`/games/${slug}`) === `/games/${slug}`)).toBe(true);
  });
});

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** The web app's source files, tests and test helpers left out. */
function sourceFiles(folder = SRC) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)
      ? [readFileSync(full, "utf8")]
      : [];
  });
}
const NAMES = /(?:data-cc-control|control)="([^"]+)"|useAction\([^;]*?\{\s*id:\s*"([^"]+)"/gs;

describe("control names (CC-170, CC-174)", () => {
  it("every control name written in the source fits the catalogue's pattern, so counts can carry it", () => {
    const names = sourceFiles().flatMap((text) =>
      [...text.matchAll(NAMES)].map((match) => match[1] ?? match[2]),
    );

    expect(names.length).toBeGreaterThan(100);
    expect([...new Set(names)].filter((name) => !CONTROL_PATTERN.test(name))).toEqual([]);
  });
});
