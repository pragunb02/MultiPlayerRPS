import { describe, expect, it } from "vitest";
import { AppRequestError, isUnauthorized, networkError } from "./errors.js";

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
});
