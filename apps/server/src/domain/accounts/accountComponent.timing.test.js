import { describe, expect, it, vi } from "vitest";
import { ACCEPT_EVERY_PASSWORD } from "../../testing/fakePasswordScreen.js";

// Records the parameters of every scrypt run, and runs the real one.
const runs = vi.hoisted(() => []);
vi.mock("node:crypto", async (importOriginal) => {
  const crypto = await importOriginal();
  return {
    ...crypto,
    scrypt: (password, salt, keyLength, options, done) => {
      runs.push({ N: options.N, r: options.r, p: options.p });
      return crypto.scrypt(password, salt, keyLength, options, done);
    },
  };
});

const { createAccountAccessor } = await import("../../data/accountAccessor.js");
const { createAccountDeletionAccessor } = await import("../../data/accountDeletionAccessor.js");
const { createLegacyUserAccessor } = await import("../../data/legacyUserAccessor.js");
const { createInMemoryAccountDao } = await import("../../testing/inMemoryAccountDao.js");
const { createInMemoryAccountDeletionDao } = await import("../../testing/inMemoryAccountDeletionDao.js");
const { createInMemoryLegacyUserDao } = await import("../../testing/inMemoryLegacyUserDao.js");
const { createLegacyPasswordChecker } = await import("../../utils/legacyPassword.js");
const { createPasswordHasher, DEFAULT_SCRYPT_PARAMS } = await import("../../utils/passwordHasher.js");
const { UnauthorizedError } = await import("../../utils/errors.js");
const { createAccountComponent } = await import("./accountComponent.js");

const OLD_PARAMS = Object.freeze({ N: 2 ** 15, r: 8, p: 1 });
const RIYA = { email: "riya@example.com", password: "correct horse battery" };

/** An account whose hash was made before CC-260, and the production account component. */
async function oldAccount() {
  const accountDao = createInMemoryAccountDao();
  await accountDao.insert({
    username: "Riya",
    email: RIYA.email,
    passwordHash: await createPasswordHasher({ params: OLD_PARAMS }).hash(RIYA.password),
    createdAt: new Date(),
  });
  const accounts = createAccountComponent({
    accountAccessor: createAccountAccessor({ accountDao }),
    legacyUserAccessor: createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao([]) }),
    passwordHasher: createPasswordHasher(),
    legacyPasswords: createLegacyPasswordChecker({ dummyCost: 4 }),
    passwordScreen: ACCEPT_EVERY_PASSWORD,
    accountDeletionAccessor: createAccountDeletionAccessor({
      accountDeletionDao: createInMemoryAccountDeletionDao(),
    }),
  });
  // The dummy hash is made when the component is, so it is not counted below.
  await accounts.login({ email: "nobody@example.com", password: "warm up" }).catch(() => undefined);
  runs.length = 0;
  return accounts;
}

// A wrong password for an account with an old hash must cost what an unknown email costs, a scrypt at the current
// parameters, or the time would show which accounts have not signed in since CC-260 (CC-245).
describe("login work for an account with an old hash (CC-260)", () => {
  it("runs a scrypt with the current parameters on a wrong password, as an unknown email does", async () => {
    const accounts = await oldAccount();

    await expect(accounts.login({ email: RIYA.email, password: "wrong password!" })).rejects.toThrow(
      UnauthorizedError,
    );

    expect(runs).toContainEqual(DEFAULT_SCRYPT_PARAMS);
    expect(runs).toContainEqual(OLD_PARAMS);
  });

  it("makes the upgraded hash once on a right password", async () => {
    const accounts = await oldAccount();

    await accounts.login({ email: RIYA.email, password: RIYA.password });

    expect(runs).toHaveLength(2);
    expect(runs).toEqual(expect.arrayContaining([OLD_PARAMS, DEFAULT_SCRYPT_PARAMS]));
  });
});
