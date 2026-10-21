import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createSocketClients, send } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";
import { dayOf } from "../../utils/indiaTime.js";

// The list of signed-in devices and signing one out, through the real routes, sessions and sockets (CC-262). Each
// device is a separate session cookie with its own user agent.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };
const BOB = { username: "Bob", email: "bob@example.com", password: "another long password" };
const LAPTOP_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";
const PHONE_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
// 20:00 in London is 01:30 the next morning in India, so the sign-in day is the India one.
const SIGNED_IN = Date.UTC(2026, 9, 20, 20, 0);

async function call(method, path, { body, cookie, agent, headers = {} } = {}) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(cookie && { cookie }),
      ...(agent && { "User-Agent": agent }),
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
  };
}

const whoAmI = async (cookie) => (await call("GET", "/api/session", { cookie })).body;
const devicesOf = (cookie) => call("GET", "/api/auth/devices", { cookie });
const signOut = (cookie, deviceId) =>
  call("DELETE", `/api/auth/devices/${encodeURIComponent(deviceId)}`, { cookie });
/** The session id inside a `cc.sid=s%3A<id>.<signature>` cookie. */
const sessionIdOf = (cookie) => decodeURIComponent(cookie.split("=")[1]).slice(2).split(".")[0];
const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, item]) => [key, ...stringsIn(item)])
      : [];

/** Riya signs up on her laptop and logs in on her phone: two sessions of one account. */
async function twoDevices(options = {}) {
  server = await startTestServer({ now: () => SIGNED_IN, ...options });
  const laptop = (await call("POST", "/api/auth/signup", { body: RIYA, agent: LAPTOP_AGENT })).cookie;
  const phone = (
    await call("POST", "/api/auth/login", {
      body: { email: RIYA.email, password: RIYA.password },
      agent: PHONE_AGENT,
    })
  ).cookie;
  return { laptop, phone };
}

const phoneIdOf = async (laptop) =>
  (await devicesOf(laptop)).body.devices.find((device) => !device.current).id;

describe("GET /api/auth/devices (CC-262)", () => {
  it("lists every signed-in device of the account, this one first and marked", async () => {
    const { laptop } = await twoDevices();
    const before = dayOf(Date.now());

    const res = await devicesOf(laptop);

    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([
      {
        id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        browser: "Firefox",
        system: "Windows",
        signedInDay: "2026-10-21",
        lastSeenDay: "2026-10-21",
        current: true,
      },
      {
        id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        browser: "Chrome",
        system: "Android",
        signedInDay: "2026-10-21",
        lastSeenDay: expect.any(String),
        current: false,
      },
    ]);
    // The phone's last visit is when its session was last written, by the real clock.
    expect([before, dayOf(Date.now())]).toContain(res.body.devices[1].lastSeenDay);
    expect(res.body.devices[0].id).not.toBe(res.body.devices[1].id);
  });

  it("never sends a session id, a player id or anything of another account", async () => {
    const { laptop, phone } = await twoDevices();
    const bob = (await call("POST", "/api/auth/signup", { body: BOB, agent: PHONE_AGENT })).cookie;
    const bobsDevice = (await devicesOf(bob)).body.devices[0].id;

    const res = await devicesOf(laptop);

    const strings = stringsIn(res.body);
    expect(strings.filter(hasPlayerIdShape)).toEqual([]);
    const text = JSON.stringify(res.body);
    for (const cookie of [laptop, phone, bob]) {
      expect(text).not.toContain(sessionIdOf(cookie));
    }
    expect(text).not.toContain(bobsDevice);
    expect(text).not.toContain("Riya");
    expect(text).not.toContain("Bob");
    expect(res.body.devices).toHaveLength(2);
  });

  it("keeps this device marked after signing out the others, and lists only it", async () => {
    const { laptop } = await twoDevices();
    const laptopId = (await devicesOf(laptop)).body.devices[0].id;

    const renewed = (await call("POST", "/api/auth/sign-out-others", { cookie: laptop })).cookie;
    const res = await devicesOf(renewed);

    expect(res.body.devices).toEqual([expect.objectContaining({ id: laptopId, current: true })]);
  });

  it("refuses a visitor without a session and a guest, who has no devices to list", async () => {
    server = await startTestServer();
    const guest = (await call("POST", "/api/session/guest")).cookie;

    const anonymous = await devicesOf(undefined);
    const asGuest = await devicesOf(guest);

    expect(anonymous.status).toBe(401);
    expect(asGuest.status).toBe(403);
    expect(asGuest.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
  });
});

describe("DELETE /api/auth/devices/:deviceId (CC-262)", () => {
  it("signs out only that device at once, cuts its socket and keeps this one", async () => {
    const { laptop, phone } = await twoDevices();
    const tablet = (
      await call("POST", "/api/auth/login", { body: { email: RIYA.email, password: RIYA.password } })
    ).cookie;
    const laptopSocket = await clients.openSocket(laptop);
    const phoneSocket = await clients.openSocket(phone);
    const phoneCut = new Promise((resolve) => phoneSocket.once("disconnect", resolve));
    const phoneId = (await devicesOf(laptop)).body.devices.find(
      (device) => device.browser === "Chrome" && device.system === "Android",
    ).id;

    const res = await signOut(laptop, phoneId);

    expect(res.status).toBe(204);
    expect(await phoneCut).toBe("io server disconnect");
    expect(await whoAmI(phone)).toEqual({ authenticated: false });
    expect((await whoAmI(laptop)).authenticated).toBe(true);
    expect((await whoAmI(tablet)).authenticated).toBe(true);
    expect((await send(laptopSocket, SOCKET_EVENTS.IDENTITY_GET)).ok).toBe(true);
    expect(server.endedSessions).toEqual([sessionIdOf(phone)]);
    expect((await devicesOf(laptop)).body.devices.map((device) => device.id)).not.toContain(phoneId);
    const refused = await clients.openSocket(phone).catch((err) => err);
    expect(refused).toBeInstanceOf(Error);
  });

  it("answers 404 for another account's device and leaves it signed in", async () => {
    const { laptop } = await twoDevices();
    const bob = (await call("POST", "/api/auth/signup", { body: BOB })).cookie;
    const bobsDevice = (await devicesOf(bob)).body.devices[0].id;

    const res = await signOut(laptop, bobsDevice);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect((await whoAmI(bob)).authenticated).toBe(true);
    expect(server.endedSessions).toEqual([]);
  });

  it("answers 404 a second time, once the device is gone", async () => {
    const { laptop } = await twoDevices();
    const phoneId = await phoneIdOf(laptop);

    expect((await signOut(laptop, phoneId)).status).toBe(204);
    expect((await signOut(laptop, phoneId)).status).toBe(404);
  });

  it("refuses to sign out the device in use, which the normal Log out does", async () => {
    const { laptop } = await twoDevices();
    const laptopId = (await devicesOf(laptop)).body.devices[0].id;

    const res = await signOut(laptop, laptopId);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((await whoAmI(laptop)).authenticated).toBe(true);
  });

  it.each(["short", "a".repeat(23), "has a space in it here", "../../session"])(
    "refuses a device id of the wrong shape (%s)",
    async (deviceId) => {
      const { laptop } = await twoDevices();

      expect((await signOut(laptop, deviceId)).status).toBe(400);
    },
  );

  it("refuses a visitor, a guest and a cross-site request", async () => {
    const { laptop } = await twoDevices();
    const phoneId = await phoneIdOf(laptop);
    const guest = (await call("POST", "/api/session/guest")).cookie;

    const anonymous = await signOut(undefined, phoneId);
    const asGuest = await signOut(guest, phoneId);
    const crossSite = await call("DELETE", `/api/auth/devices/${phoneId}`, {
      cookie: laptop,
      headers: { Origin: "https://evil.example" },
    });

    expect([anonymous.status, asGuest.status, crossSite.status]).toEqual([401, 403, 403]);
    expect((await devicesOf(laptop)).body.devices).toHaveLength(2);
  });

  it("logs who signed a device out, never a session id", async () => {
    const { laptop, phone } = await twoDevices();

    await signOut(laptop, await phoneIdOf(laptop));

    const logs = JSON.stringify(server.entries);
    expect(logs).toContain("device signed out");
    expect(logs).not.toContain(sessionIdOf(phone));
  });
});
