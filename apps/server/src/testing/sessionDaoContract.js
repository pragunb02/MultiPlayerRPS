import { expect, it } from "vitest";

const cookie = () => ({
  originalMaxAge: 60_000,
  expires: new Date(Date.now() + 60_000),
  httpOnly: true,
  path: "/",
});
const sessionOf = (id) => ({ cookie: cookie(), identity: { kind: "user", id, displayName: "Riya" } });
const RIYA = "user_0123456789abcdef01234567";
const OTHER = "user_ffffffffffffffffffffffff";
const LAST_SEEN = Date.now() - 5 * 60_000;
const MAX_AGE = 60 * 60_000;
/** An account's session with its device (CC-262), last written at LAST_SEEN. */
const signedIn = (id, deviceId, fields = {}) => ({
  cookie: { ...cookie(), originalMaxAge: MAX_AGE, expires: new Date(LAST_SEEN + MAX_AGE) },
  identity: { kind: "user", id, displayName: "Riya" },
  sessionVersion: 2,
  signedInAt: Date.UTC(2026, 9, 1),
  device: { id: deviceId, browser: "Chrome", system: "Android" },
  ...fields,
});

const put = (store, sid, data) =>
  new Promise((resolve, reject) => store.set(sid, data, (err) => (err ? reject(err) : resolve())));
const read = (store, sid) =>
  new Promise((resolve, reject) => store.get(sid, (err, data) => (err ? reject(err) : resolve(data))));

/**
 * Behaviour every session DAO must have: the MongoDB one over the real session store, and the double over
 * express-session's memory store (CC-035).
 *
 * @param {() => Promise<{ dao: ReturnType<typeof import("../persistence/sessionDao.js").createSessionDao>, store: import("express-session").Store }>} createPair
 */
export function runSessionDaoContract(createPair) {
  it("deletes every stored session of one player and leaves the others", async () => {
    const { dao, store } = await createPair();
    await put(store, "phone", sessionOf("user_0123456789abcdef01234567"));
    await put(store, "laptop", sessionOf("user_0123456789abcdef01234567"));
    await put(store, "friend", sessionOf("user_ffffffffffffffffffffffff"));

    expect(await dao.deleteByPlayer("user_0123456789abcdef01234567")).toBe(2);
    expect(await dao.deleteByPlayer("user_0123456789abcdef01234567")).toBe(0);

    expect(await read(store, "phone")).toBeFalsy();
    expect(await read(store, "laptop")).toBeFalsy();
    expect((await read(store, "friend")).identity.id).toBe("user_ffffffffffffffffffffffff");
  });

  it("leaves sessions without an identity alone", async () => {
    const { dao, store } = await createPair();
    await put(store, "empty", { cookie: cookie() });

    expect(await dao.deleteByPlayer("user_0123456789abcdef01234567")).toBe(0);

    expect(await read(store, "empty")).toBeTruthy();
  });

  it("lists the sessions of one player that have a device, with when each was last written (CC-262)", async () => {
    const { dao, store } = await createPair();
    await put(store, "phone-session", signedIn(RIYA, "phone-device"));
    await put(store, "laptop-session", signedIn(RIYA, "laptop-device", { sessionVersion: 1 }));
    await put(store, "older-session", sessionOf(RIYA));
    await put(store, "friend-session", signedIn(OTHER, "friend-device"));

    const listed = await dao.listByPlayer(RIYA);

    expect([...listed].sort((a, b) => a.sessionId.localeCompare(b.sessionId))).toEqual([
      {
        sessionId: "laptop-session",
        sessionVersion: 1,
        signedInAt: Date.UTC(2026, 9, 1),
        lastSeenAt: LAST_SEEN,
        device: { id: "laptop-device", browser: "Chrome", system: "Android" },
      },
      {
        sessionId: "phone-session",
        sessionVersion: 2,
        signedInAt: Date.UTC(2026, 9, 1),
        lastSeenAt: LAST_SEEN,
        device: { id: "phone-device", browser: "Chrome", system: "Android" },
      },
    ]);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(await dao.listByPlayer("user_000000000000000000000000")).toEqual([]);
  });

  it("reads a session from before CC-116, which has no session version, as version 0 (CC-262)", async () => {
    const { dao, store } = await createPair();
    const { sessionVersion, ...older } = signedIn(RIYA, "older-device");
    await put(store, "older-session", older);

    const [listed] = await dao.listByPlayer(RIYA);

    expect(sessionVersion).toBe(2);
    expect(listed.sessionVersion).toBe(0);
  });

  it("deletes one session only when it belongs to that player (CC-262)", async () => {
    const { dao, store } = await createPair();
    await put(store, "phone-session", signedIn(RIYA, "phone-device"));
    await put(store, "friend-session", signedIn(OTHER, "friend-device"));

    expect(await dao.deleteSession({ sessionId: "friend-session", playerId: RIYA })).toBe(false);
    expect(await dao.deleteSession({ sessionId: "phone-session", playerId: RIYA })).toBe(true);
    expect(await dao.deleteSession({ sessionId: "phone-session", playerId: RIYA })).toBe(false);

    expect(await read(store, "phone-session")).toBeFalsy();
    expect((await read(store, "friend-session")).identity.id).toBe(OTHER);
  });
}
