import { describe, expect, it } from "vitest";
import {
  ACCOUNT_REFUSALS,
  CHALLENGE_LIMIT_REASONS,
  CHALLENGE_REFUSALS,
  DAILY_PUZZLE_REFUSALS,
  ERROR_CODES,
  FRIEND_REFUSALS,
  MOVE_REJECTIONS,
  NAME_REFUSALS,
  PASSWORD_REFUSALS,
  ROOM_JOIN_REFUSALS,
  ROOM_LIMIT_REASONS,
  ROOM_REQUEST_REFUSALS,
} from "@classicade/shared";
import {
  AppRequestError,
  isRetryable,
  isUnauthorized,
  networkError,
  FALLBACK_WORDS,
  PLAYER_WORDS,
  playerMessage,
  REASON_WORDS,
} from "./errors.js";

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
    expect(error.message).toBe("We couldn't reach ClassiCade. Check your connection, then try again.");
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

describe("A4: no raw server words in an error (CC-350, CL-02)", () => {
  const RAW = "Internal raw server text 42";

  it.each(Object.values(ERROR_CODES))("gives the player words of its own for %s", (code) => {
    const error = new AppRequestError({ code, message: RAW, status: 400 });

    expect(error.message).not.toContain(RAW);
    expect(error.message).toBe(playerMessage(error));
    expect(PLAYER_WORDS[code]).toMatch(/\.$/);
    expect(error.serverMessage).toBe(RAW);
  });

  it.each(
    Object.entries(REASON_WORDS).flatMap(([code, reasons]) =>
      Object.entries(reasons).map(([reason, words]) => [code, reason, words]),
    ),
  )("gives closer words of its own for %s with the reason %s", (code, reason, words) => {
    const error = new AppRequestError({ code, message: RAW, details: { reason }, status: 409 });

    expect(error.message).toBe(words);
    expect(error.message).not.toContain(RAW);
  });

  // Every reason the server can name, so a new one fails here until it has words (CC-350).
  it.each(
    Object.entries({
      MOVE_REJECTIONS,
      ROOM_JOIN_REFUSALS,
      ROOM_LIMIT_REASONS,
      ROOM_REQUEST_REFUSALS,
      CHALLENGE_LIMIT_REASONS,
      CHALLENGE_REFUSALS,
      DAILY_PUZZLE_REFUSALS,
      NAME_REFUSALS,
      FRIEND_REFUSALS,
      ACCOUNT_REFUSALS,
      PASSWORD_REFUSALS,
    }).flatMap(([list, reasons]) => Object.values(reasons).map((reason) => [list, reason])),
  )("has words of its own for every reason in %s (%s)", (_list, reason) => {
    const codes = Object.keys(REASON_WORDS).filter((code) => Object.hasOwn(REASON_WORDS[code], reason));

    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(new AppRequestError({ code, message: RAW, details: { reason } }).message).not.toBe(
        PLAYER_WORDS[code],
      );
    }
  });

  it("says which way a challenge ended from the state the server names", () => {
    const error = new AppRequestError({ code: "GONE", message: RAW, details: { state: "declined" } });

    expect(error.message).toBe("This challenge was turned down. Send a new one, or start a game.");
  });

  it("falls back to the code's words for a reason it has no words for", () => {
    const unknown = new AppRequestError({ code: "CONFLICT", message: RAW, details: { reason: "toString" } });

    expect(unknown.message).toBe(PLAYER_WORDS.CONFLICT);
  });

  it("says something went wrong for a code it does not know, never the server's words", () => {
    const error = new AppRequestError({ code: "SOMETHING_NEW", message: RAW, status: 400 });

    expect(error.message).toBe(FALLBACK_WORDS);
  });

  it("gives plain words for a fault in the page too", () => {
    expect(playerMessage(new TypeError("Cannot read properties of undefined"))).toBe(FALLBACK_WORDS);
  });
});
