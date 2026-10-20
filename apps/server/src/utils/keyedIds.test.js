import { describe, expect, it } from "vitest";
import { createKeyedIds, KEYED_ID_LABELS, KEYED_ID_PATTERN, keyedIdSecretFrom } from "./keyedIds.js";

const SECRET = "keyed-id-secret-for-tests-only-0123456789";
const SESSION_SECRET = "session-secret-for-tests-only-0123456789";

describe("keyed ids (CC-253, CC-297)", () => {
  it("names a list of parts by 22 base64url characters", () => {
    const id = createKeyedIds({ secret: SECRET }).idOf([
      "ROOM22",
      1_000_000,
      "user_65f1a2b3c4d5e6f708192a3b",
    ]);

    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(KEYED_ID_PATTERN.test(id)).toBe(true);
  });

  it("gives the same parts the same id every time, and other parts an unrelated id", () => {
    const ids = createKeyedIds({ secret: SECRET });

    expect(createKeyedIds({ secret: SECRET }).idOf(["a", "b"])).toBe(ids.idOf(["a", "b"]));
    expect(ids.idOf(["a", "c"])).not.toBe(ids.idOf(["a", "b"]));
  });

  it("keeps the parts apart, so no two lists can be made to give the same input", () => {
    const ids = createKeyedIds({ secret: SECRET });

    expect(ids.idOf(["AB", "12", "3x"])).not.toBe(ids.idOf(["AB1", "2", "3x"]));
    expect(ids.idOf(["AB", 12])).not.toBe(ids.idOf(["AB", "12"]));
  });

  it("cannot be worked out without the key", () => {
    expect(createKeyedIds({ secret: `${SECRET}-other` }).idOf(["a"])).not.toBe(
      createKeyedIds({ secret: SECRET }).idOf(["a"]),
    );
  });

  it("refuses a missing or short key, so a wiring mistake stops the boot", () => {
    expect(() => createKeyedIds({ secret: undefined })).toThrow(TypeError);
    expect(() => createKeyedIds({ secret: "short" })).toThrow(RangeError);
  });

  it("derives one key per purpose from the session secret, each under its own label", () => {
    const keys = Object.values(KEYED_ID_LABELS).map((label) =>
      keyedIdSecretFrom({ sessionSecret: SESSION_SECRET, label }),
    );

    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(SESSION_SECRET);
  });

  it("has a label for room seats and one for match players, and each label is different", () => {
    const labels = Object.values(KEYED_ID_LABELS);

    expect(KEYED_ID_LABELS).toEqual({
      ROOM_SEATS: "classicade room seat ids",
      MATCH_PLAYERS: "classicade match player ids",
    });
    expect(new Set(labels).size).toBe(labels.length);
    expect(Object.isFrozen(KEYED_ID_LABELS)).toBe(true);
  });

  it("refuses a label that is not on the list, so two purposes can never share a key by accident", () => {
    expect(() => keyedIdSecretFrom({ sessionSecret: SESSION_SECRET, label: "something new" })).toThrow(
      RangeError,
    );
  });
});
