import { describe, expect, it, vi } from "vitest";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../../utils/errors.js";
import {
  createSessionCheck,
  createSessionGuard,
  destroySession,
  establishAccountSession,
  establishSession,
  requireIdentity,
  createSessionRenewals,
  createRenewedSessionRelease,
  newDevice,
  userAgentOf,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_END_REASONS,
} from "./session.js";

const GUEST = { kind: "guest", id: "guest_123e4567-e89b-12d3-a456-426614174000", displayName: "Guest-7K2Q" };
const USER = { kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" };
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 17);
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const PHONE = Object.freeze({ id: "AAAAAAAAAAAAAAAAAAAAAA", browser: "Chrome", system: "Android" });

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

    await establishAccountSession(req, { identity: USER, sessionVersion: 3, signedInAt: T0, device: PHONE });

    expect(req.session).toMatchObject({ identity: USER, sessionVersion: 3, signedInAt: T0, device: PHONE });
  });
});

describe("newDevice (CC-262)", () => {
  it("gives a random id and the coarse browser and system of the user agent, nothing else", () => {
    const first = newDevice(ANDROID_CHROME);
    const second = newDevice(ANDROID_CHROME);

    expect(first).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      browser: "Chrome",
      system: "Android",
    });
    expect(second.id).not.toBe(first.id);
    expect(hasPlayerIdShape(first.id)).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
  });
});

describe("userAgentOf (CC-262)", () => {
  it("reads the user agent, and is empty when the request sent none", () => {
    expect(userAgentOf({ headers: { "user-agent": ANDROID_CHROME } })).toBe(ANDROID_CHROME);
    expect(userAgentOf({ headers: {} })).toBe("");
  });
});

describe("createSessionRenewals (CC-116)", () => {
  it("lets a renewing session id pass for five seconds, then never again", () => {
    let time = T0;
    const renewals = createSessionRenewals({ now: () => time });

    renewals.begin("old-session");
    time += 4_999;
    expect(renewals.isRenewing("old-session")).toBe(true);
    expect(renewals.isRenewing("other-session")).toBe(false);
    time += 1;

    expect(renewals.isRenewing("old-session")).toBe(false);
  });

  it("forgets ids whose grace has ended when a new one begins", () => {
    let time = T0;
    const renewals = createSessionRenewals({ now: () => time, graceMs: 10 });
    renewals.begin("first");
    time += 20;

    renewals.begin("second");

    expect([renewals.isRenewing("first"), renewals.isRenewing("second")]).toEqual([false, true]);
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

describe("createRenewedSessionRelease (CC-326)", () => {
  function answer(renewals, sessionID) {
    const req = { sessionID, session: { identity: USER } };
    const res = {
      writeHead: vi.fn(function writeHead() {
        return this;
      }),
    };
    const next = vi.fn();
    createRenewedSessionRelease({ renewals })(req, res, next);
    return { req, res, next };
  }

  it("lets go of a session whose id was renewed while its request was on its way, so its cookie is not set again", () => {
    const renewals = createSessionRenewals({ now: () => T0 });
    const { req, res, next } = answer(renewals, "old-session");
    renewals.begin("old-session");

    res.writeHead(200);

    expect(next).toHaveBeenCalledWith();
    expect(req.session).toBeNull();
  });

  it("keeps every other session for its answer", () => {
    const renewals = createSessionRenewals({ now: () => T0 });
    renewals.begin("another-session");
    const { req, res } = answer(renewals, "this-session");

    expect(res.writeHead(200)).toBe(res);
    expect(req.session).toEqual({ identity: USER });
  });

  it("needs the renewals", () => {
    expect(() => createRenewedSessionRelease({})).toThrow();
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
      headers: { "user-agent": ANDROID_CHROME },
      log: { info: vi.fn() },
    };
    return req;
  }

  function guard(check) {
    const onSessionEnded = vi.fn();
    const renewals = createSessionRenewals({ now: () => T0 });
    const middleware = createSessionGuard({ checkSession: check, onSessionEnded, renewals, now: () => T0 });
    return { middleware, onSessionEnded, renewals };
  }
  const signedOutCheck = async () => {
    throw new UnauthorizedError("signed out", { details: { reason: SESSION_END_REASONS.SIGNED_OUT } });
  };

  it("lets a request of a session that is being renewed by its own player through, without ending it", async () => {
    const { middleware, onSessionEnded, renewals } = guard(signedOutCheck);
    renewals.begin("old-session");
    const req = request({ identity: USER, sessionVersion: 0 });
    const next = vi.fn();

    await middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.session.identity).toEqual(USER);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("still ends a renewing session that is too old", async () => {
    const { middleware, onSessionEnded, renewals } = guard(async () => {
      throw new UnauthorizedError("expired", { details: { reason: SESSION_END_REASONS.EXPIRED } });
    });
    renewals.begin("old-session");

    await middleware(request({ identity: USER }), {}, vi.fn());

    expect(onSessionEnded).toHaveBeenCalledWith("old-session");
  });

  it("lets a session that may be used through unchanged", async () => {
    const { middleware, onSessionEnded } = guard(async () => {});
    const req = request({ identity: USER, sessionVersion: 0, signedInAt: T0 - DAY, device: PHONE });
    const next = vi.fn();

    await middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.session.identity).toEqual(USER);
    expect(req.session.signedInAt).toBe(T0 - DAY);
    expect(req.session.device).toBe(PHONE);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("gives a signed-in session from before CC-262 its device, from this request's user agent", async () => {
    const { middleware } = guard(async () => {});
    const req = request({ identity: USER, sessionVersion: 0, signedInAt: T0 - DAY });

    await middleware(req, {}, vi.fn());

    expect(req.session.device).toEqual({ id: expect.any(String), browser: "Chrome", system: "Android" });
  });

  it("gives a new device to a signed-in session whose stored device has no id", async () => {
    const { middleware } = guard(async () => {});
    const req = request({ identity: USER, sessionVersion: 0, signedInAt: T0, device: {} });

    await middleware(req, {}, vi.fn());

    expect(req.session.device).toEqual({ id: expect.any(String), browser: "Chrome", system: "Android" });
  });

  it("gives no device to a guest, or to a session it is about to end", async () => {
    const { middleware: lets } = guard(async () => {});
    const { middleware: ends } = guard(signedOutCheck);
    const asGuest = request({ identity: GUEST });
    const signedOut = request({ identity: USER, sessionVersion: 0 });

    await lets(asGuest, {}, vi.fn());
    await ends(signedOut, {}, vi.fn());

    expect(asGuest.session.device).toBeUndefined();
    expect(signedOut.session.device).toBeUndefined();
  });

  it("gives no device to a renewing session let through by its grace", async () => {
    const { middleware, renewals } = guard(signedOutCheck);
    renewals.begin("old-session");
    const req = request({ identity: USER, sessionVersion: 0, signedInAt: T0 });

    await middleware(req, {}, vi.fn());

    expect(req.session.device).toBeUndefined();
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
