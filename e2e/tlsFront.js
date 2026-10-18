// Browsers reach the e2e app over HTTPS, the way players reach it on Render. This is the test stand-in for the
// hosting platform's proxy. It ends HTTPS with a certificate made for this run only and passes every connection,
// byte for byte, to the app on its own port. The app is not changed and runs in production configuration.
// WebKit needs this. On plain http://localhost it sends every request to HTTPS because of the page's security
// policy, and it refuses the Secure session cookie (CC-184).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

/** Loopback addresses only, so the test server can never be reached from another machine. */
export const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "::1"]);

/**
 * Makes a self-signed certificate for localhost, 127.0.0.1 and ::1 in `dir`, valid for two days, and returns it.
 * Only the test browsers see it, and they are told to accept it. It is made fresh for every run and never leaves
 * the temporary folder, so there is no private key in the repository. Needs `openssl`, which GitHub's runners and
 * macOS have.
 *
 * @param {string} dir a folder for the key and certificate, created when missing
 * @returns {{ key: string, cert: string }} both in PEM text
 */
export function makeCertificate(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-days",
      "2",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    ],
    { stdio: "pipe" },
  );
  return { key: readFileSync(keyFile, "utf8"), cert: readFileSync(certFile, "utf8") };
}

/**
 * Passes one browser connection to the app. When the app ends the connection, the pipe ends the browser's side
 * after the last bytes have gone, so no answer is cut short. A failure on either side drops both at once.
 */
function relay(client, appPort) {
  const app = net.connect({ port: appPort, host: "127.0.0.1" });
  const dropBoth = () => {
    client.destroy();
    app.destroy();
  };
  // While the app restarts nothing listens on its port. The browser then sees its connection close, as it would
  // behind Render while a new process starts, and the page's own reconnecting takes over.
  client.on("error", dropBoth);
  app.on("error", dropBoth);
  client.on("close", () => app.destroy());
  client.pipe(app).pipe(client);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host }, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/**
 * Serves HTTPS on `port` of every loopback address and passes each connection to the app on `appPort`. WebSocket
 * upgrades pass through untouched, because nothing here reads the requests.
 *
 * @param {{ port: number, appPort: number, key: string, cert: string }} options
 * @returns {Promise<{ close: () => Promise<void> }>} `close` stops listening and drops open connections
 */
export async function startTlsFront({ port, appPort, key, cert }) {
  const open = new Set();
  const accept = (client) => {
    open.add(client);
    client.on("close", () => open.delete(client));
    relay(client, appPort);
  };
  const started = await Promise.allSettled(
    LOOPBACK_HOSTS.map((host) => listen(tls.createServer({ key, cert }, accept), port, host)),
  );
  const servers = started.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const close = async () => {
    const closed = servers.map((server) => new Promise((resolve) => server.close(resolve)));
    open.forEach((client) => client.destroy());
    await Promise.all(closed);
  };
  // All addresses or none, so a failed start never leaves one address still listening.
  const failed = started.find((result) => result.status === "rejected");
  if (failed !== undefined) {
    await close();
    throw failed.reason;
  }
  return { close };
}
