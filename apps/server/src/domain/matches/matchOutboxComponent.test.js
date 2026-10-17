import { describe, expect, it } from "vitest";
import { createPendingMatchAccessor } from "../../data/pendingMatchAccessor.js";
import { createInMemoryPendingMatchDao } from "../../testing/inMemoryPendingMatchDao.js";
import {
  createMatchOutboxComponent,
  delayAfter,
  matchRetryPolicy,
  MATCH_RETRY_POLICY,
} from "./matchOutboxComponent.js";

const T0 = Date.UTC(2026, 9, 18, 12);
const MATCH = Object.freeze({ matchId: "m1", players: [] });
const POLICY = matchRetryPolicy({ firstDelayMs: 1_000, maxDelayMs: 3_000, maxAttempts: 4 });

/** A step that records each run in `ran`, and fails while `failures` says so. */
function step(name, ran, { needs = [], failures = 0 } = {}) {
  let left = failures;
  return {
    name,
    needs,
    async run({ matchId, match, now }) {
      ran.push({ name, matchId, match, now });
      if (left > 0) {
        left -= 1;
        throw new Error(`${name} failed`);
      }
    },
  };
}

function setup(stepsFor) {
  const ran = [];
  const pendingMatchAccessor = createPendingMatchAccessor({
    pendingMatchDao: createInMemoryPendingMatchDao(),
  });
  const outbox = createMatchOutboxComponent({ pendingMatchAccessor, steps: stepsFor(ran), policy: POLICY });
  const names = () => ran.map((entry) => entry.name);
  return { outbox, ran, names, pendingMatchAccessor };
}

describe("the retry policy (CC-111)", () => {
  it("doubles the wait after each failed attempt, up to the cap", () => {
    expect([1, 2, 3, 4].map((attempt) => delayAfter(attempt, POLICY))).toEqual([1_000, 2_000, 3_000, 3_000]);
  });

  it("waits 2 s, then up to 5 minutes, for 10 attempts, and keeps a done game two days", () => {
    expect(MATCH_RETRY_POLICY).toEqual({
      firstDelayMs: 2_000,
      maxDelayMs: 300_000,
      maxAttempts: 10,
      keepDoneMs: 2 * 24 * 60 * 60 * 1000,
    });
    expect(matchRetryPolicy()).toEqual(MATCH_RETRY_POLICY);
  });

  it("refuses a policy that cannot work", () => {
    expect(() => matchRetryPolicy({ maxAttempts: 0 })).toThrow(RangeError);
    expect(() => matchRetryPolicy({ firstDelayMs: 10, maxDelayMs: 5 })).toThrow(RangeError);
  });
});

describe("matchOutboxComponent (CC-111)", () => {
  it("runs every step in order for a new game, then marks it done", async () => {
    const { outbox, ran, names, pendingMatchAccessor } = setup((log) => [step("a", log), step("b", log)]);
    await outbox.add({ match: MATCH, now: T0 });

    const outcome = await outbox.run({ matchId: "m1", now: T0 + 1 });

    expect(outcome).toEqual({ matchId: "m1", status: "done", ran: ["a", "b"] });
    expect(names()).toEqual(["a", "b"]);
    expect(ran[0]).toEqual({ name: "a", matchId: "m1", match: MATCH, now: T0 + 1 });
    expect(await pendingMatchAccessor.get("m1")).toEqual(
      expect.objectContaining({ status: "done", done: ["a", "b"] }),
    );
  });

  it("adds a game once, so a game already handled is never run again", async () => {
    const { outbox, names } = setup((log) => [step("a", log)]);
    await outbox.add({ match: MATCH, now: T0 });
    await outbox.run({ matchId: "m1", now: T0 });

    const added = await outbox.add({ match: MATCH, now: T0 + 5 });
    const again = await outbox.run({ matchId: "m1", now: T0 + 5 });

    expect(added).toBe(false);
    expect(again).toEqual({ matchId: "m1", status: "done", ran: [] });
    expect(names()).toEqual(["a"]);
  });

  it("waits longer after each failure, and resumes at the step that failed", async () => {
    const { outbox, names } = setup((log) => [step("a", log), step("b", log, { failures: 2 })]);
    await outbox.add({ match: MATCH, now: T0 });

    const first = await outbox.run({ matchId: "m1", now: T0 });
    const tooEarly = await outbox.runDue({ now: T0 + 999 });
    const second = (await outbox.runDue({ now: T0 + 1_000 }))[0];
    const third = (await outbox.runDue({ now: T0 + 3_000 }))[0];

    expect(first).toEqual({
      matchId: "m1",
      status: "retrying",
      step: "b",
      error: new Error("b failed"),
      attempts: 1,
      nextAttemptAt: T0 + 1_000,
    });
    expect(tooEarly).toEqual([]);
    expect(second).toEqual(
      expect.objectContaining({ status: "retrying", attempts: 2, nextAttemptAt: T0 + 3_000 }),
    );
    expect(third).toEqual({ matchId: "m1", status: "done", ran: ["b"] });
    expect(names()).toEqual(["a", "b", "b", "b"]);
  });

  it("gives up after the last attempt and says the game failed for good", async () => {
    const { outbox, pendingMatchAccessor } = setup((log) => [step("a", log, { failures: 99 })]);
    await outbox.add({ match: MATCH, now: T0 });

    const outcomes = [await outbox.run({ matchId: "m1", now: T0 })];
    for (const now of [T0 + 1_000, T0 + 3_000, T0 + 6_000]) {
      outcomes.push(...(await outbox.runDue({ now })));
    }
    const afterwards = await outbox.runDue({ now: T0 + 60_000 });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["retrying", "retrying", "retrying", "failed"]);
    expect(outcomes.at(-1)).toEqual({
      matchId: "m1",
      status: "failed",
      step: "a",
      error: new Error("a failed"),
      attempts: 4,
    });
    expect(afterwards).toEqual([]);
    expect(await pendingMatchAccessor.get("m1")).toEqual(
      expect.objectContaining({ status: "failed", lastError: { step: "a", message: "a failed" } }),
    );
    expect(await outbox.run({ matchId: "m1", now: T0 + 60_000 })).toEqual({
      matchId: "m1",
      status: "failed",
    });
  });

  it("still runs the steps that do not need the one that failed", async () => {
    const { outbox, names } = setup((log) => [
      step("record", log),
      step("quests", log, { needs: ["record"], failures: 1 }),
      step("boards", log, { needs: ["record"] }),
      step("after quests", log, { needs: ["quests"] }),
    ]);
    await outbox.add({ match: MATCH, now: T0 });

    const first = await outbox.run({ matchId: "m1", now: T0 });
    const second = (await outbox.runDue({ now: T0 + 1_000 }))[0];

    expect(first).toEqual(expect.objectContaining({ status: "retrying", step: "quests" }));
    expect(second).toEqual({ matchId: "m1", status: "done", ran: ["quests", "after quests"] });
    expect(names()).toEqual(["record", "quests", "boards", "quests", "after quests"]);
  });

  it("does not run the same game twice at the same moment", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { outbox, names } = setup((log) => [
      { name: "slow", needs: [], run: async () => (log.push({ name: "slow" }), gate) },
    ]);
    await outbox.add({ match: MATCH, now: T0 });

    const first = outbox.run({ matchId: "m1", now: T0 });
    const second = await outbox.run({ matchId: "m1", now: T0 });
    release();

    expect(second).toEqual({ matchId: "m1", status: "busy" });
    expect(await first).toEqual({ matchId: "m1", status: "done", ran: ["slow"] });
    expect(names()).toEqual(["slow"]);
  });

  it("looks at a limited number of due games at a time, the longest waiting first", async () => {
    const { outbox } = setup((log) => [step("a", log)]);
    for (let i = 0; i < 3; i++) {
      await outbox.add({ match: { matchId: `m${i}`, players: [] }, now: T0 + i });
    }

    const outcomes = await outbox.runDue({ now: T0 + 10, limit: 2 });

    expect(outcomes.map((outcome) => outcome.matchId)).toEqual(["m0", "m1"]);
  });

  it("passes on a failure of the outbox itself, and runs the game again next time", async () => {
    const pendingMatchAccessor = createPendingMatchAccessor({
      pendingMatchDao: createInMemoryPendingMatchDao(),
    });
    const failure = new Error("db down");
    const broken = { ...pendingMatchAccessor, stepDone: async () => Promise.reject(failure) };
    const ran = [];
    const outbox = createMatchOutboxComponent({
      pendingMatchAccessor: broken,
      steps: [step("a", ran)],
      policy: POLICY,
    });
    await outbox.add({ match: MATCH, now: T0 });

    await expect(outbox.run({ matchId: "m1", now: T0 })).rejects.toBe(failure);
    expect((await pendingMatchAccessor.listDue({ now: T0, limit: 10 })).map((e) => e.matchId)).toEqual([
      "m1",
    ]);
    await expect(outbox.run({ matchId: "m1", now: T0 })).rejects.toBe(failure);
  });

  it("refuses steps that cannot run", () => {
    const pendingMatchAccessor = createPendingMatchAccessor({
      pendingMatchDao: createInMemoryPendingMatchDao(),
    });
    const make = (steps) => () => createMatchOutboxComponent({ pendingMatchAccessor, steps });
    const run = async () => {};

    expect(make([])).toThrow(RangeError);
    expect(
      make([
        { name: "a", run },
        { name: "a", run },
      ]),
    ).toThrow(RangeError);
    expect(
      make([
        { name: "b", needs: ["a"], run },
        { name: "a", run },
      ]),
    ).toThrow(RangeError);
    expect(make([{ name: "a" }])).toThrow(TypeError);
    expect(() => createMatchOutboxComponent({ steps: [{ name: "a", run }] })).toThrow(TypeError);
  });
});
