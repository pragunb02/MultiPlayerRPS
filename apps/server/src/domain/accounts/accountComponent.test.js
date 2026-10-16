import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import { createAccountAccessor } from "../../data/accountAccessor.js";
import { createLegacyUserAccessor } from "../../data/legacyUserAccessor.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { createInMemoryLegacyUserDao } from "../../testing/inMemoryLegacyUserDao.js";
import { ConflictError, UnauthorizedError, ValidationError } from "../../utils/errors.js";
import { createPasswordHasher } from "../../utils/passwordHasher.js";
import { createAccountComponent } from "./accountComponent.js";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const NOW = Date.UTC(2026, 9, 16);
const RIYA = { username: "Riya", email: "Riya@Example.com", password: "correct horse battery" };
// Shaped like a document of the legacy app's `users` collection (bcrypt, cost 4 to keep tests fast).
const LEGACY_PASSWORD = "old password 1";
const LEGACY_SAM = {
  username: "Sam Lee!",
  email: "Sam@Example.com",
  password: bcrypt.hashSync(LEGACY_PASSWORD, 4),
  level: 7,
};

const legacyAccessor = (legacyUsers = []) =>
  createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao(legacyUsers) });

function setup({ params = FAST, legacyUsers = [] } = {}) {
  const accountDao = createInMemoryAccountDao();
  const passwordHasher = createPasswordHasher({ params });
  const accounts = createAccountComponent({
    accountAccessor: createAccountAccessor({ accountDao }),
    legacyUserAccessor: legacyAccessor(legacyUsers),
    passwordHasher,
  });
  return { accounts, accountDao, passwordHasher };
}

describe("accountComponent", () => {
  describe("signup", () => {
    it("creates a user identity named after the account", async () => {
      const { accounts } = setup();

      const identity = await accounts.signup({ ...RIYA, now: NOW });

      expect(identity).toEqual({
        kind: "user",
        id: expect.stringMatching(/^user_[0-9a-f]{24}$/),
        displayName: "Riya",
      });
    });

    it("stores a scrypt hash, never the password", async () => {
      const { accounts, accountDao } = setup();

      await accounts.signup({ ...RIYA, now: NOW });

      const stored = await accountDao.getByEmail("riya@example.com");
      expect(stored.passwordHash).toMatch(/^scrypt\$/);
      expect(JSON.stringify(stored)).not.toContain(RIYA.password);
    });

    it.each([
      [{ ...RIYA, username: "a" }, "username"],
      [{ ...RIYA, email: "nope" }, "email"],
      [{ ...RIYA, password: "short" }, "password"],
    ])("validates every field (%#)", async (input, field) => {
      const { accounts } = setup();

      await expect(accounts.signup({ ...input, now: NOW })).rejects.toMatchObject({
        constructor: ValidationError,
        details: { field },
      });
    });

    it.each([
      [{ ...RIYA, email: "other@example.com", username: "RIYA" }, "username", "That username is taken"],
      [{ ...RIYA, username: "Other" }, "email", "That email can't be used"],
    ])("refuses duplicates (%#)", async (input, field, message) => {
      const { accounts } = setup();
      await accounts.signup({ ...RIYA, now: NOW });

      await expect(accounts.signup({ ...input, now: NOW })).rejects.toMatchObject({
        constructor: ConflictError,
        message,
        details: { field },
      });
    });
  });

  describe("login", () => {
    it("returns the same identity as signup, with the email in any case", async () => {
      const { accounts } = setup();
      const signedUp = await accounts.signup({ ...RIYA, now: NOW });

      expect(await accounts.login({ email: "  RIYA@example.COM", password: RIYA.password })).toEqual(
        signedUp,
      );
    });

    it.each([
      [{ email: "riya@example.com", password: "wrong password!" }],
      [{ email: "nobody@example.com", password: "correct horse battery" }],
      [{ email: "not an email", password: "x" }],
      [{ email: undefined, password: undefined }],
    ])("gives one generic answer for every failure (%#)", async (input) => {
      const { accounts } = setup();
      await accounts.signup({ ...RIYA, now: NOW });

      await expect(accounts.login(input)).rejects.toMatchObject({
        constructor: UnauthorizedError,
        message: "Invalid email or password",
      });
    });

    it("does the same hashing work for an unknown email as for a real one (no timing leak)", async () => {
      const { accountDao, passwordHasher } = setup();
      const dummy = vi.fn((password) => passwordHasher.verifyAgainstDummy(password));
      const accounts = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao }),
        legacyUserAccessor: legacyAccessor(),
        passwordHasher: { ...passwordHasher, verifyAgainstDummy: dummy },
      });

      await expect(accounts.login({ email: "nobody@example.com", password: "whatever123" })).rejects.toThrow(
        UnauthorizedError,
      );

      expect(dummy).toHaveBeenCalledOnce();
    });

    it("upgrades a hash made with weaker parameters at the next successful login", async () => {
      const weak = setup({ params: { N: 2 ** 9, r: 8, p: 1 } });
      await weak.accounts.signup({ ...RIYA, now: NOW });
      const current = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao: weak.accountDao }),
        legacyUserAccessor: legacyAccessor(),
        passwordHasher: createPasswordHasher({ params: FAST }),
      });

      await current.login({ email: RIYA.email, password: RIYA.password });

      expect((await weak.accountDao.getByEmail("riya@example.com")).passwordHash).toMatch(/^scrypt\$1024\$/);
    });
  });

  describe("legacy players (CC-078)", () => {
    const samLogin = { email: "sam@example.com", password: LEGACY_PASSWORD, now: NOW };

    it("creates the account at first login, with a valid username and a scrypt hash", async () => {
      const { accounts, accountDao } = setup({ legacyUsers: [LEGACY_SAM] });

      const identity = await accounts.login(samLogin);

      expect(identity).toMatchObject({ kind: "user", displayName: "Sam_Lee" });
      const stored = await accountDao.getByEmail("sam@example.com");
      expect(stored).toMatchObject({ username: "Sam_Lee", passwordHash: expect.stringMatching(/^scrypt\$/) });
    });

    it("logs in to the same account afterwards, through the new hash", async () => {
      const { accounts } = setup({ legacyUsers: [LEGACY_SAM] });
      const first = await accounts.login(samLogin);

      expect(await accounts.login({ ...samLogin, now: NOW + 1000 })).toEqual(first);
    });

    it("picks the next free username when the cleaned name is taken", async () => {
      const { accounts } = setup({ legacyUsers: [LEGACY_SAM] });
      await accounts.signup({
        username: "sam_lee",
        email: "other@example.com",
        password: RIYA.password,
        now: NOW,
      });

      expect((await accounts.login(samLogin)).displayName).toBe("Sam_Lee_2");
    });

    it("refuses a wrong legacy password with the generic answer, and creates nothing", async () => {
      const { accounts, accountDao } = setup({ legacyUsers: [LEGACY_SAM] });

      await expect(accounts.login({ ...samLogin, password: "wrong password!" })).rejects.toMatchObject({
        constructor: UnauthorizedError,
        message: "Invalid email or password",
      });
      await expect(accountDao.getByEmail("sam@example.com")).rejects.toThrow(RangeError);
    });

    it("uses the account a parallel login just created instead of failing", async () => {
      const { accounts } = setup({ legacyUsers: [LEGACY_SAM] });

      const [one, two] = await Promise.all([accounts.login(samLogin), accounts.login(samLogin)]);

      expect(one).toEqual(two);
    });

    it("keeps a legacy player's email theirs: signup with it is refused", async () => {
      const { accounts } = setup({ legacyUsers: [LEGACY_SAM] });

      await expect(
        accounts.signup({ username: "Thief", email: "SAM@example.com", password: RIYA.password, now: NOW }),
      ).rejects.toMatchObject({
        constructor: ConflictError,
        message: "That email can't be used",
        details: { field: "email" },
      });
    });

    it("never looks at legacy data for an email that already has an account", async () => {
      const findByEmail = vi.fn(async () => []);
      const accounts = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao: createInMemoryAccountDao() }),
        legacyUserAccessor: { findByEmail },
        passwordHasher: createPasswordHasher({ params: FAST }),
      });
      await accounts.signup({ ...RIYA, now: NOW });
      findByEmail.mockClear();

      await accounts.login({ email: RIYA.email, password: RIYA.password, now: NOW });

      expect(findByEmail).not.toHaveBeenCalled();
    });
  });
});
