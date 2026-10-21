// The server for end-to-end tests, started by Playwright (playwright.config.js, webServer). It owns a throwaway
// MongoDB seeded with one player from the legacy app, and runs the app (app.mjs) in a child process. When the
// app stops, because a test restarted it like a deploy or a crash would (serverControl.js), a new app process
// starts on the same port with the same database, as the hosting platform does (CC-101). Browsers reach it over
// HTTPS through tlsFront.js, which stands in for the platform's proxy (CC-184).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { createLogger } from "../apps/server/src/utils/logger.js";
import { createPasswordHasher } from "../apps/server/src/utils/passwordHasher.js";
import { OWNER, seededWeek } from "./ownerConsole.js";
import { APP_PORT, E2E_MONGO_PORT, E2E_MONGO_URI, E2E_PORT, LEGACY_PLAYER } from "./personas.js";
import { downTime, recordAppPid, resetControl, roomOptions, TLS_DIR } from "./serverControl.js";
import { makeCertificate, startTlsFront } from "./tlsFront.js";
import { seededUxTotals } from "./uxTotals.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger({ level: "warn" });
// On a known port, so a test can seed state the shared server's clock can't reach (a streak from yesterday).
const mongo = await MongoMemoryServer.create({ instance: { port: E2E_MONGO_PORT, dbName: "e2e" } });
const uri = E2E_MONGO_URI;

const seed = await mongoose.createConnection(uri).asPromise();
await seed.db.collection("users").insertOne({
  username: LEGACY_PLAYER.legacyUsername,
  email: LEGACY_PLAYER.email,
  password: bcrypt.hashSync(LEGACY_PLAYER.password, 10),
  level: 7,
});
// The site's owner and a week of history for the owner console (CC-233).
await seed.db.collection("accounts").insertOne({
  _id: new mongoose.Types.ObjectId(OWNER.accountId),
  username: OWNER.username,
  usernameKey: OWNER.username.toLowerCase(),
  email: OWNER.email,
  passwordHash: await createPasswordHasher().hash(OWNER.password),
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
});
const week = seededWeek();
await seed.db.collection("matches").insertMany(week.matches);
await seed.db.collection("player_transfers").insertMany(week.transfers);
// The UX page's daily usage totals (CC-177), for the days before today on the real clock.
await seed.db.collection("telemetry_daily").insertMany(seededUxTotals(Date.now()));
await seed.close();

resetControl();
const front = await startTlsFront({ port: E2E_PORT, appPort: APP_PORT, ...makeCertificate(TLS_DIR) });
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
      setTimeout(startApp, downTime());
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
  await front.close();
  await mongo.stop();
  process.exit(exitCode);
}

startApp();
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
