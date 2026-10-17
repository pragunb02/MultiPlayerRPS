import { describe, expect, it } from "vitest";
import { AppRequestError, isRetryable, isUnauthorized, networkError } from "./errors.js";

describe("request errors", () => {
  it("recognises only the server's UNAUTHORIZED answer as 'not signed in'", () => {
    expect(
      isUnauthorized(new AppRequestError({ code: "UNAUTHORIZED", message: "No session", status: 401 })),
    ).toBe(true);
    expect(isUnauthorized(new AppRequestError({ code: "FORBIDDEN", message: "No", status: 403 }))).toBe(
      false,
    );
    expect(isUnauthorized(Object.assign(new Error("look-alike"), { code: "UNAUTHORIZED" }))).toBe(false);
  });

  it("describes a network failure without blaming the player, keeping the cause", () => {
    const cause = new TypeError("Failed to fetch");

    const error = networkError(cause);

    expect(error).toMatchObject({ code: "NETWORK", status: 0, details: {}, cause });
    expect(error.message).toMatch(/check your connection/);
  });

  it.each([
    [networkError(new TypeError("Failed to fetch")), true],
    [new AppRequestError({ code: "TIMEOUT", message: "Slow" }), true],
    [new AppRequestError({ code: "UNKNOWN", message: "Odd" }), true],
    [new AppRequestError({ code: "INTERNAL", message: "Oops", status: 500 }), true],
    [new AppRequestError({ code: "RATE_LIMITED", message: "Slow down", status: 429 }), true],
    [new AppRequestError({ code: "SOMETHING_NEW", message: "Down", status: 503 }), true],
    [new AppRequestError({ code: "VALIDATION_FAILED", message: "Cell taken", status: 400 }), false],
    [new AppRequestError({ code: "UNAUTHORIZED", message: "Wrong password", status: 401 }), false],
    [new Error("a bug in the page"), false],
  ])("offers a Retry only for failures that can pass on a second try (%s)", (error, retryable) => {
    expect(isRetryable(error)).toBe(retryable);
  });
});
