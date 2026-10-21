import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPwnedPasswordsClient,
  NO_NETWORK_FETCH,
  PWNED_PASSWORDS_RANGE_URL,
  PWNED_PASSWORDS_TIMEOUT_MS,
} from "./pwnedPasswordsClient.js";

const PREFIX = "ABCDE";
const RANGE = [
  "003D68EB55068C33ACE09247EE4C639306B:3",
  "0123456789ABCDEF0123456789ABCDEF012:10437277",
  // Padding lines (Add-Padding: true) have a count of 0.
  "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0",
].join("\r\n");

/** A fetch that answers one body, and keeps every request it was given. */
function answering(body, { status = 200 } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(body, { status });
  };
  return { fetch, requests };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pwnedPasswordsClient", () => {
  it("asks the range API for the five character prefix only, with padding on", async () => {
    const { fetch, requests } = answering(RANGE);

    await createPwnedPasswordsClient({ fetch }).rangeOf(PREFIX);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${PWNED_PASSWORDS_RANGE_URL}${PREFIX}`);
    expect(new Headers(requests[0].init.headers).get("Add-Padding")).toBe("true");
    expect(requests[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("answers each suffix with its count, padding lines included", async () => {
    const { fetch } = answering(RANGE);

    const range = await createPwnedPasswordsClient({ fetch }).rangeOf(PREFIX);

    expect(range.get("0123456789ABCDEF0123456789ABCDEF012")).toBe(10437277);
    expect(range.get("003D68EB55068C33ACE09247EE4C639306B")).toBe(3);
    expect(range.get("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toBe(0);
    expect(range.size).toBe(3);
  });

  it("reads lines that end in a plain newline and ignores a blank last line", async () => {
    const { fetch } = answering("003D68EB55068C33ACE09247EE4C639306B:3\n");

    const range = await createPwnedPasswordsClient({ fetch }).rangeOf(PREFIX);

    expect([...range]).toEqual([["003D68EB55068C33ACE09247EE4C639306B", 3]]);
  });

  it.each(["", "abcde", "ABCD", "ABCDE1", "GGGGG"])(
    "refuses a prefix that is not five capital hex digits (%j)",
    async (prefix) => {
      const { fetch, requests } = answering(RANGE);

      await expect(createPwnedPasswordsClient({ fetch }).rangeOf(prefix)).rejects.toThrow(RangeError);
      expect(requests).toHaveLength(0);
    },
  );

  it("fails on an answer that is not 200", async () => {
    const { fetch } = answering("busy", { status: 503 });

    await expect(createPwnedPasswordsClient({ fetch }).rangeOf(PREFIX)).rejects.toThrow(/answered 503/);
  });

  it("fails on a line that is not a suffix and a count", async () => {
    const { fetch } = answering("<html>a captive portal</html>");

    await expect(createPwnedPasswordsClient({ fetch }).rangeOf(PREFIX)).rejects.toThrow(/unexpected line/);
  });

  it("fails when the network fails", async () => {
    const fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(createPwnedPasswordsClient({ fetch }).rangeOf(PREFIX)).rejects.toThrow("fetch failed");
  });

  it("gives up after 1.5 seconds", async () => {
    vi.useFakeTimers();
    let signal;
    const fetch = (_url, init) => {
      signal = init.signal;
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    };
    const asking = createPwnedPasswordsClient({ fetch }).rangeOf(PREFIX);
    const failed = expect(asking).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(PWNED_PASSWORDS_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(PWNED_PASSWORDS_TIMEOUT_MS).toBe(1500);
    expect(signal.aborted).toBe(true);
    await failed;
  });

  it("stops the timer once the answer is read", async () => {
    vi.useFakeTimers();
    const { fetch } = answering(RANGE);

    await createPwnedPasswordsClient({ fetch }).rangeOf(PREFIX);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("has a stand in fetch for processes without a network, which always fails", async () => {
    await expect(createPwnedPasswordsClient({ fetch: NO_NETWORK_FETCH }).rangeOf(PREFIX)).rejects.toThrow(
      /no network/,
    );
  });

  it("needs a fetch", () => {
    expect(() => createPwnedPasswordsClient({ fetch: undefined })).toThrow(TypeError);
  });
});
