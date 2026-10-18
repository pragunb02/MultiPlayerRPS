import { afterEach, describe, expect, it, vi } from "vitest";
import { createThinkingQueue, REST_PER_THINKING_MS } from "./thinkingQueue.js";

afterEach(() => {
  vi.useRealTimers();
});

/** A clock the work moves on, and rests the test ends one by one. */
function controlled() {
  let time = 0;
  const rests = [];
  return {
    clock: () => time,
    spend: (ms) => {
      time += ms;
    },
    rest: (ms) =>
      new Promise((resolve) => {
        rests.push({ ms, end: resolve });
      }),
    rests,
  };
}

describe("thinkingQueue", () => {
  it("lets one computer player think at a time on the whole server, however many ask at once", async () => {
    const { clock, spend, rest, rests } = controlled();
    const queue = createThinkingQueue({ clock, rest });
    let thinking = 0;
    let most = 0;
    const started = [];
    const work = (name) => () => {
      thinking += 1;
      most = Math.max(most, thinking);
      started.push(name);
      spend(200);
      thinking -= 1;
      return name;
    };

    const answers = ["a", "b", "c", "d", "e"].map((name) => queue.think(work(name)));
    await Promise.resolve();
    await Promise.resolve();
    // Only the first one thought. The others wait for its rest to end.
    expect(started).toEqual(["a"]);
    for (let next = 1; next < 5; next++) {
      await vi.waitFor(() => expect(rests).toHaveLength(next));
      expect(started).toHaveLength(next);
      rests[next - 1].end();
      await vi.waitFor(() => expect(started).toHaveLength(next + 1));
    }

    expect(await Promise.all(answers)).toEqual(["a", "b", "c", "d", "e"]);
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
    expect(most).toBe(1);
  });

  it("rests as long as the thinking took, so computer players use at most half the server's time", async () => {
    const { clock, spend, rest, rests } = controlled();
    const queue = createThinkingQueue({ clock, rest });

    await queue.think(() => spend(240));

    await vi.waitFor(() => expect(rests).toHaveLength(1));
    expect(REST_PER_THINKING_MS).toBe(1);
    expect(rests[0].ms).toBe(240);
  });

  it("answers what the work threw, and still rests before the next one", async () => {
    const { clock, spend, rest, rests } = controlled();
    const queue = createThinkingQueue({ clock, rest });

    const failed = queue.think(() => {
      spend(50);
      throw new Error("no move");
    });
    const next = queue.think(() => "e2e4");

    await expect(failed).rejects.toThrow("no move");
    await vi.waitFor(() => expect(rests).toHaveLength(1));
    expect(rests[0].ms).toBe(50);
    rests[0].end();
    expect(await next).toBe("e2e4");
  });

  it("rests on a timer by default, so everything else the server does runs in between", async () => {
    vi.useFakeTimers();
    let time = 0;
    const queue = createThinkingQueue({ clock: () => time });
    const order = [];

    queue.think(() => {
      order.push("first");
      time += 100;
    });
    const second = queue.think(() => order.push("second"));
    setTimeout(() => order.push("a socket's message"), 50);
    await vi.advanceTimersByTimeAsync(99);
    expect(order).toEqual(["first", "a socket's message"]);
    await vi.advanceTimersByTimeAsync(1);
    await second;

    expect(order).toEqual(["first", "a socket's message", "second"]);
  });

  it("reads the real clock when none is given", async () => {
    const queue = createThinkingQueue();

    expect(await queue.think(() => 7)).toBe(7);
  });
});
