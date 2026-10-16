import { describe, expect, it } from "vitest";
import { UnauthorizedError, ValidationError } from "../../utils/errors.js";
import { destroySession, establishSession, requireIdentity } from "./session.js";

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

/** A request whose session store fails the named steps with the given errors and succeeds otherwise. */
function requestWithStore({ regenerate, save, destroy } = {}) {
  const session = {
    regenerate: (done) => done(regenerate),
    save: (done) => done(save),
    destroy: (done) => done(destroy),
  };
  return { session };
}

describe("establishSession", () => {
  it("stores the identity in a fresh session", async () => {
    const req = requestWithStore();

    await establishSession(req, GUEST);

    expect(req.session.identity).toEqual(GUEST);
  });

  it.each([
    ["creating the new session", { regenerate: new Error("store down") }],
    ["saving it", { save: new Error("store down") }],
  ])("fails when the store fails %s", async (_step, failures) => {
    await expect(establishSession(requestWithStore(failures), GUEST)).rejects.toThrow("store down");
  });
});

describe("destroySession", () => {
  it("ends the session, or reports the store's failure", async () => {
    await expect(destroySession(requestWithStore())).resolves.toBeUndefined();
    await expect(destroySession(requestWithStore({ destroy: new Error("store down") }))).rejects.toThrow(
      "store down",
    );
  });
});
