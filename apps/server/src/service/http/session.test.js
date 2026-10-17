import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../../utils/errors.js";
import {
  createSessionCheck,
  createSessionGuard,
  destroySession,
  establishAccountSession,
  establishSession,
  requireIdentity,
  saveSession,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_END_REASONS,
} from "./session.js";

const GUEST = { kind: "guest", id: "guest_123e4567-e89b-12d3-a456-426614174000", displayName: "Guest-7K2Q" };
const USER = { kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" };
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 17);

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

describe("establishAccountSession (CC-116)", () => {
  it("stores the identity with the account's session version and the moment of signing in", async () => {
    const req = requestWithStore();

    await establishAccountSession(req, { identity: USER, sessionVersion: 3, now: T0 });

    expect(req.session).toMatchObject({ identity: USER, sessionVersion: 3, signedInAt: T0 });
  });
});

describe("saveSession", () => {
  it("saves the session, or reports the store's failure", async () => {
    await expect(saveSession(requestWithStore())).resolves.toBeUndefined();
    await expect(saveSession(requestWithStore({ save: new Error("store down") }))).rejects.toThrow(
      "store down",
    );
  });
});

describe("createSessionCheck (CC-116)", () => {
  function setup({ version = 0, failure } = {}) {
    let time = T0;
    const sessionVersionOf = vi.fn(async () => {
      if (failure) throw failure;
      return version;
    });
    const check = createSessionCheck({ accountComponent: { sessionVersionOf }, now: () => time });
    return { check, sessionVersionOf, advance: (ms) => (time += ms) };
  }
  const reasonOf = (promise) =>
    promise.then(
      () => "accepted",
      (err) => (err instanceof UnauthorizedError ? err.details.reason : err),
    );

  it("accepts a guest session without asking about any account", async () => {
    const { check, sessionVersionOf } = setup();

    await expect(check({ identity: GUEST })).resolves.toBeUndefined();
    expect(sessionVersionOf).not.toHaveBeenCalled();
  });

  it("accepts an account session at the account's current version", async () => {
    const { check, sessionVersionOf } = setup({ version: 2 });

    await expect(check({ identity: USER, sessionVersion: 2, signedInAt: T0 })).resolves.toBeUndefined();
    expect(sessionVersionOf).toHaveBeenCalledWith({ playerId: USER.id });
  });

  it("refuses an account session made before the version was counted up", async () => {
    const { check } = setup({ version: 3 });

    const refused = await check({ identity: USER, sessionVersion: 2, signedInAt: T0 }).catch((err) => err);

    expect(refused).toBeInstanceOf(UnauthorizedError);
    expect(refused.details).toEqual({ reason: SESSION_END_REASONS.SIGNED_OUT });
    expect(refused.message).toBe("You were signed out on this device, please log in again");
  });

  it("treats a session from before CC-116 as version 0", async () => {
    expect(await reasonOf(setup({ version: 0 }).check({ identity: USER }))).toBe("accepted");
    expect(await reasonOf(setup({ version: 1 }).check({ identity: USER }))).toBe(
      SESSION_END_REASONS.SIGNED_OUT,
    );
  });

  it("ends an account session 90 days after signing in, however much it was used", async () => {
    const { check, advance } = setup();
    const session = { identity: USER, sessionVersion: 0, signedInAt: T0 };

    advance(SESSION_ABSOLUTE_LIFETIME_MS - 1);
    expect(await reasonOf(check(session))).toBe("accepted");
    advance(1);

    expect(SESSION_ABSOLUTE_LIFETIME_MS).toBe(90 * DAY);
    expect(await reasonOf(check(session))).toBe(SESSION_END_REASONS.EXPIRED);
  });

  it("never ends a guest session for its age, because a guest cannot sign in again", async () => {
    const { check, advance } = setup();

    advance(400 * DAY);

    expect(await reasonOf(check({ identity: GUEST, signedInAt: T0 }))).toBe("accepted");
  });

  it("refuses a session whose account is gone", async () => {
    const gone = new NotFoundError("Account not found");

    const refused = await setup({ failure: gone })
      .check({ identity: USER })
      .catch((err) => err);

    expect(refused.details).toEqual({ reason: SESSION_END_REASONS.SIGNED_OUT });
    expect(refused.cause).toBe(gone);
  });

  it("passes any other failure through, so a broken database is a server fault and not a sign out", async () => {
    const broken = new Error("database down");

    await expect(setup({ failure: broken }).check({ identity: USER })).rejects.toBe(broken);
    await expect(setup({ failure: new ForbiddenError("x") }).check({ identity: USER })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("refuses a session without an identity", async () => {
    await expect(setup().check({})).rejects.toThrow(UnauthorizedError);
  });
});

describe("createSessionGuard (CC-116)", () => {
  function request(sessionData) {
    const req = {
      sessionID: "old-session",
      session: {
        ...sessionData,
        regenerate(done) {
          req.session = { regenerate: this.regenerate };
          req.sessionID = "new-session";
          done();
        },
      },
      log: { info: vi.fn() },
    };
    return req;
  }

  function guard(check) {
    const onSessionEnded = vi.fn();
    const middleware = createSessionGuard({ checkSession: check, onSessionEnded, now: () => T0 });
    return { middleware, onSessionEnded };
  }

  it("lets a session that may be used through unchanged", async () => {
    const { middleware, onSessionEnded } = guard(async () => {});
    const req = request({ identity: USER, sessionVersion: 0, signedInAt: T0 - DAY });
    const next = vi.fn();

    await middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.session.identity).toEqual(USER);
    expect(req.session.signedInAt).toBe(T0 - DAY);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("stamps a signed-in session from before CC-116 with now, so its 90 days start today", async () => {
    const { middleware } = guard(async () => {});
    const req = request({ identity: USER });

    await middleware(req, {}, vi.fn());

    expect(req.session.signedInAt).toBe(T0);
  });

  it("does not stamp a guest session", async () => {
    const { middleware } = guard(async () => {});
    const req = request({ identity: GUEST });

    await middleware(req, {}, vi.fn());

    expect(req.session.signedInAt).toBeUndefined();
  });

  it("replaces a session that may no longer be used by an empty one, and disconnects the old one's sockets", async () => {
    const { middleware, onSessionEnded } = guard(async () => {
      throw new UnauthorizedError("signed out", { details: { reason: SESSION_END_REASONS.SIGNED_OUT } });
    });
    const req = request({ identity: USER, sessionVersion: 0 });
    const next = vi.fn();

    await middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.session.identity).toBeUndefined();
    expect(onSessionEnded).toHaveBeenCalledWith("old-session");
    expect(req.log.info).toHaveBeenCalledWith(
      { playerId: USER.id, reason: SESSION_END_REASONS.SIGNED_OUT },
      "session ended by the server",
    );
  });

  it("passes a failure to replace the ended session on as an error", async () => {
    const { middleware, onSessionEnded } = guard(async () => {
      throw new UnauthorizedError("signed out", { details: { reason: SESSION_END_REASONS.SIGNED_OUT } });
    });
    const req = request({ identity: USER });
    req.session.regenerate = (done) => done(new Error("store down"));

    await expect(middleware(req, {}, vi.fn())).rejects.toThrow("store down");
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("passes a failure of the check itself on as an error", async () => {
    const broken = new Error("database down");
    const { middleware, onSessionEnded } = guard(async () => {
      throw broken;
    });

    await expect(middleware(request({ identity: USER }), {}, vi.fn())).rejects.toBe(broken);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ identity: { ...USER, id: "forged" } }]])(
    "leaves a session without a valid identity for the routes to judge (%o)",
    async (sessionData) => {
      const check = vi.fn();
      const { middleware } = guard(check);
      const next = vi.fn();

      await middleware(request(sessionData), {}, next);

      expect(check).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    },
  );
});

describe("destroySession", () => {
  it("ends the session, or reports the store's failure", async () => {
    await expect(destroySession(requestWithStore())).resolves.toBeUndefined();
    await expect(destroySession(requestWithStore({ destroy: new Error("store down") }))).rejects.toThrow(
      "store down",
    );
  });
});
