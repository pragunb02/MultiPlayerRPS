import { describe, expect, it, vi } from "vitest";
import { FLAGS } from "@classicade/shared";
import { CLIENT_FLAG_NAMES, flagStoreFor } from "./flagStore.js";

// The app's one cache of flag answers (CC-349): asked once per person for every flag the web app may read, so a page
// that mounts later has its answer at once and nothing on it moves when the answer comes.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("flagStoreFor (CC-349)", () => {
  it("asks once for every client flag, and answers each flag from that one answer", async () => {
    const answer = deferred();
    const api = { getFlags: vi.fn(() => answer.promise) };
    const store = flagStoreFor(api);

    store.load("guest_a");
    store.load("guest_a");
    expect(store.stateOf("guest_a", "how_to_play")).toBe("unknown");
    answer.resolve({ how_to_play: true });
    await answer.promise;

    expect(api.getFlags).toHaveBeenCalledOnce();
    expect(api.getFlags).toHaveBeenCalledWith(CLIENT_FLAG_NAMES);
    expect(store.stateOf("guest_a", "how_to_play")).toBe("on");
    expect(store.stateOf("guest_a", "design_page")).toBe("off");
  });

  it("names exactly the flags marked client", () => {
    expect(CLIENT_FLAG_NAMES).toEqual(FLAGS.filter((flag) => flag.client).map((flag) => flag.name));
  });

  it("keeps one store per API client, so the whole app shares it", () => {
    const api = { getFlags: vi.fn() };

    expect(flagStoreFor(api)).toBe(flagStoreFor(api));
    expect(flagStoreFor({ getFlags: vi.fn() })).not.toBe(flagStoreFor(api));
  });

  it("asks again for another person, and keeps each answer apart", async () => {
    const api = { getFlags: vi.fn().mockResolvedValueOnce({ how_to_play: true }).mockResolvedValueOnce({}) };
    const store = flagStoreFor(api);

    store.load("");
    store.load("guest_b");
    await vi.waitFor(() => expect(store.stateOf("guest_b", "how_to_play")).toBe("off"));

    expect(store.stateOf("", "how_to_play")).toBe("on");
    expect(api.getFlags).toHaveBeenCalledTimes(2);
  });

  it("answers off when the question fails", async () => {
    const api = { getFlags: vi.fn().mockRejectedValue(new Error("offline")) };
    const store = flagStoreFor(api);

    store.load("guest_c");

    await vi.waitFor(() => expect(store.stateOf("guest_c", "how_to_play")).toBe("off"));
  });

  it("answers off when the server takes too long, and keeps that answer when it comes late", async () => {
    vi.useFakeTimers();
    try {
      const answer = deferred();
      const api = { getFlags: vi.fn(() => answer.promise) };
      const store = flagStoreFor(api);
      store.load("guest_d");

      await vi.advanceTimersByTimeAsync(2_999);
      expect(store.stateOf("guest_d", "how_to_play")).toBe("unknown");
      await vi.advanceTimersByTimeAsync(1);
      expect(store.stateOf("guest_d", "how_to_play")).toBe("off");
      answer.resolve({ how_to_play: true });
      await answer.promise;

      expect(store.stateOf("guest_d", "how_to_play")).toBe("off");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells its listeners when an answer comes, until they stop listening", async () => {
    const api = { getFlags: vi.fn().mockResolvedValue({}) };
    const store = flagStoreFor(api);
    const heard = vi.fn();
    const stop = store.subscribe(heard);

    store.load("guest_e");
    await vi.waitFor(() => expect(heard).toHaveBeenCalledOnce());
    stop();
    store.load("guest_f");
    await vi.waitFor(() => expect(store.stateOf("guest_f", "how_to_play")).toBe("off"));

    expect(heard).toHaveBeenCalledOnce();
  });
});
