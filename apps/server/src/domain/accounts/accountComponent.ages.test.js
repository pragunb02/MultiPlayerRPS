import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { createAccountAccessor } from "../../data/accountAccessor.js";
import { createAccountDeletionAccessor } from "../../data/accountDeletionAccessor.js";
import { createLegacyUserAccessor } from "../../data/legacyUserAccessor.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { createInMemoryAccountDeletionDao } from "../../testing/inMemoryAccountDeletionDao.js";
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
import { ACCEPT_EVERY_PASSWORD } from "../../testing/fakePasswordScreen.js";
import { createAccountComponent } from "./accountComponent.js";

// 2026-10-16 in India.
const NOW = Date.UTC(2026, 9, 16);
const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };
const LEGACY_PASSWORD = "old password 1";
const LEGACY_SAM = {
  username: "Sam",
  email: "sam@example.com",
  password: bcrypt.hashSync(LEGACY_PASSWORD, 4),
};

function setup({ legacyUsers = [] } = {}) {
  const accountDao = createInMemoryAccountDao();
  const deletions = createAccountDeletionAccessor({ accountDeletionDao: createInMemoryAccountDeletionDao() });
  const accounts = createAccountComponent({
    accountAccessor: createAccountAccessor({ accountDao }),
    legacyUserAccessor: createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao(legacyUsers) }),
    passwordHasher: createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }),
    legacyPasswords: createLegacyPasswordChecker({ dummyCost: 4 }),
    passwordScreen: ACCEPT_EVERY_PASSWORD,
    accountDeletionAccessor: deletions,
  });
  return { accounts, accountDao, deletions };
}

describe("accountComponent birth year (CC-152)", () => {
  it("stores a stated birth year as the year only", async () => {
    const { accounts, accountDao } = setup();

    const { identity } = await accounts.signup({ ...RIYA, birthYear: 2001, now: NOW });

    const stored = await accountDao.getByEmail("riya@example.com");
    expect(stored.birthYear).toBe(2001);
    expect(await accounts.profileOf({ playerId: identity.id, now: NOW })).toEqual({
      username: "Riya",
      createdAt: NOW,
      birthYear: 2001,
      ageGroup: "adult",
    });
  });

  it("stores nothing when no year was given, and calls the age unknown", async () => {
    const { accounts, accountDao } = setup();

    const { identity } = await accounts.signup({ ...RIYA, now: NOW });

    expect(await accountDao.getByEmail("riya@example.com")).not.toHaveProperty("birthYear");
    expect(await accounts.profileOf({ playerId: identity.id, now: NOW })).toEqual({
      username: "Riya",
      createdAt: NOW,
      ageGroup: "unknown",
    });
  });

  it("refuses a sign-up from a player under 13, at the year field", async () => {
    const { accounts, accountDao } = setup();

    await expect(accounts.signup({ ...RIYA, birthYear: 2014, now: NOW })).rejects.toMatchObject({
      constructor: ValidationError,
      message: "ClassiCade accounts are for people aged 13 and over. You can keep playing as a guest.",
      details: { field: "birthYear", reason: "too-young" },
    });
    await expect(accountDao.getByEmail("riya@example.com")).rejects.toThrow(RangeError);
  });

  it.each([["2001"], [2001.5], [2027], [1924], [null]])("refuses %s as a birth year", async (birthYear) => {
    const { accounts } = setup();

    await expect(accounts.signup({ ...RIYA, birthYear, now: NOW })).rejects.toMatchObject({
      constructor: ValidationError,
      details: { field: "birthYear" },
    });
  });

  it("lets an account without a year set it once, and never change it", async () => {
    const { accounts } = setup();
    const { identity } = await accounts.signup({ ...RIYA, now: NOW });

    const profile = await accounts.setBirthYear({ playerId: identity.id, birthYear: 2010, now: NOW });

    expect(profile).toEqual(expect.objectContaining({ birthYear: 2010, ageGroup: "minor" }));
    await expect(
      accounts.setBirthYear({ playerId: identity.id, birthYear: 1990, now: NOW }),
    ).rejects.toMatchObject({ constructor: ConflictError, details: { field: "birthYear" } });
  });

  it("refuses to set a year under 13 or out of the list", async () => {
    const { accounts } = setup();
    const { identity } = await accounts.signup({ ...RIYA, now: NOW });

    await expect(
      accounts.setBirthYear({ playerId: identity.id, birthYear: 2020, now: NOW }),
    ).rejects.toMatchObject({ details: { field: "birthYear", reason: "too-young" } });
    await expect(accounts.setBirthYear({ playerId: identity.id, birthYear: "x", now: NOW })).rejects.toThrow(
      ValidationError,
    );
    expect((await accounts.profileOf({ playerId: identity.id, now: NOW })).ageGroup).toBe("unknown");
  });

  it("answers guests with ForbiddenError and a deleted account with NotFoundError", async () => {
    const { accounts } = setup();
    const guest = "guest_00000000-0000-4000-8000-000000000001";

    await expect(accounts.profileOf({ playerId: guest, now: NOW })).rejects.toThrow(ForbiddenError);
    await expect(accounts.profileOf({ playerId: "user_0123456789abcdef01234567", now: NOW })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("gives the age group of each account among players, and none for anyone who is not one", async () => {
    const { accounts } = setup();
    const adult = await accounts.signup({ ...RIYA, birthYear: 2007, now: NOW });
    const turning18 = await accounts.signup({
      ...RIYA,
      username: "Arjun",
      email: "arjun@example.com",
      birthYear: 2008,
      now: NOW,
    });
    const unknown = await accounts.signup({
      ...RIYA,
      username: "Meera",
      email: "meera@example.com",
      now: NOW,
    });

    const groups = await accounts.ageGroupsOf({
      playerIds: [adult.identity.id, turning18.identity.id, unknown.identity.id, "guest_x", "bot_rocky_easy"],
      now: NOW,
    });

    expect(Object.fromEntries(groups)).toEqual({
      [adult.identity.id]: "adult",
      [turning18.identity.id]: "minor",
      [unknown.identity.id]: "unknown",
    });
    expect([...(await accounts.ageGroupsOf({ playerIds: ["guest_x"], now: NOW }))]).toEqual([]);
  });
});

describe("accountComponent birth year corrections by the owner (CC-152, ADR-048.9)", () => {
  const groupOf = async (accounts, playerId) =>
    (await accounts.ageGroupsOf({ playerIds: [playerId], now: NOW })).get(playerId);

  it("replaces a set year by the account's email, records when, and the group follows at once", async () => {
    const { accounts, accountDao } = setup();
    const { identity } = await accounts.signup({ ...RIYA, birthYear: 1990, now: NOW });

    const corrected = await accounts.correctBirthYear({
      email: " Riya@Example.com ",
      birthYear: 2010,
      now: NOW + 1,
    });

    expect(corrected).toEqual({
      playerId: identity.id,
      username: "Riya",
      birthYear: 2010,
      ageGroup: "minor",
    });
    const stored = await accountDao.getById(identity.id.slice("user_".length));
    expect(stored.birthYear).toBe(2010);
    expect(stored.birthYearCorrectedAt).toEqual(new Date(NOW + 1));
    expect(await groupOf(accounts, identity.id)).toBe("minor");
  });

  it("clears a year with null, so the account is of unknown age again and can set it once more", async () => {
    const { accounts } = setup();
    const { identity } = await accounts.signup({ ...RIYA, birthYear: 1990, now: NOW });

    const cleared = await accounts.correctBirthYear({ email: RIYA.email, birthYear: null, now: NOW });

    expect(cleared).toEqual({ playerId: identity.id, username: "Riya", ageGroup: "unknown" });
    expect(await groupOf(accounts, identity.id)).toBe("unknown");
    await accounts.setBirthYear({ playerId: identity.id, birthYear: 1991, now: NOW });
    expect(await groupOf(accounts, identity.id)).toBe("adult");
  });

  it("refuses an under 13 year (that account is deleted instead) and anything but a picker year or null", async () => {
    const { accounts } = setup();
    const { identity } = await accounts.signup({ ...RIYA, birthYear: 1990, now: NOW });

    await expect(
      accounts.correctBirthYear({ email: RIYA.email, birthYear: 2020, now: NOW }),
    ).rejects.toMatchObject({ details: { field: "birthYear", reason: "too-young" } });
    await expect(
      accounts.correctBirthYear({ email: RIYA.email, birthYear: "1990", now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(accounts.correctBirthYear({ email: RIYA.email, now: NOW })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await groupOf(accounts, identity.id)).toBe("adult");
  });

  it("answers not found for an email with no account, a legacy player's included, and refuses a bad email", async () => {
    const { accounts } = setup({ legacyUsers: [LEGACY_SAM] });

    await expect(
      accounts.correctBirthYear({ email: LEGACY_SAM.email, birthYear: 1990, now: NOW }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      accounts.correctBirthYear({ email: "not an email", birthYear: 1990, now: NOW }),
    ).rejects.toMatchObject({ details: { field: "email" } });
  });

  it("changes nothing when two accounts hold the email under older spellings, so the owner picks by hand", async () => {
    const accountAccessor = createAccountAccessor({ accountDao: createInMemoryAccountDao() });
    const corrections = [];
    const accounts = createAccountComponent({
      accountAccessor: {
        ...accountAccessor,
        findByEmail: async () => [{ accountId: "a" }, { accountId: "b" }],
        correctBirthYear: async (change) => corrections.push(change),
      },
      legacyUserAccessor: createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao([]) }),
      passwordHasher: createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }),
      legacyPasswords: createLegacyPasswordChecker({ dummyCost: 4 }),
      passwordScreen: ACCEPT_EVERY_PASSWORD,
      accountDeletionAccessor: createAccountDeletionAccessor({
        accountDeletionDao: createInMemoryAccountDeletionDao(),
      }),
    });

    await expect(
      accounts.correctBirthYear({ email: RIYA.email, birthYear: 1990, now: NOW }),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { field: "email" } });
    expect(corrections).toEqual([]);
  });
});

describe("accountComponent usernames (CC-052)", () => {
  it("answers the username of each account that exists, and nothing for anyone else", async () => {
    const { accounts } = setup();
    const riya = await accounts.signup({ ...RIYA, now: NOW });
    const arjun = await accounts.signup({
      username: "Arjun",
      email: "arjun@example.com",
      password: RIYA.password,
      now: NOW,
    });

    const names = await accounts.usernamesOf({
      playerIds: [
        riya.identity.id,
        arjun.identity.id,
        "user_0123456789abcdef01234567",
        "guest_x",
        "bot_rocky_easy",
      ],
    });

    expect(names).toEqual(
      new Map([
        [riya.identity.id, "Riya"],
        [arjun.identity.id, "Arjun"],
      ]),
    );
    expect(await accounts.usernamesOf({ playerIds: ["guest_x"] })).toEqual(new Map());
  });
});

describe("accountComponent password checks and closing (CC-035)", () => {
  it("confirms the password and answers what the account holds", async () => {
    const { accounts } = setup();
    const { identity } = await accounts.signup({ ...RIYA, birthYear: 2001, now: NOW });

    expect(await accounts.confirmPassword({ playerId: identity.id, password: RIYA.password })).toEqual({
      username: "Riya",
      email: "riya@example.com",
      createdAt: NOW,
      birthYear: 2001,
    });
  });

  it.each([["wrong password"], [undefined], [42]])("refuses %s at the password field", async (password) => {
    const { accounts } = setup();
    const { identity } = await accounts.signup({ ...RIYA, now: NOW });

    await expect(accounts.confirmPassword({ playerId: identity.id, password })).rejects.toMatchObject({
      constructor: ValidationError,
      message: "That is not your password",
      details: { field: "password" },
    });
  });

  it("refuses a guest, who has no password", async () => {
    const { accounts } = setup();

    await expect(
      accounts.confirmPassword({ playerId: "guest_00000000-0000-4000-8000-000000000001", password: "x" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("closes an account: it is gone, and closing again changes nothing", async () => {
    const { accounts } = setup();
    const { identity } = await accounts.signup({ ...RIYA, now: NOW });

    expect(await accounts.close({ playerId: identity.id, now: NOW })).toEqual({ closed: true });
    expect(await accounts.close({ playerId: identity.id, now: NOW })).toEqual({ closed: false });

    await expect(accounts.sessionVersionOf({ playerId: identity.id })).rejects.toThrow(NotFoundError);
    await expect(accounts.login({ email: RIYA.email, password: RIYA.password, now: NOW })).rejects.toThrow(
      UnauthorizedError,
    );
    const again = await accounts.signup({ ...RIYA, now: NOW });
    expect(again.identity.id).not.toBe(identity.id);
  });

  it("closes the legacy row of a migrated legacy player, so the old password cannot bring the account back", async () => {
    const { accounts, deletions } = setup({ legacyUsers: [LEGACY_SAM] });
    const { identity } = await accounts.login({
      email: "sam@example.com",
      password: LEGACY_PASSWORD,
      now: NOW,
    });

    await accounts.close({ playerId: identity.id, now: NOW });

    expect(await deletions.isLegacyClosed("legacy-0")).toBe(true);
    await expect(
      accounts.login({ email: "sam@example.com", password: LEGACY_PASSWORD, now: NOW }),
    ).rejects.toMatchObject({ constructor: UnauthorizedError, message: "Invalid email or password" });
  });

  it("closes every legacy row of the email, also a second one in other capitals", async () => {
    const twin = { ...LEGACY_SAM, username: "Sam2", email: "SAM@example.com" };
    const { accounts, deletions } = setup({ legacyUsers: [LEGACY_SAM, twin] });
    const { identity } = await accounts.login({
      email: "sam@example.com",
      password: LEGACY_PASSWORD,
      now: NOW,
    });

    await accounts.close({ playerId: identity.id, now: NOW });

    expect(await deletions.isLegacyClosed("legacy-0")).toBe(true);
    expect(await deletions.isLegacyClosed("legacy-1")).toBe(true);
    await expect(
      accounts.login({ email: "SAM@example.com", password: LEGACY_PASSWORD, now: NOW }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("lets the email of a closed legacy row sign up afresh, with an empty account", async () => {
    const { accounts } = setup({ legacyUsers: [LEGACY_SAM] });
    const { identity } = await accounts.login({
      email: "sam@example.com",
      password: LEGACY_PASSWORD,
      now: NOW,
    });
    await accounts.close({ playerId: identity.id, now: NOW });

    const fresh = await accounts.signup({
      username: "SamAgain",
      email: "sam@example.com",
      password: "a new one!",
      now: NOW,
    });

    expect(fresh.identity.displayName).toBe("SamAgain");
    expect(fresh.identity.id).not.toBe(identity.id);
    const loggedIn = await accounts.login({ email: "sam@example.com", password: "a new one!", now: NOW });
    expect(loggedIn.identity.id).toBe(fresh.identity.id);
  });

  it("still keeps an open legacy email from being signed up", async () => {
    const { accounts } = setup({ legacyUsers: [LEGACY_SAM] });

    await expect(
      accounts.signup({ username: "Other", email: "sam@example.com", password: "a new one!", now: NOW }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("accountComponent.close and storage failures (CC-035)", () => {
  it("passes a storage failure through instead of calling the account gone", async () => {
    const failure = new Error("database down");
    const accounts = createAccountComponent({
      accountAccessor: { getById: async () => Promise.reject(failure) },
      legacyUserAccessor: { findByEmail: async () => [] },
      passwordHasher: createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }),
      legacyPasswords: createLegacyPasswordChecker({ dummyCost: 4 }),
      passwordScreen: ACCEPT_EVERY_PASSWORD,
      accountDeletionAccessor: { closeLegacy: async () => {}, isLegacyClosed: async () => false },
    });

    await expect(accounts.close({ playerId: "user_0123456789abcdef01234567", now: NOW })).rejects.toBe(
      failure,
    );
  });
});
