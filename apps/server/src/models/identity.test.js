import { describe, expect, it } from "vitest";
import { ValidationError } from "../utils/errors.js";
import {
  createIdentity,
  GUEST_NAME_ALPHABET,
  GUEST_NAME_SUFFIX_LENGTH,
  isAccountId,
  isGuestId,
  isServerGivenGuestName,
} from "./identity.js";

describe("isAccountId", () => {
  it.each([
    ["user_652f1c2e9b1e8a3d4c5b6a79", true],
    ["guest_123e4567-e89b-12d3-a456-426614174000", false],
    ["user_", false],
    ["user_652f1c2e9b1e8a3d4c5b6a79x", false],
  ])("%s → %s", (id, expected) => {
    expect(isAccountId(id)).toBe(expected);
  });
});

describe("isGuestId", () => {
  it.each([
    ["guest_123e4567-e89b-12d3-a456-426614174000", true],
    ["user_652f1c2e9b1e8a3d4c5b6a79", false],
    ["bot_pip_easy", false],
    ["guest_", false],
  ])("%s → %s", (id, expected) => {
    expect(isGuestId(id)).toBe(expected);
  });
});

describe("isServerGivenGuestName (ADR-060)", () => {
  it.each(["Guest-7K2Q", "Guest-AAAA", "Guest-Z9Z9"])("trusts the shape the server gives: %s", (name) => {
    expect(isServerGivenGuestName(name)).toBe(true);
  });

  it.each([
    "Guest-7K2",
    "Guest-7K2QX",
    "guest-7K2Q",
    "Guest_7K2Q",
    "Guest-0K2Q",
    "Guest-1K2Q",
    "Guest-OK2Q",
    "Guest-IK2Q",
    "Guest-7k2q",
    "Riya",
    "Guest-7K2Q ",
  ])("treats any other name as chosen: %s", (name) => {
    expect(isServerGivenGuestName(name)).toBe(false);
  });

  it("describes the alphabet the server draws from: no 0, O, 1 or I", () => {
    expect(GUEST_NAME_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    expect(GUEST_NAME_SUFFIX_LENGTH).toBe(4);
  });
});

const GUEST = { kind: "guest", id: "guest_123e4567-e89b-12d3-a456-426614174000", displayName: "Guest-7K2Q" };
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "riya_42" };

describe("createIdentity", () => {
  it.each([
    ["guest", GUEST],
    ["user", USER],
  ])("creates a frozen %s identity", (_kind, fields) => {
    const identity = createIdentity(fields);

    expect(identity).toEqual(fields);
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it("copies only known fields", () => {
    expect(createIdentity({ ...GUEST, isAdmin: true })).not.toHaveProperty("isAdmin");
  });

  it.each([
    [{ ...GUEST, kind: "admin" }, "kind"],
    [{ ...GUEST, id: "user_652f1c2e9b1e8a3d4c5b6a79" }, "id"],
    [{ ...USER, id: "guest_123e4567-e89b-12d3-a456-426614174000" }, "id"],
    [{ ...GUEST, id: 42 }, "id"],
    [{ ...GUEST, displayName: "ab" }, "displayName"],
    [{ ...GUEST, displayName: "x".repeat(25) }, "displayName"],
    [{ ...GUEST, displayName: "<script>" }, "displayName"],
    [{ ...GUEST, displayName: undefined }, "displayName"],
  ])("rejects %o (field: %s)", (fields, field) => {
    let thrown;
    try {
      createIdentity(fields);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown.details).toEqual({ field });
  });
});
