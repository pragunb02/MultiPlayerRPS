// How a browser test reaches the e2e server process (CC-101). server.mjs runs the app in a child process and
// starts a new one whenever it stops, on the same port and the same database, like the hosting platform does
// after a deploy or a crash. A test restarts it the way the platform would: by signalling the process.
// Nothing about this exists in the app itself, so production has no way to be restarted from outside.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_URL, E2E_PORT } from "./personas.js";

const CONTROL_DIR = path.join(os.tmpdir(), `classicade-e2e-${E2E_PORT}`);
const APP_PID_FILE = path.join(CONTROL_DIR, "app.pid");
const ROOM_OPTIONS_FILE = path.join(CONTROL_DIR, "rooms.json");
/** The run's TLS certificate and key, made by server.mjs. They live only in this temporary folder. */
export const TLS_DIR = path.join(CONTROL_DIR, "tls");
const RESTART_TIMEOUT_MS = 30_000;

/** Called by server.mjs: a fresh control folder, with the standard room options. */
export function resetControl() {
  mkdirSync(CONTROL_DIR, { recursive: true });
  rmSync(ROOM_OPTIONS_FILE, { force: true });
}

/** Called by server.mjs whenever it starts an app process. */
export const recordAppPid = (pid) => writeFileSync(APP_PID_FILE, String(pid));

/** The room options for the next app process: short lifetimes for a test, or none for the standard ones. */
export function roomOptions() {
  try {
    return JSON.parse(readFileSync(ROOM_OPTIONS_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

const appPid = () => Number(readFileSync(APP_PID_FILE, "utf8"));

async function isHealthy() {
  try {
    return (await fetch(`${APP_URL}/health`)).ok;
  } catch {
    return false;
  }
}

/**
 * Stops the app process and waits until the next one serves requests. A deploy stops it gracefully
 * (SIGTERM), a crash kills it on the spot (SIGKILL). `rooms` are the room options of the next process
 * (`{ lifetimes, sweepIntervalMs }`, see startServer), and stay until the next restart.
 *
 * @param {{ crash?: boolean, rooms?: object }} [options]
 */
export async function restartServer({ crash = false, rooms = {} } = {}) {
  writeFileSync(ROOM_OPTIONS_FILE, JSON.stringify(rooms));
  const before = appPid();
  process.kill(before, crash ? "SIGKILL" : "SIGTERM");
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  while (appPid() === before || !(await isHealthy())) {
    if (Date.now() > deadline) {
      throw new Error(`The e2e server did not come back within ${RESTART_TIMEOUT_MS} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
