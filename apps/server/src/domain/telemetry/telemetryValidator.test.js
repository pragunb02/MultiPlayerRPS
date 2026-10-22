import { describe, expect, it } from "vitest";
import { TELEMETRY_EVENT_NAMES, TELEMETRY_EVENTS } from "@classicade/shared";
import { exampleTelemetryEvent } from "@classicade/shared/testing";
import { checkBatch } from "./telemetryValidator.js";

const LIMITS = { maxEvents: 30 };
const BUILD = "0.1.0+abc1234";
const clientNames = TELEMETRY_EVENT_NAMES.filter((name) => TELEMETRY_EVENTS[name].by === "client");

describe("checkBatch (CC-175)", () => {
  // AC-3 (CC-175)
  it("drops only the invalid event", () => {
    const good = exampleTelemetryEvent("control_pressed");
    const batch = {
      build: BUILD,
      events: [
        good,
        { ...good, name: "button_mashed" },
        { ...good, player_id: "user_0123456789abcdef01234567" },
        { ...good, device: "smart fridge" },
        exampleTelemetryEvent("page_viewed"),
      ],
    };

    expect(checkBatch(batch, LIMITS)).toEqual({
      build: BUILD,
      events: [good, exampleTelemetryEvent("page_viewed")],
      invalid: 3,
    });
  });

  it("keeps a valid example of every client event, with every optional field", () => {
    const events = clientNames.map((name) => exampleTelemetryEvent(name, { withOptional: true }));

    expect(checkBatch({ build: BUILD, events }, { maxEvents: events.length })).toEqual({
      build: BUILD,
      events,
      invalid: 0,
    });
  });

  it("drops each event that has any one field outside the catalogue, for every field of every event", () => {
    clientNames.forEach((name) => {
      const event = exampleTelemetryEvent(name);
      Object.keys(event)
        .filter((key) => key !== "name")
        .forEach((key) => {
          const result = checkBatch({ build: BUILD, events: [{ ...event, [key]: "AB2CD3" }] }, LIMITS);
          expect({ name, key, kept: result.events.length }).toEqual({ name, key, kept: 0 });
        });
    });
  });

  it("never takes a server event from a browser", () => {
    const result = checkBatch({ build: BUILD, events: [exampleTelemetryEvent("account_created")] }, LIMITS);

    expect(result).toEqual({ build: BUILD, events: [], invalid: 1 });
  });

  it("drops a whole batch with the wrong shape, a build that is not ours, or too many events", () => {
    const event = exampleTelemetryEvent("page_viewed");

    expect(checkBatch(null, LIMITS).invalid).toBe(1);
    expect(checkBatch([event], LIMITS).invalid).toBe(1);
    expect(checkBatch({ build: BUILD, events: "page_viewed" }, LIMITS).invalid).toBe(1);
    expect(checkBatch({ build: BUILD, events: [event], session: "x" }, LIMITS)).toEqual({
      build: undefined,
      events: [],
      invalid: 1,
    });
    expect(checkBatch({ build: "me@example.com", events: [event, event] }, LIMITS)).toEqual({
      build: undefined,
      events: [],
      invalid: 2,
    });
    expect(checkBatch({ build: BUILD, events: Array(31).fill(event) }, LIMITS)).toEqual({
      build: undefined,
      events: [],
      invalid: 31,
    });
    expect(checkBatch({ build: BUILD, events: Array(30).fill(event) }, LIMITS).events).toHaveLength(30);
  });
});
