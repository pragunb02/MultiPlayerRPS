import { describe, expect, it } from "vitest";
import { UnauthorizedError, ValidationError } from "../../utils/errors.js";
import { requireIdentity } from "./session.js";

const GUEST = { kind: "guest", id: "guest_123e4567-e89b-12d3-a456-426614174000", displayName: "Guest-7K2Q" };

describe("requireIdentity", () => {
  it("returns a validated, frozen copy of the stored identity", () => {
    const identity = requireIdentity({ identity: GUEST });

    expect(identity).toEqual(GUEST);
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it.each([undefined, {}])("throws UnauthorizedError when there is no identity (%o)", (sessionData) => {
    expect(() => requireIdentity(sessionData)).toThrow(UnauthorizedError);
  });

  it("throws UnauthorizedError, keeping the validation failure as cause, for an invalid identity", () => {
    let thrown;
    try {
      requireIdentity({ identity: { ...GUEST, id: "forged" } });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UnauthorizedError);
    expect(thrown.cause).toBeInstanceOf(ValidationError);
  });
});
