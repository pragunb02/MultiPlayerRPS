import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ERROR_CODES, NAME_REFUSALS } from "@classicade/shared";
import { RESERVED_NAME, UNSUITABLE_NAME } from "./models/credentials.js";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";

// Public names through the real composition root and a real MongoDB (CC-119). One server for the whole file,
// so every test uses its own email and looks only at its own account.
const LEGACY_ADMIN = { email: "old.admin@example.com", password: "old password 1" };
let mongo;
let app;

beforeAll(async () => {
  mongo = await startMemoryMongo();
  const config = testConfig({ MONGO_URI: mongo.uri("public-names") });
  const seeding = await mongoose.createConnection(config.mongoUri).asPromise();
  await seeding.db.collection("users").insertOne({
    username: "Admin",
    email: LEGACY_ADMIN.email,
    password: bcrypt.hashSync(LEGACY_ADMIN.password, 4),
  });
  await seeding.close();
  const started = await startServer({ config, logger: captureLogger().logger });
  app = { ...started, config, url: `http://127.0.0.1:${started.port}` };
}, 120_000);

afterAll(async () => {
  await app?.close();
  await mongo?.stop();
});

async function post(path, body) {
  const res = await fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function accountsWithEmail(email) {
  const connection = await mongoose.createConnection(app.config.mongoUri).asPromise();
  try {
    return await connection.db.collection("accounts").find({ email }).toArray();
  } finally {
    await connection.close();
  }
}

const emailFor = (username) => `${username.toLowerCase()}@example.com`;
const signup = (username) =>
  post("/api/auth/signup", { username, email: emailFor(username), password: "correct horse battery" });

describe("public names (integration)", () => {
  it.each([
    ["Admin_1", RESERVED_NAME],
    ["a_d_m_i_n", RESERVED_NAME],
    ["ClassiCade", RESERVED_NAME],
    ["Chess_Bot", RESERVED_NAME],
    ["fuuuck", UNSUITABLE_NAME],
    ["5h1t", UNSUITABLE_NAME],
  ])("refuses the sign-up name %j with a kind message and stores nothing", async (username, message) => {
    const res = await signup(username);

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_FAILED,
        message,
        details: {
          field: "username",
          reason: message === RESERVED_NAME ? NAME_REFUSALS.RESERVED : NAME_REFUSALS.UNSUITABLE,
        },
      }),
    );
    expect(await accountsWithEmail(emailFor(username))).toEqual([]);
  });

  it.each(["Scunthorpe", "Dickens", "Assassin", "classic_fan"])(
    "accepts the fair name %j that only looks close to a listed word",
    async (username) => {
      const res = await signup(username);

      expect(res.status).toBe(201);
      expect(res.body.identity.displayName).toBe(username);
      expect(await accountsWithEmail(emailFor(username))).toEqual([expect.objectContaining({ username })]);
    },
  );

  it("gives a legacy player with a reserved name a neutral username at first login", async () => {
    const login = await post("/api/auth/login", LEGACY_ADMIN);

    expect(login.status).toBe(200);
    expect(login.body.identity.displayName).toMatch(/^Player_\d{4}$/);
    const [account] = await accountsWithEmail(LEGACY_ADMIN.email);
    expect(account.username).toBe(login.body.identity.displayName);
  });
});
