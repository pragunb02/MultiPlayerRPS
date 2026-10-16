import { IDENTITY_KINDS } from "@classicade/shared";
import { parseEmail, parsePassword, parseUsername } from "../../models/credentials.js";
import { createIdentity } from "../../models/identity.js";
import { normaliseLegacyUsername, usernameCandidates } from "../../models/legacyUsername.js";
import { assertDefined } from "../../utils/assert.js";
import { ConflictError, UnauthorizedError } from "../../utils/errors.js";
import { verifyLegacyPassword } from "../../utils/legacyPassword.js";

const INVALID_LOGIN = "Invalid email or password";
const EMAIL_UNAVAILABLE = "That email can't be used";
const USERNAME_ATTEMPTS = 20;

/** @param {Readonly<import("../../data/accountAccessor.js").Account>} account */
const identityOf = (account) =>
  createIdentity({
    kind: IDENTITY_KINDS.USER,
    id: `user_${account.accountId}`,
    displayName: account.username,
  });

/**
 * Accounts: signup and login. Produces the same `Identity` model guests use, so the rest of the system
 * treats users and guests alike. Players of the legacy app keep their email and password: their account is
 * created at their first login (CC-078).
 *
 * @param {{
 *   accountAccessor: ReturnType<typeof import("../../data/accountAccessor.js").createAccountAccessor>,
 *   legacyUserAccessor: ReturnType<typeof import("../../data/legacyUserAccessor.js").createLegacyUserAccessor>,
 *   passwordHasher: ReturnType<typeof import("../../utils/passwordHasher.js").createPasswordHasher>,
 * }} deps
 */
export function createAccountComponent({ accountAccessor, legacyUserAccessor, passwordHasher }) {
  assertDefined(accountAccessor, "accountAccessor");
  assertDefined(legacyUserAccessor, "legacyUserAccessor");
  assertDefined(passwordHasher, "passwordHasher");

  /**
   * Creates the account of a legacy player who just proved their password: same email, the password re-hashed
   * with scrypt, and the first free username valid under today's rules. Legacy XP is not imported (it was
   * client-writable, SEC-01). If a parallel login migrated the same player first, that account is used.
   */
  async function migrateLegacyUser(legacy, { email, password }, now) {
    const passwordHash = await passwordHasher.hash(password);
    for (const username of usernameCandidates(normaliseLegacyUsername(legacy.username), USERNAME_ATTEMPTS)) {
      try {
        return await accountAccessor.create({ username, email, passwordHash, createdAt: now });
      } catch (err) {
        if (!(err instanceof ConflictError)) {
          throw err;
        }
        if (err.details?.field === "email") {
          const [migrated] = await accountAccessor.findByEmail(email);
          return migrated;
        }
      }
    }
    throw new Error(`No free username for a migrated legacy account after ${USERNAME_ATTEMPTS} attempts`);
  }

  /** @returns {Promise<Readonly<import("../../data/accountAccessor.js").Account>>} */
  async function loginLegacyUser(normalised, now) {
    const [legacy] = await legacyUserAccessor.findByEmail(normalised.email);
    if (legacy === undefined) {
      await passwordHasher.verifyAgainstDummy(normalised.password);
      throw new UnauthorizedError(INVALID_LOGIN);
    }
    if (!(await verifyLegacyPassword(normalised.password, legacy.passwordHash))) {
      throw new UnauthorizedError(INVALID_LOGIN);
    }
    return migrateLegacyUser(legacy, normalised, now);
  }

  return Object.freeze({
    /**
     * @param {{ username: unknown, email: unknown, password: unknown, now: number }} input
     * @returns {Promise<Readonly<import("../../models/identity.js").Identity>>}
     */
    async signup({ username, email, password, now }) {
      const credentials = {
        username: parseUsername(username),
        email: parseEmail(email),
        password: parsePassword(password),
      };
      // A legacy player's email stays theirs: they claim it by logging in, nobody can sign up with it.
      if ((await legacyUserAccessor.findByEmail(credentials.email)).length > 0) {
        throw new ConflictError(EMAIL_UNAVAILABLE, { details: { field: "email" } });
      }
      const account = await accountAccessor.create({
        username: credentials.username,
        email: credentials.email,
        passwordHash: await passwordHasher.hash(credentials.password),
        createdAt: now,
      });
      return identityOf(account);
    },

    /**
     * Same answer, and the same work, whether the email is unknown or the password is wrong — login cannot be
     * used to discover who has an account. Upgrades the stored hash when its parameters are outdated.
     *
     * @param {{ email: unknown, password: unknown, now: number }} input
     * @returns {Promise<Readonly<import("../../models/identity.js").Identity>>}
     * @throws {UnauthorizedError}
     */
    async login({ email, password, now }) {
      let normalised;
      try {
        normalised = { email: parseEmail(email), password: parsePassword(password) };
      } catch {
        throw new UnauthorizedError(INVALID_LOGIN);
      }
      const [account] = await accountAccessor.findByEmail(normalised.email);
      if (account === undefined) {
        return identityOf(await loginLegacyUser(normalised, now));
      }
      if (!(await passwordHasher.verify(normalised.password, account.passwordHash))) {
        throw new UnauthorizedError(INVALID_LOGIN);
      }
      if (passwordHasher.needsRehash(account.passwordHash)) {
        await accountAccessor.updatePasswordHash(
          account.accountId,
          await passwordHasher.hash(normalised.password),
        );
      }
      return identityOf(account);
    },
  });
}
