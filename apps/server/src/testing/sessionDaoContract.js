import { expect, it } from "vitest";

const cookie = () => ({
  originalMaxAge: 60_000,
  expires: new Date(Date.now() + 60_000),
  httpOnly: true,
  path: "/",
});
const sessionOf = (id) => ({ cookie: cookie(), identity: { kind: "user", id, displayName: "Riya" } });

const put = (store, sid, data) =>
  new Promise((resolve, reject) => store.set(sid, data, (err) => (err ? reject(err) : resolve())));
const read = (store, sid) =>
  new Promise((resolve, reject) => store.get(sid, (err, data) => (err ? reject(err) : resolve(data))));

/**
 * Behaviour every session DAO must have: the MongoDB one over the real session store, and the double over
 * express-session's memory store (CC-035).
 *
 * @param {() => Promise<{ dao: { deleteByPlayer: (playerId: string) => Promise<number> }, store: import("express-session").Store }>} createPair
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

  // CC-341: which friend request rings a browser heard, kept beside its session so a restart does not forget them.
  const RING = { requestId: "00000000-0000-4000-9000-000000000001", ringAt: 1_000 };

  it("keeps the rings a session heard, newer than asked, and only for that session", async () => {
    const { dao, store } = await createPair();
    await put(store, "phone", sessionOf("user_0123456789abcdef01234567"));
    await put(store, "laptop", sessionOf("user_0123456789abcdef01234567"));

    await dao.addHeardRings({ sessionId: "phone", rings: [RING], since: 0 });
    await dao.addHeardRings({ sessionId: "phone", rings: [{ ...RING, ringAt: 2_000 }], since: 0 });

    expect(await dao.heardRings({ sessionId: "phone", since: 0 })).toEqual([
      RING,
      { ...RING, ringAt: 2_000 },
    ]);
    expect(await dao.heardRings({ sessionId: "phone", since: 1_000 })).toEqual([{ ...RING, ringAt: 2_000 }]);
    expect(await dao.heardRings({ sessionId: "laptop", since: 0 })).toEqual([]);
  });

  it("drops the rings too old to matter whenever it adds one", async () => {
    const { dao, store } = await createPair();
    await put(store, "phone", sessionOf("user_0123456789abcdef01234567"));
    await dao.addHeardRings({ sessionId: "phone", rings: [RING], since: 0 });

    await dao.addHeardRings({ sessionId: "phone", rings: [{ ...RING, ringAt: 5_000 }], since: 1_000 });

    expect(await dao.heardRings({ sessionId: "phone", since: 0 })).toEqual([{ ...RING, ringAt: 5_000 }]);
  });

  it("keeps the heard rings when the session itself is saved again, as every answer may do", async () => {
    const { dao, store } = await createPair();
    await put(store, "phone", sessionOf("user_0123456789abcdef01234567"));
    await dao.addHeardRings({ sessionId: "phone", rings: [RING], since: 0 });

    await put(store, "phone", { ...sessionOf("user_0123456789abcdef01234567"), signedInAt: 5 });

    expect(await dao.heardRings({ sessionId: "phone", since: 0 })).toEqual([RING]);
    expect((await read(store, "phone")).signedInAt).toBe(5);
  });

  it("never brings back a session that ended, and keeps nothing for one that does not exist", async () => {
    const { dao, store } = await createPair();
    await put(store, "phone", sessionOf("user_0123456789abcdef01234567"));
    await new Promise((resolve, reject) => store.destroy("phone", (err) => (err ? reject(err) : resolve())));

    await dao.addHeardRings({ sessionId: "phone", rings: [RING], since: 0 });
    await dao.addHeardRings({ sessionId: "never", rings: [RING], since: 0 });

    expect(await read(store, "phone")).toBeFalsy();
    expect(await read(store, "never")).toBeFalsy();
    expect(await dao.heardRings({ sessionId: "phone", since: 0 })).toEqual([]);
    expect(await dao.heardRings({ sessionId: "never", since: 0 })).toEqual([]);
  });
}
