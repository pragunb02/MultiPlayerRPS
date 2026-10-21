import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_MESSAGES } from "@classicade/shared";
import { createAccountAccessor } from "../../data/accountAccessor.js";
import { createLegacyUserAccessor } from "../../data/legacyUserAccessor.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { createInMemoryLegacyUserDao } from "../../testing/inMemoryLegacyUserDao.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/errors.js";
import { createLegacyPasswordChecker } from "../../utils/legacyPassword.js";
import { createPasswordHasher } from "../../utils/passwordHasher.js";
import { ACCEPT_EVERY_PASSWORD, refusingPasswords } from "../../testing/fakePasswordScreen.js";
import { EASY_PASSWORD } from "./passwordScreen.js";
import { createAccountDeletionAccessor } from "../../data/accountDeletionAccessor.js";
import { createInMemoryAccountDeletionDao } from "../../testing/inMemoryAccountDeletionDao.js";
import { parseUsername } from "../../models/credentials.js";
import { createAccountComponent } from "./accountComponent.js";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const LEGACY_PASSWORDS = createLegacyPasswordChecker({ dummyCost: 4 });
const EMAIL_UNAVAILABLE = ACCOUNT_MESSAGES.EMAIL_UNAVAILABLE;
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

const noDeletions = () =>
  createAccountDeletionAccessor({ accountDeletionDao: createInMemoryAccountDeletionDao() });
const legacyAccessor = (legacyUsers = []) =>
  createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao(legacyUsers) });

function setup({ params = FAST, legacyUsers = [], passwordScreen = ACCEPT_EVERY_PASSWORD } = {}) {
  const accountDao = createInMemoryAccountDao();
  const passwordHasher = createPasswordHasher({ params });
  const accountAccessor = createAccountAccessor({ accountDao });
  const legacyUserAccessor = legacyAccessor(legacyUsers);
  const accounts = createAccountComponent({
    accountAccessor,
    legacyUserAccessor,
    passwordHasher,
    legacyPasswords: LEGACY_PASSWORDS,
    passwordScreen,
    accountDeletionAccessor: noDeletions(),
  });
  return { accounts, accountDao, accountAccessor, legacyUserAccessor, passwordHasher };
}

describe("accountComponent", () => {
  describe("signup", () => {
    it("creates a user identity named after the account", async () => {
      const { accounts } = setup();

      const signedUp = await accounts.signup({ ...RIYA, now: NOW });

      expect(signedUp).toEqual({
        identity: { kind: "user", id: expect.stringMatching(/^user_[0-9a-f]{24}$/), displayName: "Riya" },
        sessionVersion: 0,
      });
      expect(Object.isFrozen(signedUp)).toBe(true);
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
      [{ ...RIYA, username: "Admin_1" }, "username"],
      [{ ...RIYA, username: "sh1t_head" }, "username"],
    ])("validates every field (%#)", async (input, field) => {
      const { accounts } = setup();

      await expect(accounts.signup({ ...input, now: NOW })).rejects.toMatchObject({
        constructor: ValidationError,
        details: { field },
      });
    });

    it("refuses a password attackers already know at the password field, and creates no account (CC-261)", async () => {
      const screen = refusingPasswords(["qwertyuiop"]);
      const { accounts, accountDao } = setup({ passwordScreen: screen });

      await expect(accounts.signup({ ...RIYA, password: "qwertyuiop", now: NOW })).rejects.toMatchObject({
        constructor: ValidationError,
        message: EASY_PASSWORD,
        details: { field: "password" },
      });
      expect(screen.asked).toEqual(["qwertyuiop"]);
      await expect(accountDao.getByEmail("riya@example.com")).rejects.toThrow(RangeError);
    });

    it("checks the password only after every field is valid (CC-261)", async () => {
      const screen = refusingPasswords([]);
      const { accounts } = setup({ passwordScreen: screen });

      await expect(accounts.signup({ ...RIYA, email: "nope", now: NOW })).rejects.toThrow(ValidationError);
      expect(screen.asked).toEqual([]);
    });

    it.each([
      [{ ...RIYA, email: "other@example.com", username: "RIYA" }, "username", "That username is taken"],
      [{ ...RIYA, username: "Other" }, "email", EMAIL_UNAVAILABLE],
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

    it("answers with the account's current session version (CC-116)", async () => {
      const { accounts } = setup();
      const { identity } = await accounts.signup({ ...RIYA, now: NOW });
      await accounts.signOutOtherDevices({ playerId: identity.id });

      expect((await accounts.login({ email: RIYA.email, password: RIYA.password })).sessionVersion).toBe(1);
    });

    it("does the same hashing work for an unknown email as for a real one (no timing leak)", async () => {
      const { accountDao, passwordHasher } = setup();
      const dummy = vi.fn((password) => passwordHasher.verifyAgainstDummy(password));
      const accounts = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao }),
        legacyUserAccessor: legacyAccessor(),
        passwordHasher: { ...passwordHasher, verifyAgainstDummy: dummy },
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
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
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
      });

      await current.login({ email: RIYA.email, password: RIYA.password });

      expect((await weak.accountDao.getByEmail("riya@example.com")).passwordHash).toMatch(/^scrypt\$1024\$/);
    });

    it("upgrades a hash with a weaker p, as the old production hashes have (CC-260)", async () => {
      const old = setup({ params: { N: 2 ** 10, r: 8, p: 1 } });
      await old.accounts.signup({ ...RIYA, now: NOW });
      const current = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao: old.accountDao }),
        legacyUserAccessor: legacyAccessor(),
        passwordHasher: createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 3 } }),
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
      });

      await current.login({ email: RIYA.email, password: RIYA.password });

      expect((await old.accountDao.getByEmail("riya@example.com")).passwordHash).toMatch(
        /^scrypt\$1024\$8\$3\$/,
      );
      expect((await current.login({ email: RIYA.email, password: RIYA.password })).identity.displayName).toBe(
        "Riya",
      );
    });

    it("still signs in when saving the upgraded hash fails, and passes the failure up for the logs (CC-260)", async () => {
      const weak = setup({ params: { N: 2 ** 9, r: 8, p: 1 } });
      await weak.accounts.signup({ ...RIYA, now: NOW });
      const before = (await weak.accountDao.getByEmail("riya@example.com")).passwordHash;
      const failure = new Error("database unavailable");
      const accessor = createAccountAccessor({ accountDao: weak.accountDao });
      const current = createAccountComponent({
        accountAccessor: { ...accessor, updatePasswordHash: async () => Promise.reject(failure) },
        legacyUserAccessor: legacyAccessor(),
        passwordHasher: createPasswordHasher({ params: FAST }),
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
      });

      const signedIn = await current.login({ email: RIYA.email, password: RIYA.password });

      expect(signedIn.identity.displayName).toBe("Riya");
      expect(signedIn.rehashFailure).toBe(failure);
      expect((await weak.accountDao.getByEmail("riya@example.com")).passwordHash).toBe(before);
    });

    it("does not check the password against the known passwords at login (CC-261)", async () => {
      const screen = refusingPasswords([RIYA.password]);
      const { accounts, accountDao } = setup();
      await accounts.signup({ ...RIYA, now: NOW });
      const later = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao }),
        legacyUserAccessor: legacyAccessor(),
        passwordHasher: createPasswordHasher({ params: FAST }),
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: screen,
        accountDeletionAccessor: noDeletions(),
      });

      const signedIn = await later.login({ email: RIYA.email, password: RIYA.password });

      expect(signedIn.identity.displayName).toBe("Riya");
      expect(signedIn).not.toHaveProperty("rehashFailure");
      expect(screen.asked).toEqual([]);
    });
  });

  // The time a login takes must not say whether the email has an account, a legacy row, or nothing (CC-245).
  describe("login does the same work for every email", () => {
    const TWINS = [
      { ...LEGACY_SAM, email: "twin@example.com" },
      { ...LEGACY_SAM, username: "twin two", email: "Twin@Example.com" },
      { ...LEGACY_SAM, username: "twin three", email: "TWIN@example.com" },
    ];
    const ALONE_MS = 250;

    /**
     * Counts the slow steps (scrypt, hash or verify, and bcrypt) and which stores were read. Every slow step also
     * waits until a step of the other kind has started, and fails after a moment alone. So code that runs bcrypt and
     * then scrypt one after the other fails, and only code that runs them at the same time passes.
     */
    function counted({
      legacyUsers = [
        LEGACY_SAM,
        { ...LEGACY_SAM, email: "corrupt@example.com", password: "x" },
        ...TWINS,
        { ...LEGACY_SAM, username: "wide sam", email: "ｗide.sam@example.com" },
      ],
    } = {}) {
      let legacyFails = false;
      const accountDao = createInMemoryAccountDao();
      const hasher = createPasswordHasher({ params: FAST });
      const work = { scrypt: 0, bcrypt: 0, accountReads: 0, legacyReads: 0 };
      const accountAccessor = createAccountAccessor({ accountDao });
      const legacyUserAccessor = legacyAccessor(legacyUsers);
      let together = Promise.withResolvers();
      let watching = false;
      const startedBoth = () => work.scrypt > 0 && work.bcrypt > 0;
      const slow =
        (kind, run) =>
        async (...args) => {
          if (!watching) return run(...args);
          work[kind] += 1;
          if (startedBoth()) together.resolve();
          await Promise.race([
            together.promise,
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error(`${kind} ran alone, one after the other`)), ALONE_MS);
            }),
          ]);
          return run(...args);
        };
      const accounts = createAccountComponent({
        accountAccessor: {
          ...accountAccessor,
          findByEmail: (email) => {
            work.accountReads += 1;
            return accountAccessor.findByEmail(email);
          },
        },
        legacyUserAccessor: {
          findByEmail: async (email) => {
            work.legacyReads += 1;
            if (legacyFails) throw new Error("legacy store unavailable");
            return legacyUserAccessor.findByEmail(email);
          },
        },
        passwordHasher: {
          ...hasher,
          hash: slow("scrypt", (...args) => hasher.hash(...args)),
          verify: slow("scrypt", (...args) => hasher.verify(...args)),
          verifyAgainstDummy: slow("scrypt", (...args) => hasher.verifyAgainstDummy(...args)),
        },
        legacyPasswords: {
          verify: slow("bcrypt", (...args) => LEGACY_PASSWORDS.verify(...args)),
          verifyAgainstDummy: slow("bcrypt", (...args) => LEGACY_PASSWORDS.verifyAgainstDummy(...args)),
        },
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
      });
      const reset = () => {
        Object.assign(work, { scrypt: 0, bcrypt: 0, accountReads: 0, legacyReads: 0 });
        together = Promise.withResolvers();
        watching = true;
      };
      /** Makes the legacy store fail from now on, once the account exists. */
      const breakLegacy = () => {
        legacyFails = true;
      };
      return { accounts, work, reset, breakLegacy, accountDao, accountAccessor, legacyUserAccessor, hasher };
    }

    const ONE_OF_EACH = { scrypt: 1, bcrypt: 1, accountReads: 1, legacyReads: 1 };
    const OLD_SPELLING = "ｗide@example.com";
    const signedUpRiya = async (options) => {
      const ctx = counted(options);
      await ctx.accounts.signup({ ...RIYA, now: NOW });
      // An account made before the one email spelling, stored under the old one (CC-245).
      await ctx.accountDao.insert({
        username: "Wide",
        email: OLD_SPELLING,
        passwordHash: await ctx.hasher.hash(RIYA.password),
        createdAt: new Date(NOW),
      });
      await ctx.accountAccessor.loadEmailAliases();
      await ctx.legacyUserAccessor.loadEmailAliases();
      ctx.reset();
      return ctx;
    };

    it.each([
      ["an account's email, wrong password", RIYA.email, "wrong password!"],
      ["an account's email, right password", RIYA.email, RIYA.password],
      ["an unknown email", "nobody@example.com", "wrong password!"],
      ["a legacy email, wrong password", LEGACY_SAM.email, "wrong password!"],
      ["a legacy email, right password", LEGACY_SAM.email, LEGACY_PASSWORD],
      ["a legacy row with a corrupt hash", "corrupt@example.com", "wrong password!"],
      ["one of three legacy rows that differ only in case", "twin@example.com", "wrong password!"],
      ["an email typed in capitals no legacy row has", "tWIN@example.com", "wrong password!"],
      [
        "an account under an older spelling, typed the old way, wrong password",
        OLD_SPELLING,
        "wrong password!",
      ],
      ["an account under an older spelling, typed the old way, right password", OLD_SPELLING, RIYA.password],
      ["an account under an older spelling, typed the new way", "wide@example.com", "wrong password!"],
      ["a legacy row under a spelling a query cannot match", "wide.sam@example.com", "wrong password!"],
    ])(
      "reads both stores and runs one scrypt and one bcrypt at the same time for %s",
      async (_, email, password) => {
        const { accounts, work } = await signedUpRiya();

        const answer = await accounts.login({ email, password, now: NOW }).catch((err) => err);

        // Either signed in, or the one failure. Anything else (such as a step that ran alone) fails the test.
        expect(answer instanceof UnauthorizedError || answer.identity !== undefined).toBe(true);
        expect(work).toEqual(ONE_OF_EACH);
      },
    );

    it("gives every failure the same answer", async () => {
      const { accounts } = await signedUpRiya();

      const answers = [];
      for (const email of [
        RIYA.email,
        "nobody@example.com",
        LEGACY_SAM.email,
        "corrupt@example.com",
        "twin@example.com",
      ]) {
        answers.push(
          await accounts.login({ email, password: "wrong password!", now: NOW }).catch((err) => err),
        );
      }

      for (const answer of answers) {
        expect(answer).toBeInstanceOf(UnauthorizedError);
        expect({ message: answer.message, details: answer.details }).toEqual({
          message: "Invalid email or password",
          details: {},
        });
      }
    });

    // The legacy store is only needed for an email without an account (CC-245).
    it("lets an account log in while the legacy store fails, after the same work", async () => {
      const { accounts, work, breakLegacy } = await signedUpRiya();
      breakLegacy();

      const signedIn = await accounts.login({ email: RIYA.email, password: RIYA.password, now: NOW });

      expect(signedIn.identity.displayName).toBe("Riya");
      expect(signedIn.legacyFailure).toEqual(new Error("legacy store unavailable"));
      expect(work).toEqual(ONE_OF_EACH);
    });

    it("answers any other email the usual failure while the legacy store fails, keeping the cause for the logs", async () => {
      const { accounts, work, breakLegacy } = await signedUpRiya();
      breakLegacy();

      const wrong = await accounts
        .login({ email: RIYA.email, password: "wrong password!", now: NOW })
        .catch((err) => err);
      const unknown = await accounts
        .login({ email: LEGACY_SAM.email, password: LEGACY_PASSWORD, now: NOW })
        .catch((err) => err);

      for (const answer of [wrong, unknown]) {
        expect(answer).toBeInstanceOf(UnauthorizedError);
        expect({ message: answer.message, details: answer.details }).toEqual({
          message: "Invalid email or password",
          details: {},
        });
      }
      expect(unknown.cause).toEqual(new Error("legacy store unavailable"));
      expect(wrong.cause).toEqual(new Error("legacy store unavailable"));
      expect(work.scrypt).toBe(2);
      expect(work.bcrypt).toBe(2);
    });
  });

  // Accounts and legacy rows stored before the one email spelling are found, and accounts heal at login (CC-245).
  describe("emails stored under an older spelling", () => {
    const OLD = "ｗide@example.com";
    const NEW = "wide@example.com";

    async function withStored({ accounts: stored = [], legacyUsers = [] } = {}) {
      const ctx = setup({ legacyUsers });
      const made = [];
      for (const { email, username, password } of stored) {
        made.push(
          await ctx.accountDao.insert({
            username,
            email,
            passwordHash: await ctx.passwordHasher.hash(password),
            createdAt: new Date(NOW),
          }),
        );
      }
      await ctx.accountAccessor.loadEmailAliases();
      await ctx.legacyUserAccessor.loadEmailAliases();
      return { ...ctx, made };
    }

    it.each([OLD, NEW, " ＷIDE@example.com "])(
      "logs in to an account stored under the old spelling, typed as %j, and rewrites its email",
      async (typed) => {
        const { accounts, accountDao, made } = await withStored({
          accounts: [{ email: OLD, username: "Wide", password: RIYA.password }],
        });

        const signedIn = await accounts.login({ email: typed, password: RIYA.password, now: NOW });

        expect(signedIn).toMatchObject({ identity: { displayName: "Wide" }, emailUpdate: "rewritten" });
        expect((await accountDao.getById(made[0].accountId)).email).toBe(NEW);
        const again = await accounts.login({ email: NEW, password: RIYA.password, now: NOW });
        expect(again.emailUpdate).toBeUndefined();
      },
    );

    it("leaves the email as it is when another account already has the one spelling", async () => {
      const { accounts, accountDao, made } = await withStored({
        accounts: [
          { email: OLD, username: "Wide", password: RIYA.password },
          { email: NEW, username: "Other", password: "another password 1" },
        ],
      });

      const old = await accounts.login({ email: OLD, password: RIYA.password, now: NOW });
      const current = await accounts.login({ email: NEW, password: "another password 1", now: NOW });

      expect(old).toMatchObject({ identity: { displayName: "Wide" }, emailUpdate: "collision" });
      expect(current.identity.displayName).toBe("Other");
      expect((await accountDao.getById(made[0].accountId)).email).toBe(OLD);
    });

    it.each([OLD, NEW])(
      "refuses a sign-up with %j while an account has it under the old spelling",
      async (email) => {
        const { accounts } = await withStored({
          accounts: [{ email: OLD, username: "Wide", password: RIYA.password }],
        });

        await expect(
          accounts.signup({ username: "Thief", email, password: RIYA.password, now: NOW }),
        ).rejects.toMatchObject({
          constructor: ConflictError,
          message: EMAIL_UNAVAILABLE,
          details: { field: "email" },
        });
      },
    );

    it.each([OLD, NEW])(
      "refuses a sign-up with %j while a legacy row has it under the old spelling",
      async (email) => {
        const { accounts } = await withStored({
          legacyUsers: [{ ...LEGACY_SAM, email: " ｗIDE@Example.com" }],
        });

        await expect(
          accounts.signup({ username: "Thief", email, password: RIYA.password, now: NOW }),
        ).rejects.toMatchObject({
          constructor: ConflictError,
          message: EMAIL_UNAVAILABLE,
          details: { field: "email" },
        });
      },
    );

    it("lets the legacy player behind a row under the old spelling log in", async () => {
      const { accounts } = await withStored({
        legacyUsers: [{ ...LEGACY_SAM, email: " ｗIDE@Example.com" }],
      });

      const signedIn = await accounts.login({ email: NEW, password: LEGACY_PASSWORD, now: NOW });

      expect(signedIn.identity.displayName).toBe("Sam_Lee");
    });

    it("lets an account with an invisible character, made before sign-up refused them, still log in", async () => {
      const { accounts } = await withStored({
        accounts: [{ email: "riya​@example.com", username: "Hidden", password: RIYA.password }],
      });

      const signedIn = await accounts.login({
        email: "riya​@example.com",
        password: RIYA.password,
        now: NOW,
      });

      expect(signedIn.identity.displayName).toBe("Hidden");
    });
  });

  describe("emails that look the same are the same person (CC-245)", () => {
    const COMPOSED = "josé@example.com";
    const DECOMPOSED = "josé@example.com";

    it("logs in with an accent typed either way", async () => {
      const { accounts } = setup();
      const signedUp = await accounts.signup({ ...RIYA, email: COMPOSED, now: NOW });

      expect(await accounts.login({ email: DECOMPOSED, password: RIYA.password, now: NOW })).toEqual(
        signedUp,
      );
    });

    it.each([
      ["an account's email typed in another Unicode form", { accountEmail: COMPOSED, email: DECOMPOSED }],
      [
        "an account's email in full-width letters",
        { accountEmail: "riya@example.com", email: "Ｒiya@example.com" },
      ],
      ["a legacy email in another case", { email: "SAM@EXAMPLE.COM" }],
      [
        "a legacy email stored with spaces around it",
        { legacyEmail: " Sam@Example.com  ", email: "sam@example.com" },
      ],
      ["one of two legacy rows that differ only in case", { twin: true, email: "sam@example.com" }],
    ])(
      "refuses %s at sign-up with the one message",
      async (_, { accountEmail, legacyEmail, twin, email }) => {
        const legacyUsers = [
          { ...LEGACY_SAM, ...(legacyEmail !== undefined && { email: legacyEmail }) },
          ...(twin ? [{ ...LEGACY_SAM, username: "sam two", email: "sam@example.com" }] : []),
        ];
        const { accounts } = setup({ legacyUsers });
        if (accountEmail !== undefined) {
          await accounts.signup({ ...RIYA, email: accountEmail, now: NOW });
        }

        const refused = await accounts
          .signup({ username: "Thief", email, password: RIYA.password, now: NOW })
          .catch((err) => err);

        expect(refused).toBeInstanceOf(ConflictError);
        expect({ message: refused.message, details: refused.details }).toEqual({
          message: EMAIL_UNAVAILABLE,
          details: { field: "email" },
        });
      },
    );
  });

  describe("legacy players (CC-078)", () => {
    const samLogin = { email: "sam@example.com", password: LEGACY_PASSWORD, now: NOW };

    it("creates the account at first login, with a valid username and a scrypt hash", async () => {
      const { accounts, accountDao } = setup({ legacyUsers: [LEGACY_SAM] });

      const { identity, sessionVersion } = await accounts.login(samLogin);

      expect(identity).toMatchObject({ kind: "user", displayName: "Sam_Lee" });
      expect(sessionVersion).toBe(0);
      const stored = await accountDao.getByEmail("sam@example.com");
      expect(stored).toMatchObject({ username: "Sam_Lee", passwordHash: expect.stringMatching(/^scrypt\$/) });
    });

    it("gives a legacy player with a reserved name a neutral one", async () => {
      const { accounts } = setup({ legacyUsers: [{ ...LEGACY_SAM, username: "Admin" }] });

      const { identity } = await accounts.login(samLogin);

      expect(identity.displayName).toMatch(/^Player_\d{4}$/);
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

      expect((await accounts.login(samLogin)).identity.displayName).toBe("Sam_Lee_2");
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
        message: EMAIL_UNAVAILABLE,
        details: { field: "email" },
      });
    });

    it("does not mistake a database failure for a taken username", async () => {
      const failing = { ...createAccountAccessor({ accountDao: createInMemoryAccountDao() }) };
      failing.create = async () => {
        throw new Error("database unavailable");
      };
      const accounts = createAccountComponent({
        accountAccessor: failing,
        legacyUserAccessor: legacyAccessor([LEGACY_SAM]),
        passwordHasher: createPasswordHasher({ params: FAST }),
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
      });

      await expect(accounts.login(samLogin)).rejects.toThrow("database unavailable");
    });

    it("gives up with an error when every username candidate is taken", async () => {
      const taken = { ...createAccountAccessor({ accountDao: createInMemoryAccountDao() }) };
      taken.create = async () => {
        throw new ConflictError("That username is taken", { details: { field: "username" } });
      };
      const accounts = createAccountComponent({
        accountAccessor: taken,
        legacyUserAccessor: legacyAccessor([LEGACY_SAM]),
        passwordHasher: createPasswordHasher({ params: FAST }),
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
      });

      await expect(accounts.login(samLogin)).rejects.toThrow(/No free username/);
    });

    it("logs in once the account exists through the account, not the legacy row", async () => {
      const { accounts } = setup({ legacyUsers: [LEGACY_SAM] });
      const first = await accounts.login(samLogin);

      await expect(accounts.login({ ...samLogin, password: "wrong password!" })).rejects.toThrow(
        UnauthorizedError,
      );
      expect(await accounts.login(samLogin)).toEqual(first);
    });

    // Before CC-003 the old app stored emails as typed, so one address can have several rows (CC-245). Each login
    // checks exactly one of them, so the time taken stays the same: the row written in the capitals the player
    // types, or else the oldest.
    describe("two legacy rows that differ only in case", () => {
      const twin = {
        username: "sam two",
        email: "sam@example.com",
        password: bcrypt.hashSync("second password", 4),
      };
      const legacyUsers = [LEGACY_SAM, twin];

      it("opens the row written in the capitals the player types", async () => {
        const first = setup({ legacyUsers });
        const second = setup({ legacyUsers });

        const sam = await first.accounts.login({
          email: "Sam@Example.com",
          password: LEGACY_PASSWORD,
          now: NOW,
        });
        const samTwo = await second.accounts.login({
          email: "sam@example.com",
          password: "second password",
          now: NOW,
        });

        expect(sam.identity.displayName).toBe("Sam_Lee");
        expect(samTwo.identity.displayName).toBe("sam_two");
      });

      it("checks the oldest row when no row is written the way the player types", async () => {
        const { accounts } = setup({ legacyUsers });

        await expect(
          accounts.login({ email: "SAM@EXAMPLE.COM", password: "second password", now: NOW }),
        ).rejects.toThrow(UnauthorizedError);
        expect(
          (await accounts.login({ email: "SAM@EXAMPLE.COM", password: LEGACY_PASSWORD, now: NOW })).identity
            .displayName,
        ).toBe("Sam_Lee");
      });

      it("never signs one twin into the account the other just made with a different password", async () => {
        const { accounts } = setup({ legacyUsers });

        const results = await Promise.allSettled([
          accounts.login({ email: "Sam@Example.com", password: LEGACY_PASSWORD, now: NOW }),
          accounts.login({ email: "sam@example.com", password: "second password", now: NOW }),
        ]);

        expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
        expect(results.find((result) => result.status === "rejected").reason).toBeInstanceOf(
          UnauthorizedError,
        );
      });

      // A known limit, written down in CC-245: one address, one account.
      it("keeps the address for the twin who logged in first", async () => {
        const { accounts } = setup({ legacyUsers });
        await accounts.login({ email: "Sam@Example.com", password: LEGACY_PASSWORD, now: NOW });

        await expect(
          accounts.login({ email: "sam@example.com", password: "second password", now: NOW }),
        ).rejects.toThrow(UnauthorizedError);
      });
    });

    it("finds a legacy email stored with spaces around it", async () => {
      const { accounts } = setup({ legacyUsers: [{ ...LEGACY_SAM, email: "  Sam@Example.com " }] });

      expect((await accounts.login(samLogin)).identity.displayName).toBe("Sam_Lee");
    });
  });

  describe("signup does not tell a legacy email from an account's (CC-118)", () => {
    it("hashes the password before looking at the email, so both refusals take the same work", async () => {
      const { accountDao, passwordHasher } = setup();
      const hash = vi.fn((password) => passwordHasher.hash(password));
      const accounts = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao }),
        legacyUserAccessor: legacyAccessor([LEGACY_SAM]),
        passwordHasher: { ...passwordHasher, hash },
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
      });
      await accounts.signup({ ...RIYA, now: NOW });
      hash.mockClear();

      const legacy = await accounts
        .signup({ username: "Thief", email: LEGACY_SAM.email, password: RIYA.password, now: NOW })
        .catch((err) => err);
      const account = await accounts
        .signup({ username: "Thief", email: RIYA.email, password: RIYA.password, now: NOW })
        .catch((err) => err);

      expect(hash).toHaveBeenCalledTimes(2);
      for (const refused of [legacy, account]) {
        expect(refused).toBeInstanceOf(ConflictError);
        expect({ message: refused.message, details: refused.details }).toEqual({
          message: EMAIL_UNAVAILABLE,
          details: { field: "email" },
        });
      }
    });
  });

  describe("session versions (CC-116)", () => {
    async function signedUp() {
      const ctx = setup();
      const { identity } = await ctx.accounts.signup({ ...RIYA, now: NOW });
      return { ...ctx, playerId: identity.id };
    }

    it("starts at 0 and counts up each time other devices are signed out", async () => {
      const { accounts, playerId } = await signedUp();

      expect(await accounts.sessionVersionOf({ playerId })).toBe(0);
      expect(await accounts.signOutOtherDevices({ playerId })).toBe(1);
      expect(await accounts.signOutOtherDevices({ playerId })).toBe(2);
      expect(await accounts.sessionVersionOf({ playerId })).toBe(2);
    });

    it("refuses guests, who have no account", async () => {
      const { accounts } = setup();
      const guest = "guest_00000000-0000-4000-8000-000000000001";

      await expect(accounts.sessionVersionOf({ playerId: guest })).rejects.toThrow(ForbiddenError);
      await expect(accounts.signOutOtherDevices({ playerId: guest })).rejects.toThrow(ForbiddenError);
      await expect(
        accounts.changePassword({ playerId: guest, currentPassword: "x", newPassword: "y" }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("answers NotFoundError for an account that is not there any more", async () => {
      const { accounts } = setup();
      const gone = "user_0123456789abcdef01234567";

      await expect(accounts.sessionVersionOf({ playerId: gone })).rejects.toThrow(NotFoundError);
      await expect(accounts.signOutOtherDevices({ playerId: gone })).rejects.toThrow(NotFoundError);
      await expect(
        accounts.changePassword({
          playerId: gone,
          currentPassword: RIYA.password,
          newPassword: "new password 1",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("changePassword (CC-116)", () => {
    const NEW = "a brand new password";

    async function signedUp() {
      const ctx = setup();
      const { identity } = await ctx.accounts.signup({ ...RIYA, now: NOW });
      return { ...ctx, playerId: identity.id };
    }

    it("changes the password and counts the session version up in the same step", async () => {
      const { accounts, playerId } = await signedUp();

      const version = await accounts.changePassword({
        playerId,
        currentPassword: RIYA.password,
        newPassword: NEW,
      });

      expect(version).toBe(1);
      expect(await accounts.sessionVersionOf({ playerId })).toBe(1);
      await expect(accounts.login({ email: RIYA.email, password: RIYA.password })).rejects.toThrow(
        UnauthorizedError,
      );
      expect((await accounts.login({ email: RIYA.email, password: NEW })).identity.id).toBe(playerId);
    });

    it.each([
      ["not the password", "currentPassword", "That is not your current password"],
      [undefined, "currentPassword", "That is not your current password"],
      [42, "currentPassword", "That is not your current password"],
    ])(
      "refuses a wrong current password (%o) and changes nothing",
      async (currentPassword, field, message) => {
        const { accounts, playerId } = await signedUp();

        await expect(
          accounts.changePassword({ playerId, currentPassword, newPassword: NEW }),
        ).rejects.toMatchObject({
          constructor: ValidationError,
          message,
          details: { field },
        });
        expect(await accounts.sessionVersionOf({ playerId })).toBe(0);
      },
    );

    it.each([
      ["short", "Passwords are 8–128 characters"],
      ["          ", "Passwords cannot be only spaces"],
      [undefined, "Passwords are 8–128 characters"],
      [RIYA.password, "Choose a password different from your current one"],
    ])("refuses a new password that breaks the rules (%o)", async (newPassword, message) => {
      const { accounts, playerId } = await signedUp();

      await expect(
        accounts.changePassword({ playerId, currentPassword: RIYA.password, newPassword }),
      ).rejects.toMatchObject({ constructor: ValidationError, message, details: { field: "newPassword" } });
      expect(await accounts.sessionVersionOf({ playerId })).toBe(0);
    });

    it("refuses a new password attackers already know at the new password field, and changes nothing (CC-261)", async () => {
      const screen = refusingPasswords(["password1"]);
      const ctx = setup({ passwordScreen: screen });
      const { identity } = await ctx.accounts.signup({ ...RIYA, now: NOW });
      screen.asked.length = 0;

      await expect(
        ctx.accounts.changePassword({
          playerId: identity.id,
          currentPassword: RIYA.password,
          newPassword: "password1",
        }),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        message: EASY_PASSWORD,
        details: { field: "newPassword" },
      });
      expect(screen.asked).toEqual(["password1"]);
      expect(await ctx.accounts.sessionVersionOf({ playerId: identity.id })).toBe(0);
      expect((await ctx.accounts.login({ email: RIYA.email, password: RIYA.password })).identity.id).toBe(
        identity.id,
      );
    });

    it("checks the new password only once the current one is right (CC-261)", async () => {
      const screen = refusingPasswords([]);
      const ctx = setup({ passwordScreen: screen });
      const { identity } = await ctx.accounts.signup({ ...RIYA, now: NOW });
      screen.asked.length = 0;

      await expect(
        ctx.accounts.changePassword({
          playerId: identity.id,
          currentPassword: "not it at all",
          newPassword: NEW,
        }),
      ).rejects.toMatchObject({ details: { field: "currentPassword" } });
      expect(screen.asked).toEqual([]);
    });

    it("stores only a scrypt hash of the new password", async () => {
      const { accounts, accountDao, playerId } = await signedUp();

      await accounts.changePassword({ playerId, currentPassword: RIYA.password, newPassword: NEW });

      const stored = await accountDao.getByEmail("riya@example.com");
      expect(stored.passwordHash).toMatch(/^scrypt\$/);
      expect(JSON.stringify(stored)).not.toContain(NEW);
    });
  });
  describe("resetName (CC-044, ADR-071.6)", () => {
    it("renames an account to Player_ and six letters that pass the name filter, and signs it out everywhere", async () => {
      const { accounts } = setup();
      const { identity } = await accounts.signup({ ...RIYA, now: NOW });

      const name = await accounts.resetName({ playerId: identity.id, now: NOW });

      expect(name).toMatch(/^Player_[A-HJ-NP-Z2-9]{6}$/);
      expect(parseUsername(name)).toBe(name);
      expect((await accounts.profileOf({ playerId: identity.id, now: NOW })).username).toBe(name);
      expect(await accounts.sessionVersionOf({ playerId: identity.id })).toBe(1);
      expect(
        (await accounts.login({ email: RIYA.email, password: RIYA.password })).identity.displayName,
      ).toBe(name);
    });

    it("tries another name when the first is taken", async () => {
      const accountDao = createInMemoryAccountDao();
      const suffixes = ["AAAAAA", "AAAAAA", "BBBBBB"];
      const accounts = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao }),
        legacyUserAccessor: legacyAccessor(),
        passwordHasher: createPasswordHasher({ params: FAST }),
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
        newNameSuffix: () => suffixes.shift(),
      });
      const riya = (await accounts.signup({ ...RIYA, now: NOW })).identity;
      const arjun = (
        await accounts.signup({ ...RIYA, username: "Arjun", email: "arjun@example.com", now: NOW })
      ).identity;

      expect(await accounts.resetName({ playerId: riya.id, now: NOW })).toBe("Player_AAAAAA");
      expect(await accounts.resetName({ playerId: arjun.id, now: NOW })).toBe("Player_BBBBBB");
    });

    it("draws again when the random letters spell a word the name filter refuses (review of #150)", async () => {
      const suffixes = ["FUCKAB", "BBBBBB"];
      const accounts = createAccountComponent({
        accountAccessor: createAccountAccessor({ accountDao: createInMemoryAccountDao() }),
        legacyUserAccessor: legacyAccessor(),
        passwordHasher: createPasswordHasher({ params: FAST }),
        legacyPasswords: LEGACY_PASSWORDS,
        passwordScreen: ACCEPT_EVERY_PASSWORD,
        accountDeletionAccessor: noDeletions(),
        newNameSuffix: () => suffixes.shift(),
      });
      const riya = (await accounts.signup({ ...RIYA, now: NOW })).identity;

      expect(await accounts.resetName({ playerId: riya.id, now: NOW })).toBe("Player_BBBBBB");
    });

    it("refuses a guest, and answers NotFoundError for an account that is gone", async () => {
      const { accounts } = setup();

      await expect(
        accounts.resetName({ playerId: "guest_00000000-0000-4000-8000-000000000001", now: NOW }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        accounts.resetName({ playerId: "user_0123456789abcdef01234567", now: NOW }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
