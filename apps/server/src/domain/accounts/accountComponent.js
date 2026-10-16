import { IDENTITY_KINDS } from "@classicade/shared";
import { parseEmail, parsePassword, parseUsername } from "../../models/credentials.js";
import { createIdentity } from "../../models/identity.js";
import { assertDefined } from "../../utils/assert.js";
import { UnauthorizedError } from "../../utils/errors.js";

const INVALID_LOGIN = "Invalid email or password";

/** @param {Readonly<import("../../data/accountAccessor.js").Account>} account */
const identityOf = (account) =>
  createIdentity({
    kind: IDENTITY_KINDS.USER,
    id: `user_${account.accountId}`,
    displayName: account.username,
  });

/**
 * Accounts: signup and login. Produces the same `Identity` model guests use, so the rest of the system
 * treats users and guests alike.
 *
 * @param {{
 *   accountAccessor: ReturnType<typeof import("../../data/accountAccessor.js").createAccountAccessor>,
 *   passwordHasher: ReturnType<typeof import("../../utils/passwordHasher.js").createPasswordHasher>,
 * }} deps
 */
export function createAccountComponent({ accountAccessor, passwordHasher }) {
  assertDefined(accountAccessor, "accountAccessor");
  assertDefined(passwordHasher, "passwordHasher");

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
     * @param {{ email: unknown, password: unknown }} input
     * @returns {Promise<Readonly<import("../../models/identity.js").Identity>>}
     * @throws {UnauthorizedError}
     */
    async login({ email, password }) {
      let normalised;
      try {
        normalised = { email: parseEmail(email), password: parsePassword(password) };
      } catch {
        throw new UnauthorizedError(INVALID_LOGIN);
      }
      const [account] = await accountAccessor.findByEmail(normalised.email);
      if (account === undefined) {
        await passwordHasher.verifyAgainstDummy(normalised.password);
        throw new UnauthorizedError(INVALID_LOGIN);
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
