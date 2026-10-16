// The server for end-to-end tests, started by Playwright (playwright.config.js, webServer). It owns a throwaway
// MongoDB seeded with one player from the legacy app, and runs the app (app.mjs) in a child process. When the
// app stops, because a test restarted it like a deploy or a crash would (serverControl.js), a new app process
// starts on the same port with the same database, as the hosting platform does (CC-101).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { createLogger } from "../apps/server/src/utils/logger.js";
import { LEGACY_PLAYER } from "./personas.js";
import { recordAppPid, resetControl, roomOptions } from "./serverControl.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger({ level: "warn" });
const mongo = await MongoMemoryServer.create();
const uri = `${mongo.getUri()}e2e`;

const seed = await mongoose.createConnection(uri).asPromise();
await seed.db.collection("users").insertOne({
  username: LEGACY_PLAYER.legacyUsername,
  email: LEGACY_PLAYER.email,
  password: bcrypt.hashSync(LEGACY_PLAYER.password, 10),
  level: 7,
});
await seed.close();

resetControl();
let stopping = false;
let app;

function startApp() {
  app = spawn(process.execPath, [path.join(here, "app.mjs")], {
    stdio: "inherit",
    env: { ...process.env, E2E_MONGO_URI: uri, E2E_ROOMS: JSON.stringify(roomOptions()) },
  });
  recordAppPid(app.pid);
  app.once("exit", (code, signal) => {
    if (stopping) return;
    // Stopped by a signal, or shut down cleanly after one: start the next process. Failing by itself (it could
    // not even boot) would only fail again, so the whole test server stops instead.
    if (signal !== null || code === 0) {
      startApp();
      return;
    }
    logger.fatal({ code }, "the e2e app process failed");
    stop(1);
  });
}

async function stop(exitCode) {
  stopping = true;
  if (app.exitCode === null && app.signalCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    app.kill("SIGTERM");
    await exited;
  }
  await mongo.stop();
  process.exit(exitCode);
}

startApp();
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
