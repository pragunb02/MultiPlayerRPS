import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { roomLimits } from "../../domain/rooms/roomLimits.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { startTestServer } from "../../testing/testApp.js";

// What happens when something changes while a realtime handshake is still checking its session (CC-107, CC-116).
// The account storage is held at the session check, so the test decides exactly when the check answers.
let server;
const sockets = [];

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await server?.close();
  server = undefined;
});

const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };

/** Account storage whose next session version read waits until `release()` is called. */
function heldAccounts() {
  const accounts = createInMemoryAccountDao();
  let hold;
  const control = {
    /** The next read waits. Resolves once that read has started. */
    holdNext() {
      return new Promise((started) => {
        hold = { started };
      });
    },
    release: () => {},
  };
  const accountDao = {
    ...accounts,
    async getSessionVersion(accountId) {
      const version = await accounts.getSessionVersion(accountId);
      if (hold !== undefined) {
        const { started } = hold;
        hold = undefined;
        await new Promise((resume) => {
          control.release = resume;
          started();
        });
      }
      return version;
    },
  };
  return { accountDao, control };
}

async function post(path, { body, cookie } = {}) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie };
}

function openSocket(cookie) {
  const socket = connect(server.baseUrl, {
    transports: ["websocket"],
    extraHeaders: { cookie },
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });

describe("a realtime handshake that is still checking its session", () => {
  it("gives its place back when the browser leaves during the check, so the caps never fill up for good", async () => {
    const { accountDao, control } = heldAccounts();
    server = await startTestServer({ accountDao, roomLimits: roomLimits({ socketsPerSession: 1 }) });
    const { cookie } = await post("/api/auth/signup", { body: RIYA });
    const checking = control.holdNext();
    const leaving = openSocket(cookie);
    await checking;

    leaving.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    control.release();

    await expect.poll(() => server.gateway.counts()).toEqual({ connections: 0, players: 0 });
    const next = openSocket(cookie);
    await connected(next);
    expect((await next.timeout(2_000).emitWithAck(SOCKET_EVENTS.IDENTITY_GET)).ok).toBe(true);
  });

  it("is disconnected when the player signs out their other devices during the check", async () => {
    const { accountDao, control } = heldAccounts();
    server = await startTestServer({ accountDao });
    const laptop = (await post("/api/auth/signup", { body: RIYA })).cookie;
    const phone = (await post("/api/auth/login", { body: { email: RIYA.email, password: RIYA.password } }))
      .cookie;
    const checking = control.holdNext();
    const phoneSocket = openSocket(phone);
    await checking;

    expect((await post("/api/auth/sign-out-others", { cookie: laptop })).status).toBe(204);
    const cut = new Promise((resolve) => phoneSocket.once("disconnect", resolve));
    control.release();

    expect(await cut).toBe("io server disconnect");
    await expect.poll(() => server.gateway.counts().connections).toBe(0);
    expect(server.find("socket of a session signed out during its handshake disconnected")).toHaveLength(1);
  });

  it("stays connected when the sign out happened for the session it belongs to", async () => {
    const { accountDao, control } = heldAccounts();
    server = await startTestServer({ accountDao });
    const laptop = (await post("/api/auth/signup", { body: RIYA })).cookie;
    const renewed = (await post("/api/auth/sign-out-others", { cookie: laptop })).cookie;
    const checking = control.holdNext();
    const laptopSocket = openSocket(renewed);
    await checking;

    control.release();
    await connected(laptopSocket);

    expect((await laptopSocket.timeout(2_000).emitWithAck(SOCKET_EVENTS.IDENTITY_GET)).ok).toBe(true);
  });
});
