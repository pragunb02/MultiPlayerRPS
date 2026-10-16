import { describe, expect, it } from "vitest";

import { OpsError } from "../lib/errors.mjs";
import { BACKUP_SECRETS, checkBackupConfig, recipientLines } from "./backupConfig.mjs";

const PUBLIC_KEY = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";

/** @param {Record<string, string>} [overrides] */
function secrets(overrides = {}) {
  return {
    BACKUP_MONGO_URI: "mongodb+srv://backup:p%40ss@cluster0.example.net/classicade",
    BACKUP_AGE_RECIPIENTS: `# owner laptop\n${PUBLIC_KEY}\n`,
    BACKUP_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    BACKUP_S3_BUCKET: "classicade-backups",
    BACKUP_S3_ACCESS_KEY_ID: "key-id",
    BACKUP_S3_SECRET_ACCESS_KEY: "key-secret",
    ...overrides,
  };
}

describe("checkBackupConfig", () => {
  it("reports not configured, with every secret name, when no secret is set", () => {
    const result = checkBackupConfig({});

    expect(result).toEqual({ configured: false, missing: BACKUP_SECRETS });
  });

  it("treats blank secrets as not set", () => {
    const blank = Object.fromEntries(BACKUP_SECRETS.map((name) => [name, "  "]));

    expect(checkBackupConfig(blank).configured).toBe(false);
  });

  it("fails when only some secrets are set, naming the missing ones", () => {
    const { BACKUP_S3_BUCKET: _bucket, ...partial } = secrets();

    expect(() => checkBackupConfig(partial)).toThrow(/Missing secrets: BACKUP_S3_BUCKET/);
  });

  it("is configured when every secret is valid, and masks the password in both encodings", () => {
    const result = checkBackupConfig(secrets());

    expect(result).toEqual({ configured: true, masks: ["p%40ss", "p@ss"] });
  });

  it("masks a password that needs no encoding once", () => {
    const result = checkBackupConfig(secrets({ BACKUP_MONGO_URI: "mongodb://backup:plain@host:27017/app" }));

    expect(result).toEqual({ configured: true, masks: ["plain"] });
  });

  it("accepts an ssh public key as a recipient", () => {
    const keys = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample owner@laptop\n${PUBLIC_KEY}`;

    expect(checkBackupConfig(secrets({ BACKUP_AGE_RECIPIENTS: keys })).configured).toBe(true);
  });

  it.each([
    ["a connection string that is not MongoDB", { BACKUP_MONGO_URI: "postgres://u:p@h/db" }, /mongodb:\/\//],
    ["a connection string without a password", { BACKUP_MONGO_URI: "mongodb+srv://backup@h/db" }, /password/],
    ["a connection string without credentials", { BACKUP_MONGO_URI: "mongodb://h/db" }, /password/],
    ["a badly encoded password", { BACKUP_MONGO_URI: "mongodb://u:%E0%A4%A@h/db" }, /URL encoded/],
    ["a private key as recipient", { BACKUP_AGE_RECIPIENTS: "AGE-SECRET-KEY-1ABC" }, /private key/],
    ["a recipient that is not a key", { BACKUP_AGE_RECIPIENTS: "owner@example.com" }, /public keys/],
    ["recipients that are only comments", { BACKUP_AGE_RECIPIENTS: "# nobody" }, /public keys/],
    ["an endpoint without https", { BACKUP_S3_ENDPOINT: "http://minio.local:9000" }, /https/],
    ["a bucket given as a URL", { BACKUP_S3_BUCKET: "s3://classicade-backups" }, /bucket name/],
  ])("rejects %s", (_, overrides, message) => {
    expect(() => checkBackupConfig(secrets(overrides))).toThrow(OpsError);
    expect(() => checkBackupConfig(secrets(overrides))).toThrow(message);
  });
});

describe("recipientLines", () => {
  it("keeps keys and drops blank lines and comments", () => {
    expect(recipientLines(`\n# a comment\r\n  ${PUBLIC_KEY}  \n\n`)).toEqual([PUBLIC_KEY]);
  });
});
