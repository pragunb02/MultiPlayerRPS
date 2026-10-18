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
}
