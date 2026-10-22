import { describe, expect, it } from "vitest";
import { captureLogger } from "../../testing/captureLogger.js";
import { COUNT_OUTCOMES, createQuickMatchCounts, waitBucketOf } from "./quickMatchCounts.js";

// 2026-10-21 14:00 UTC is 19:30 in India, the 19:00 hour slot.
const AT = Date.parse("2026-10-21T14:00:00.000Z");

describe("quick match counts (CC-051, ADR-034)", () => {
  it("puts each wait in a bucket, never a wait of its own", () => {
    expect([0, 500, 501, 1_000, 2_500, 4_000, 4_001].map(waitBucketOf)).toEqual([
      "upto_500",
      "upto_500",
      "upto_1000",
      "upto_1000",
      "upto_3000",
      "upto_4000",
      "over_4000",
    ]);
  });

  it("counts searches per India day, hour slot, game and outcome, and drain forgets them", () => {
    const counts = createQuickMatchCounts({ now: () => AT });

    counts.record({ gameId: "rps", outcome: COUNT_OUTCOMES.MATCHED, waitMs: 700 });
    counts.record({ gameId: "rps", outcome: COUNT_OUTCOMES.MATCHED, waitMs: 2_100 });
    counts.record({ gameId: "chess", outcome: COUNT_OUTCOMES.TIMED_OUT, waitMs: 4_000 });

    expect(counts.drain()).toEqual([
      {
        day: "2026-10-21",
        hour: 19,
        gameId: "rps",
        outcome: "matched",
        searches: 2,
        waits: { upto_1000: 1, upto_3000: 1 },
      },
      {
        day: "2026-10-21",
        hour: 19,
        gameId: "chess",
        outcome: "timed_out",
        searches: 1,
        waits: { upto_4000: 1 },
      },
    ]);
    expect(counts.drain()).toEqual([]);
  });

  it("refuses an unknown game or outcome, so nothing but known words can become a key", () => {
    const counts = createQuickMatchCounts({ now: () => AT });

    expect(() => counts.record({ gameId: "guest_x", outcome: "matched", waitMs: 0 })).toThrow(RangeError);
    expect(() => counts.record({ gameId: "rps", outcome: "Riya", waitMs: 0 })).toThrow(RangeError);
  });

  it("writes the counts to the log as one line, and the last ones when it stops", () => {
    const counts = createQuickMatchCounts({ now: () => AT });
    const capture = captureLogger();
    const log = counts.logEvery({ logger: capture.logger, everyMs: 60_000 });

    counts.record({ gameId: "tictactoe", outcome: COUNT_OUTCOMES.SKIPPED, waitMs: 3 });
    log.stop();

    expect(capture.find("quick match counts").map((line) => line.counts)).toEqual([
      [
        {
          day: "2026-10-21",
          hour: 19,
          gameId: "tictactoe",
          outcome: "skipped",
          searches: 1,
          waits: { upto_500: 1 },
        },
      ],
    ]);
  });
});
