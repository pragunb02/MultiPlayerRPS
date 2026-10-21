import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, send } from "../../testing/socketClients.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { startTestServer } from "../../testing/testApp.js";
import { SESSION_ABSOLUTE_LIFETIME_MS } from "./session.js";

// Password change, "sign out other devices" and the 90 day session lifetime through the real routes and sockets
// (CC-116). Each device is a separate session cookie.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };
const NEW_PASSWORD = "a brand new password";

async function call(method, path, { body, cookie, headers = {} } = {}) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(cookie && { cookie }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  return {
    status: res.status,
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie ? setCookie.split(";")[0] : cookie,
    setsCookie: setCookie !== null,
  };
}

const whoAmI = async (cookie) => (await call("GET", "/api/session", { cookie })).body;
const login = (password = RIYA.password) =>
  call("POST", "/api/auth/login", { body: { email: RIYA.email, password } });

/** Riya signs up on her laptop and logs in on her phone: two sessions of one account. */
async function twoDevices(options = {}) {
  server = await startTestServer(options);
  const laptop = (await call("POST", "/api/auth/signup", { body: RIYA })).cookie;
  const phone = (await login()).cookie;
  return { laptop, phone };
}

const changePassword = (cookie, body = { currentPassword: RIYA.password, newPassword: NEW_PASSWORD }) =>
  call("POST", "/api/auth/password", { cookie, body });

describe("POST /api/auth/password (CC-116)", () => {
  it("changes the password, keeps this device signed in and signs out the other", async () => {
    const { laptop, phone } = await twoDevices();

    const changed = await changePassword(laptop);

    expect(changed.status).toBe(204);
    expect((await whoAmI(changed.cookie)).authenticated).toBe(true);
    expect(await whoAmI(phone)).toEqual({ authenticated: false });
    expect((await login(RIYA.password)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it("gives this device a new session id, so a copy of its old cookie stops working", async () => {
    const { laptop } = await twoDevices();
    const stolenCopy = laptop;

    const changed = await changePassword(laptop);

    expect(changed.cookie).not.toBe(laptop);
    expect(await whoAmI(stolenCopy)).toEqual({ authenticated: false });
    expect((await whoAmI(changed.cookie)).authenticated).toBe(true);
    const refused = await clients.openSocket(stolenCopy).catch((err) => err);
    expect(refused.data).toEqual({ code: ERROR_CODES.UNAUTHORIZED });
  });

  it("keeps a request of this browser that was on its way during the change signed in", async () => {
    const accounts = createInMemoryAccountDao();
    let releaseBump;
    let bumping;
    const accountDao = {
      ...accounts,
      bumpSessionVersion: async (change) => {
        const result = await accounts.bumpSessionVersion(change);
        bumping?.();
        await new Promise((resolve) => {
          releaseBump = resolve;
        });
        return result;
      },
    };
    server = await startTestServer({ accountDao });
    const laptop = (await call("POST", "/api/auth/signup", { body: RIYA })).cookie;
    const bumped = new Promise((resolve) => {
      bumping = resolve;
    });

    const change = changePassword(laptop);
    await bumped;
    const meanwhile = await whoAmI(laptop);
    releaseBump();
    const changed = await change;

    expect(meanwhile.authenticated).toBe(true);
    expect(changed.status).toBe(204);
    expect((await whoAmI(changed.cookie)).authenticated).toBe(true);
    expect(server.endedSessions).toEqual([]);
  });

  it("disconnects the other device's sockets at once and leaves this device's connected", async () => {
    const { laptop, phone } = await twoDevices();
    const laptopSocket = await clients.openSocket(laptop);
    const phoneSocket = await clients.openSocket(phone);
    const phoneCut = new Promise((resolve) => phoneSocket.once("disconnect", resolve));

    const changed = await changePassword(laptop);

    expect(await phoneCut).toBe("io server disconnect");
    expect((await send(laptopSocket, SOCKET_EVENTS.IDENTITY_GET)).ok).toBe(true);
    expect(server.otherSessionsEnded).toEqual([
      {
        playerId: expect.stringMatching(/^user_/),
        fromSessionId: expect.any(String),
        toSessionId: expect.any(String),
      },
    ]);
    // The laptop's socket now belongs to the new session: signing out there reaches it.
    const laptopCut = new Promise((resolve) => laptopSocket.once("disconnect", resolve));
    await call("DELETE", "/api/session", { cookie: changed.cookie });
    expect(await laptopCut).toBe("io server disconnect");
  });

  it("refuses a wrong current password on its field and changes nothing", async () => {
    const { laptop, phone } = await twoDevices();

    const refused = await changePassword(laptop, {
      currentPassword: "not my password",
      newPassword: NEW_PASSWORD,
    });

    expect(refused.status).toBe(400);
    expect(refused.body.error).toEqual(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "That is not your current password",
        details: { field: "currentPassword" },
      }),
    );
    expect((await whoAmI(phone)).authenticated).toBe(true);
  });

  it("stops guessing the password from a signed-in browser after five wrong tries", async () => {
    const { laptop } = await twoDevices();
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await changePassword(laptop, { currentPassword: `guess ${i} xx`, newPassword: NEW_PASSWORD }))
          .status,
      );
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });

  it("refuses a visitor without a session and a guest, who has no password", async () => {
    server = await startTestServer();
    const guest = (await call("POST", "/api/session/guest")).cookie;

    const anonymous = await changePassword(undefined);
    const asGuest = await changePassword(guest);

    expect(anonymous.status).toBe(401);
    expect(asGuest.status).toBe(403);
    expect(asGuest.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it.each([
    [{ currentPassword: RIYA.password, newPassword: NEW_PASSWORD, admin: true }, 400],
    [[], 400],
  ])("accepts exactly the two fields as JSON (%#)", async (body, status) => {
    const { laptop } = await twoDevices();

    expect((await changePassword(laptop, body)).status).toBe(status);
  });

  it("follows the same cross-site rules as the other account routes", async () => {
    const { laptop } = await twoDevices();

    const crossSite = await call("POST", "/api/auth/password", {
      cookie: laptop,
      body: { currentPassword: RIYA.password, newPassword: NEW_PASSWORD },
      headers: { Origin: "https://evil.example" },
    });
    const notJson = await fetch(`${server.baseUrl}/api/auth/password`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", cookie: laptop },
      body: "currentPassword=x",
    });

    expect(crossSite.status).toBe(403);
    expect(notJson.status).toBe(415);
    expect((await whoAmI(laptop)).authenticated).toBe(true);
  });

  it("never logs the passwords", async () => {
    const { laptop } = await twoDevices();

    await changePassword(laptop);

    const logs = JSON.stringify(server.entries);
    expect(logs).not.toContain(RIYA.password);
    expect(logs).not.toContain(NEW_PASSWORD);
    expect(logs).toContain("password changed, other sessions signed out");
  });
});

describe("POST /api/auth/sign-out-others (CC-116)", () => {
  // CC-326: the profile page asks for several things at once, and the button can be pressed before they are all
  // answered. Sessions are rolling, so an answer would set the old, destroyed id again over the new one.
  it("keeps this device signed in when a request it sent before is answered after it", async () => {
    const accounts = createInMemoryAccountDao();
    let reading;
    let release;
    const accountDao = {
      ...accounts,
      getById: async (accountId) => {
        const account = await accounts.getById(accountId);
        if (reading) {
          reading();
          await new Promise((resolve) => {
            release = resolve;
          });
        }
        return account;
      },
    };
    server = await startTestServer({ accountDao });
    const laptop = (await call("POST", "/api/auth/signup", { body: RIYA })).cookie;
    const read = new Promise((resolve) => {
      reading = resolve;
    });

    const earlier = call("GET", "/api/account", { cookie: laptop });
    await read;
    reading = undefined;
    const signedOut = await call("POST", "/api/auth/sign-out-others", { cookie: laptop });
    release();
    const answered = await earlier;

    expect(signedOut.status).toBe(204);
    expect(answered.status).toBe(200);
    expect(answered.setsCookie).toBe(false);
    expect((await whoAmI(signedOut.cookie)).authenticated).toBe(true);
    expect(await whoAmI(laptop)).toEqual({ authenticated: false });
  });

  it("signs out every other device and keeps this one", async () => {
    const { laptop, phone } = await twoDevices();
    const tablet = (await login()).cookie;

    const res = await call("POST", "/api/auth/sign-out-others", { cookie: laptop });

    expect(res.status).toBe(204);
    expect((await whoAmI(res.cookie)).authenticated).toBe(true);
    expect(await whoAmI(laptop)).toEqual({ authenticated: false }); // the old id of this device is gone too
    expect(await whoAmI(phone)).toEqual({ authenticated: false });
    expect(await whoAmI(tablet)).toEqual({ authenticated: false });
    expect((await login()).status).toBe(200); // the password still works
  });

  it("refuses a realtime connection from a signed-out device, even before it made any other request", async () => {
    const { laptop, phone } = await twoDevices();

    await call("POST", "/api/auth/sign-out-others", { cookie: laptop });
    const refused = await clients.openSocket(phone).catch((err) => err);

    expect(refused).toBeInstanceOf(Error);
    expect(refused.data).toEqual({ code: ERROR_CODES.UNAUTHORIZED });
    expect(refused.message).toBe("You were signed out on this device, please log in again");
  });

  it("can be used twice in a row", async () => {
    const { laptop } = await twoDevices();

    const first = await call("POST", "/api/auth/sign-out-others", { cookie: laptop });
    const again = await call("POST", "/api/auth/sign-out-others", { cookie: first.cookie });

    expect(again.status).toBe(204);
    expect((await whoAmI(again.cookie)).authenticated).toBe(true);
  });

  it("accepts an empty JSON object, but nothing in it", async () => {
    const { laptop } = await twoDevices();

    expect((await call("POST", "/api/auth/sign-out-others", { cookie: laptop, body: {} })).status).toBe(204);
    expect(
      (await call("POST", "/api/auth/sign-out-others", { cookie: laptop, body: { all: true } })).status,
    ).toBe(400);
  });

  it("refuses a guest", async () => {
    server = await startTestServer();
    const guest = (await call("POST", "/api/session/guest")).cookie;

    expect((await call("POST", "/api/auth/sign-out-others", { cookie: guest })).status).toBe(403);
  });
});

describe("the 90 day session lifetime (CC-116)", () => {
  it("signs an account out 90 days after logging in, however often it was used", async () => {
    let time = Date.UTC(2026, 9, 17);
    const { laptop } = await twoDevices({ now: () => time });
    time += SESSION_ABSOLUTE_LIFETIME_MS - 1000;
    expect((await whoAmI(laptop)).authenticated).toBe(true);

    time += 1000;

    expect(await whoAmI(laptop)).toEqual({ authenticated: false });
    expect(
      server.entries.some(
        (entry) => entry.msg === "session ended by the server" && entry.reason === "expired",
      ),
    ).toBe(true);
  });

  it("does not start the 90 days again on sign out others, because no password was given", async () => {
    let time = Date.UTC(2026, 9, 17);
    const { laptop } = await twoDevices({ now: () => time });
    time += SESSION_ABSOLUTE_LIFETIME_MS - 2000;

    const renewed = (await call("POST", "/api/auth/sign-out-others", { cookie: laptop })).cookie;
    time += 2000;

    expect(await whoAmI(renewed)).toEqual({ authenticated: false });
  });

  it("starts the 90 days again on a password change, because the password was given", async () => {
    let time = Date.UTC(2026, 9, 17);
    const { laptop } = await twoDevices({ now: () => time });
    time += SESSION_ABSOLUTE_LIFETIME_MS - 2000;

    const renewed = (await changePassword(laptop)).cookie;
    time += 2000;

    expect((await whoAmI(renewed)).authenticated).toBe(true);
  });

  it("keeps a guest session however old it is", async () => {
    let time = Date.UTC(2026, 9, 17);
    server = await startTestServer({ now: () => time });
    const guest = (await call("POST", "/api/session/guest")).cookie;

    time += 2 * SESSION_ABSOLUTE_LIFETIME_MS;

    expect((await whoAmI(guest)).authenticated).toBe(true);
  });
});
