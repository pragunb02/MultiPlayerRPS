import { mkdtempSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOOPBACK_HOSTS, makeCertificate, startTlsFront } from "./tlsFront.js";

// Real sockets on free ports, and a real certificate from openssl, because what matters is that a browser can
// talk HTTPS to the app through it.
const dir = mkdtempSync(path.join(os.tmpdir(), "cc-tls-front-"));
let certificate;

beforeAll(() => {
  certificate = makeCertificate(path.join(dir, "tls"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A free port on the loopback address: listen on port 0, read what was given, then let it go. */
async function freePort() {
  const probe = http.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => probe.once("listening", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** A GET over HTTPS that trusts only this run's certificate, so the name and address must match it. */
const get = (host, port, ca) =>
  new Promise((resolve, reject) => {
    https
      .get({ host, port, path: "/hello", ca, headers: { "X-Forwarded-Proto": "https" } }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });

describe("makeCertificate", () => {
  it("makes a certificate for localhost and both loopback addresses, and keeps it private to this user", () => {
    const cert = new X509Certificate(certificate.cert);

    expect(cert.subjectAltName).toBe("DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1");
    expect(certificate.key).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(statSync(path.join(dir, "tls")).mode & 0o077).toBe(0);
  });

  it("is valid for a short time only", () => {
    const cert = new X509Certificate(certificate.cert);
    const days = (Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86_400_000;

    expect(days).toBeLessThanOrEqual(2);
  });
});

describe("startTlsFront", () => {
  let app;
  let appPort;

  beforeAll(async () => {
    appPort = await freePort();
    // The app answers with fixed words only, saying whether the request reached it exactly as it was sent.
    app = http
      .createServer((req, res) => {
        const unchanged = req.url === "/hello" && req.headers["x-forwarded-proto"] === "https";
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(unchanged ? "app saw the request unchanged" : "app saw a changed request");
      })
      .listen(appPort, "127.0.0.1");
    await new Promise((resolve) => app.once("listening", resolve));
  });
  afterAll(() => new Promise((resolve) => app.close(resolve)));

  it("ends HTTPS on every loopback address and passes the request to the app unchanged", async () => {
    const port = await freePort();
    const front = await startTlsFront({ port, appPort, ...certificate });

    try {
      for (const host of ["localhost", ...LOOPBACK_HOSTS]) {
        expect(await get(host, port, certificate.cert), host).toEqual({
          status: 200,
          body: "app saw the request unchanged",
        });
      }
    } finally {
      await front.close();
    }
  });

  it("closes the browser's connection while the app is not listening, as during a restart", async () => {
    const port = await freePort();
    const front = await startTlsFront({ port, appPort: await freePort(), ...certificate });

    try {
      await expect(get("localhost", port, certificate.cert)).rejects.toThrow(/socket hang up|ECONNRESET/);
    } finally {
      await front.close();
    }
  });

  it("drops open connections when it closes", async () => {
    const port = await freePort();
    const front = await startTlsFront({ port, appPort, ...certificate });
    const agent = new https.Agent({ keepAlive: true, ca: certificate.cert });
    await new Promise((resolve, reject) =>
      https
        .get({ host: "localhost", port, agent }, (res) => res.resume().on("end", resolve))
        .on("error", reject),
    );
    const [socket] = Object.values(agent.freeSockets).flat();
    const dropped = new Promise((resolve) => socket.once("close", resolve));

    await front.close();

    await expect(dropped).resolves.toBe(false);
    agent.destroy();
  });

  it("refuses to start on a port that is taken, and leaves no address listening", async () => {
    // The app holds this port on 127.0.0.1 only, so ::1 could start and must be let go again.
    await expect(startTlsFront({ port: appPort, appPort, ...certificate })).rejects.toThrow(/EADDRINUSE/);

    const again = http.createServer().listen(appPort, "::1");
    await new Promise((resolve, reject) => again.once("listening", resolve).once("error", reject));
    await new Promise((resolve) => again.close(resolve));
  });
});
