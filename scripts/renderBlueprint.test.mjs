import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../apps/server/src/config/index.js";
import { parseBlueprint } from "./render/blueprintSchema.mjs";

// render.yaml is production's settings on Render (ADR-063). Linking it to the live service applies every value in
// it, so these checks pin what the dashboard has today and keep every secret out of this public repository.
const read = (/** @type {string} */ path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** The values that stay in Render's dashboard only. Render keeps them when the file says `sync: false`. */
const SECRETS = Object.freeze(["MONGO_URI", "SESSION_SECRET", "ADMIN_ACCOUNT_IDS"]);

/** Settings that are not secret, so a change to them is a reviewed pull request. */
const PLAIN = Object.freeze({
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  LOG_LEVEL: "info",
  ALLOWED_ORIGINS: "https://nocapgaming.onrender.com",
  WEB_DIST_DIR: "apps/web/dist",
  TRUST_PROXY_HOPS: "1",
});

/** Render sets these itself. Declaring one would replace Render's own value. */
const RENDER_OWNED = Object.freeze(["PORT"]);

/** @returns {Promise<Record<string, any>>} */
async function blueprint() {
  return /** @type {Record<string, any>} */ (parseBlueprint(await read("render.yaml")));
}

async function service() {
  const { services } = await blueprint();
  return services[0];
}

/** Every env var name the server's config reads, found in the config module itself so the list cannot drift. */
async function namesConfigReads() {
  const source = await read("apps/server/src/config/index.js");
  return [...new Set([...source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)].map((match) => match[1]))].sort();
}

describe("render.yaml", () => {
  it("declares only the one production web service", async () => {
    const file = await blueprint();

    expect(Object.keys(file)).toEqual(["services"]);
    expect(file.services).toHaveLength(1);
  });

  it("names the existing service, so Render updates it instead of creating a second one", async () => {
    const { type, name, runtime, region, plan } = await service();

    // Render matches an existing service by name. Type and region can never change after creation.
    expect({ type, name, runtime, region, plan }).toEqual({
      type: "web",
      name: "NoCapGaming",
      runtime: "node",
      region: "oregon",
      plan: "free",
    });
  });

  it("builds and starts the way the dashboard does today", async () => {
    const { branch, buildCommand, startCommand } = await service();
    const { scripts } = JSON.parse(await read("package.json"));

    expect({ branch, buildCommand, startCommand }).toEqual({
      branch: "main",
      buildCommand: "npm ci --include=dev && npm run build:web",
      startCommand: "npm start",
    });
    expect(Object.keys(scripts)).toEqual(expect.arrayContaining(["start", "build:web"]));
  });

  it("deploys only after CI passes and only when the health check passes", async () => {
    const { autoDeployTrigger, healthCheckPath } = await service();

    expect({ autoDeployTrigger, healthCheckPath }).toEqual({
      autoDeployTrigger: "checksPass",
      healthCheckPath: "/health",
    });
  });

  it("sets no field beyond the reviewed ones, so nothing else changes on the live service", async () => {
    expect(Object.keys(await service()).sort()).toEqual(
      [
        "autoDeployTrigger",
        "branch",
        "buildCommand",
        "envVars",
        "healthCheckPath",
        "name",
        "plan",
        "region",
        "runtime",
        "startCommand",
        "type",
      ].sort(),
    );
  });

  it("declares every env var the server reads, except the ones Render sets itself", async () => {
    const declared = (await service()).envVars.map((/** @type {{ key: string }} */ envVar) => envVar.key);

    expect(declared).toHaveLength(new Set(declared).size);
    expect([...declared].sort()).toEqual(
      (await namesConfigReads()).filter((name) => !RENDER_OWNED.includes(name)),
    );
    expect([...declared].sort()).toEqual([...SECRETS, ...Object.keys(PLAIN)].sort());
  });

  it("keeps every secret in the dashboard: sync false and no value in the file", async () => {
    const { envVars } = await service();

    for (const key of SECRETS) {
      expect(envVars.find((/** @type {{ key: string }} */ envVar) => envVar.key === key)).toEqual({
        key,
        sync: false,
      });
    }
  });

  it("writes every other setting as a plain text value", async () => {
    const { envVars } = await service();
    const plain = envVars.filter((/** @type {{ key: string }} */ envVar) => !SECRETS.includes(envVar.key));

    expect(plain).toEqual(Object.entries(PLAIN).map(([key, value]) => ({ key, value })));
  });

  it("holds nothing that looks like a credential", async () => {
    const text = await read("render.yaml");

    expect(text).not.toMatch(/mongodb(\+srv)?:\/\//i);
    expect(text).not.toMatch(/user_[0-9a-f]{24}/);
    expect(text).not.toMatch(/srv-[a-z0-9]{10,}/);
    expect(text).not.toMatch(/generateValue/);
  });

  it("has plain values that boot the server in production on Render's network", async () => {
    const { envVars } = await service();
    const env = Object.fromEntries(
      envVars
        .filter((/** @type {{ value?: string }} */ envVar) => envVar.value !== undefined)
        .map((/** @type {{ key: string, value: string }} */ envVar) => [envVar.key, envVar.value]),
    );

    // Placeholders for the secrets and for the port Render sets. Only the plain values come from the file.
    const config = loadConfig({
      ...env,
      PORT: "10000",
      MONGO_URI: "mongodb://placeholder.invalid/classicade",
      SESSION_SECRET: "x".repeat(32),
    });

    expect(config).toMatchObject({
      isProduction: true,
      host: "0.0.0.0",
      allowedOrigins: ["https://nocapgaming.onrender.com"],
      trustProxyHops: 1,
      logLevel: "info",
    });
  });
});
