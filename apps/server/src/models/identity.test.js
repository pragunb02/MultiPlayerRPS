import { describe, expect, it } from "vitest";
import { ValidationError } from "../utils/errors.js";
import { createIdentity } from "./identity.js";

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
