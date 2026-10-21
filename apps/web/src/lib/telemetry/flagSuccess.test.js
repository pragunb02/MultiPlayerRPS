import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelemetryClient } from "./client.js";
import { countFlagSuccesses } from "./flagSuccess.js";

const press = { control: "home.play_guest", has_reason: false };
const HOME = { route: "/", playerKind: "visitor" };
const ended = {
  surface: "toast.xp",
  kind: "toast",
  class: "optional",
  blocking: false,
  outcome: "timed_out",
  shown_ms: "3-10s",
  phase: "result",
  trigger: "system",
  stack: "0",
};

afterEach(() => vi.useRealTimers());

describe("the flags' success counts (review of #162)", () => {
  it("counts telemetry_client once a batch is taken, and interruption_counts only once one with an interruption is", () => {
    const api = { sendFlagSuccess: vi.fn().mockResolvedValue(undefined) };
    const accepted = countFlagSuccesses(api);

    accepted([{ name: "control_pressed" }]);
    accepted([{ name: "control_pressed" }]);
    expect(api.sendFlagSuccess.mock.calls).toEqual([["telemetry_client"]]);

    accepted([{ name: "page_viewed" }, { name: "interruption_ended" }]);
    accepted([{ name: "interruption_ended" }]);
    expect(api.sendFlagSuccess.mock.calls).toEqual([["telemetry_client"], ["interruption_counts"]]);
  });

  it("a failed send of the success changes nothing", async () => {
    const api = { sendFlagSuccess: vi.fn().mockRejectedValue(new Error("offline")) };

    countFlagSuccesses(api)([{ name: "interruption_ended" }]);
    await Promise.resolve();

    expect(api.sendFlagSuccess).toHaveBeenCalledTimes(2);
  });

  it("the client tells of each batch the server took, with its events, and never of one it refused", async () => {
    vi.useFakeTimers();
    const taken = [];
    let ok = false;
    const client = createTelemetryClient({
      build: "0.1.0+abc1234",
      send: async () => ok,
      beacon: () => true,
      isOff: () => false,
      viewportWidth: () => 390,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer),
      strict: true,
      onBatchAccepted: (events) => taken.push(events.map(({ name }) => name)),
    });

    client.track("interruption_ended", ended, HOME);
    client.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(taken).toEqual([]);

    ok = true;
    client.track("control_pressed", press, HOME);
    client.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(taken).toEqual([["control_pressed"]]);
  });
});
