import { describe, expect, it } from "vitest";
import { FUNNEL_IDS, FUNNELS, isFunnelStep } from "@classicade/shared";
import { recordingTelemetry } from "../../testing/telemetry.js";
import { createInterruptionTracker } from "./interruptions.js";

describe("funnel steps (CC-313 section 4)", () => {
  // AC-9 (CC-313)
  it("each step once per page load, registered steps only", () => {
    const telemetry = recordingTelemetry();
    const tracker = createInterruptionTracker({ telemetry, now: () => 0 });
    tracker.setEnabled(true);

    tracker.reach("visit_to_play", "landed");
    tracker.reach("visit_to_play", "landed");
    tracker.reach("visit_to_play", "seated");
    tracker.reach("link_to_seat", "seated");

    expect(telemetry.named("funnel_step_reached")).toEqual([
      { funnel: "visit_to_play", step: "landed" },
      { funnel: "visit_to_play", step: "seated" },
      { funnel: "link_to_seat", step: "seated" },
    ]);
    expect(() => tracker.reach("visit_to_play", "account_created")).toThrow(RangeError);
    expect(() => tracker.reach("checkout", "paid")).toThrow(RangeError);
  });

  it("sends nothing while the flag is off", () => {
    const telemetry = recordingTelemetry();
    const tracker = createInterruptionTracker({ telemetry, now: () => 0 });

    tracker.reach("sign_up", "form_viewed");

    expect(telemetry.tracked).toEqual([]);
  });

  it("names every funnel and step in snake case, each step with its ticket", () => {
    expect(FUNNEL_IDS).toEqual(["visit_to_play", "link_to_seat", "sign_up", "challenge"]);
    FUNNELS.forEach(({ id, ticket, steps }) => {
      expect(id).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
      expect(ticket).toMatch(/^CC-\d{3,}$/);
      steps.forEach((step) => {
        expect(step.id).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
        expect(step.ticket).toMatch(/^CC-\d{3,}$/);
        expect(isFunnelStep(id, step.id)).toBe(true);
      });
    });
  });
});
