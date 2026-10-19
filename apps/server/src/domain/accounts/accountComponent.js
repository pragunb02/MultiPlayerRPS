import {
  ACCOUNT_MESSAGES,
  ageGroupFor,
  AGE_GROUPS,
  IDENTITY_KINDS,
  isTooYoungForAccount,
  TOO_YOUNG_MESSAGE,
} from "@classicade/shared";
import { parseBirthYear } from "../../models/birthYear.js";
import {
  parseEmail,
  parseLoginEmail,
  parsePassword,
  parseUsername,
  previousEmailSpelling,
} from "../../models/credentials.js";
import { ACCOUNT_ID_PREFIX, createIdentity, isAccountId } from "../../models/identity.js";
import { normaliseLegacyUsername, usernameCandidates } from "../../models/legacyUsername.js";
import { assertDefined } from "../../utils/assert.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/errors.js";
import { yearOf } from "../../utils/indiaTime.js";

const INVALID_LOGIN = "Invalid email or password";
const { EMAIL_UNAVAILABLE } = ACCOUNT_MESSAGES;
const USERNAME_ATTEMPTS = 20;

/** The account behind a player id. Guests have none, so they have no password to change. */
function accountIdOf(playerId) {
  if (!isAccountId(playerId)) {
    throw new ForbiddenError("Only players with an account have a password");
  }
  return playerId.slice(ACCOUNT_ID_PREFIX.length);
}

/**
 * A stated birth year, checked against the list the sign-up form offers and the minimum age of an account
 * (CC-152). The refusal for a child comes only after the choice, so the form itself never hints at an age.
 */
function statedBirthYear(value, now) {
  const currentYear = yearOf(now);
  const birthYear = parseBirthYear(value, { currentYear });
  if (isTooYoungForAccount({ birthYear, currentYear })) {
    throw new ValidationError(TOO_YOUNG_MESSAGE, { details: { field: "birthYear", reason: "too-young" } });
  }
  return birthYear;
}

/** A field error for the password form, so the page can show it next to the right box. */
const passwordFieldError = (field, message, cause) =>
  new ValidationError(message, { details: { field }, ...(cause !== undefined && { cause }) });

/** @param {Readonly<import("../../data/accountAccessor.js").Account>} account */
const identityOf = (account) =>
  createIdentity({
    kind: IDENTITY_KINDS.USER,
    id: `${ACCOUNT_ID_PREFIX}${account.accountId}`,
    displayName: account.username,
  });

/**
 * What signing up or logging in gives: who the player is now, and the account's session version, which the new
 * session keeps so a later "sign out other devices" or password change can end it (CC-116).
 *
 * When the account's email was stored under an older spelling, the login rewrites it to the one spelling, and
 * `emailUpdate` says how that went (CC-245): "rewritten", or "collision" when another account already has it.
 * `legacyFailure` is a failure of the legacy store that this login did not need, passed up so it is logged.
 *
 * @typedef {{ identity: Readonly<import("../../models/identity.js").Identity>, sessionVersion: number, emailUpdate?: "rewritten" | "collision", legacyFailure?: unknown }} SignIn
 */

/** @param {Readonly<import("../../data/accountAccessor.js").Account>} account @returns {Readonly<SignIn>} */
const signInOf = (account) =>
  Object.freeze({ identity: identityOf(account), sessionVersion: account.sessionVersion });

/**
 * Accounts: signup and login. Produces the same `Identity` model guests use, so the rest of the system
 * treats users and guests alike. Players of the legacy app keep their email and password: their account is
 * created at their first login (CC-078). Changing the password and signing out other devices both count the
 * account's session version up, which ends every other session (CC-116).
 *
 * @param {{
 *   accountAccessor: ReturnType<typeof import("../../data/accountAccessor.js").createAccountAccessor>,
 *   legacyUserAccessor: ReturnType<typeof import("../../data/legacyUserAccessor.js").createLegacyUserAccessor>,
 *   passwordHasher: ReturnType<typeof import("../../utils/passwordHasher.js").createPasswordHasher>,
 *   legacyPasswords: ReturnType<typeof import("../../utils/legacyPassword.js").createLegacyPasswordChecker>,
 *   accountDeletionAccessor: Pick<ReturnType<typeof import("../../data/accountDeletionAccessor.js").createAccountDeletionAccessor>, "closeLegacy" | "isLegacyClosed">,
 *     the legacy rows whose player deleted their account (CC-035)
 * }} deps
 */
export function createAccountComponent({
  accountAccessor,
  legacyUserAccessor,
  passwordHasher,
  legacyPasswords,
  accountDeletionAccessor,
}) {
  assertDefined(accountAccessor, "accountAccessor");
  assertDefined(legacyUserAccessor, "legacyUserAccessor");
  assertDefined(passwordHasher, "passwordHasher");
  assertDefined(legacyPasswords, "legacyPasswords");
  assertDefined(accountDeletionAccessor, "accountDeletionAccessor");

  /**
   * Whether any legacy row of an email still belongs to its legacy player, one whose account was never deleted.
   * Deleting an account closes every row of its email (CC-035).
   */
  async function hasOpenLegacyRow(email) {
    for (const legacy of await legacyUserAccessor.findByEmail(email)) {
      if (!(await accountDeletionAccessor.isLegacyClosed(legacy.legacyId))) return true;
    }
    return false;
  }

  /** @returns {Readonly<{ username: string, createdAt: number, birthYear?: number, ageGroup: string }>} */
  const profile = (account, now) =>
    Object.freeze({
      username: account.username,
      createdAt: account.createdAt,
      ...(account.birthYear !== undefined && { birthYear: account.birthYear }),
      ageGroup: ageGroupFor({ birthYear: account.birthYear, currentYear: yearOf(now) }),
    });

  /**
   * Creates the account of a legacy player who just proved their password: same email, the password hashed again
   * with scrypt (the hash was made while the old password was checked), and the first free username valid under
   * today's rules. Legacy XP is not imported (it was client-writable, SEC-01). If a parallel login migrated the
   * same email first, that account is used, but only when this password is also the account's: the old app could
   * hold two rows with two passwords for one address.
   */
  async function migrateLegacyUser(legacy, { email, password, passwordHash }, now) {
    for (const username of usernameCandidates(normaliseLegacyUsername(legacy.username), USERNAME_ATTEMPTS)) {
      try {
        return await accountAccessor.create({ username, email, passwordHash, createdAt: now });
      } catch (err) {
        if (!(err instanceof ConflictError)) {
          throw err;
        }
        if (err.details?.field === "email") {
          const [migrated] = accountToCheck(await accountAccessor.findByEmail(email), {
            normalised: email,
            typed: email,
          });
          if (!(await passwordHasher.verify(password, migrated.passwordHash))) {
            throw new UnauthorizedError(INVALID_LOGIN, { cause: err });
          }
          return migrated;
        }
      }
    }
    throw new Error(`No free username for a migrated legacy account after ${USERNAME_ATTEMPTS} attempts`);
  }

  /**
   * The one account a login checks. Almost always there is one. An account made before the one email spelling may
   * be stored under an older spelling, and another account may have the new one. Then the account stored exactly
   * as the player types it (trimmed and lower-cased, the old way) is checked, else the one in the one spelling.
   * Exactly one is checked, so the time taken stays the same (CC-245).
   *
   * @param {ReadonlyArray<Readonly<import("../../data/accountAccessor.js").Account>>} accounts
   * @param {{ normalised: string, typed: string }} email
   */
  function accountToCheck(accounts, { normalised, typed }) {
    const previous = previousEmailSpelling(typed);
    const typedTheOldWay = accounts.filter(
      (account) => account.email === previous && previous !== normalised,
    );
    const current = accounts.filter((account) => account.email === normalised);
    return [...typedTheOldWay, ...current, ...accounts].slice(0, 1);
  }

  /**
   * The one legacy row a login checks. The old app could hold several rows for one address that differ only in
   * case. Checking each would cost one bcrypt per row, and the extra time would tell those addresses apart. So
   * exactly one is checked: the row written in the same capitals as the player types it, or else the oldest.
   *
   * @param {ReadonlyArray<Readonly<import("../../data/legacyUserAccessor.js").LegacyUser>>} legacyUsers  oldest first
   * @param {string} typed  the email as typed, with spaces and Unicode forms folded but capitals kept
   */
  function rowToCheck(legacyUsers, typed) {
    const exact = legacyUsers.filter((legacy) => legacy.email.normalize("NFKC").trim() === typed);
    return [...exact, ...legacyUsers].slice(0, 1);
  }

  /**
   * The email has no account yet. Every path here runs one bcrypt and one scrypt at the same time, the same as
   * for an account's email, so the time taken says nothing about who played here. When there is a row, the scrypt
   * is the hash the new account will keep, which costs the same as checking one.
   *
   * @returns {Promise<Readonly<import("../../data/accountAccessor.js").Account>>}
   */
  async function loginLegacyUser(normalised, legacy, typed, now) {
    const [row] = rowToCheck(legacy.users, typed);
    if (row === undefined) {
      await Promise.all([
        passwordHasher.verifyAgainstDummy(normalised.password),
        legacyPasswords.verifyAgainstDummy(normalised.password),
      ]);
      throw new UnauthorizedError(INVALID_LOGIN, legacy.failure);
    }
    const [opened, passwordHash] = await Promise.all([
      legacyPasswords.verify(normalised.password, row.passwordHash),
      passwordHasher.hash(normalised.password),
    ]);
    if (!opened) {
      throw new UnauthorizedError(INVALID_LOGIN);
    }
    // Its player deleted the account made from it (CC-035). The same answer as a wrong password, after the same work.
    if (await accountDeletionAccessor.isLegacyClosed(row.legacyId)) {
      throw new UnauthorizedError(INVALID_LOGIN);
    }
    return migrateLegacyUser(row, { ...normalised, passwordHash }, now);
  }

  /**
   * The legacy rows for an email. The legacy store is needed only for an email without an account, so when it
   * fails, an account's login goes on, and any other login answers the usual failure after the usual work. The
   * failure travels as the cause, which the login route logs (CC-245).
   *
   * @returns {Promise<{ users: ReadonlyArray<Readonly<import("../../data/legacyUserAccessor.js").LegacyUser>>, failure?: { cause: unknown } }>}
   */
  async function legacyRowsOf(email) {
    try {
      return { users: await legacyUserAccessor.findByEmail(email) };
    } catch (err) {
      return { users: [], failure: { cause: err } };
    }
  }

  return Object.freeze({
    /**
     * Signing up with an email that already has an account, here or in the legacy app, in any spelling, answers the
     * one `EMAIL_UNAVAILABLE` message after the same work (the password is hashed first in every case), so the cases
     * cannot be told apart. The message points the owner to logging in (CC-238). That the email is taken still
     * shows, because the player has to be told why it failed. Hiding that too needs the confirmation email of
     * CC-033 (see CC-118).
     *
     * A birth year is optional. Without one the account's age is unknown and it gets the under 18 defaults
     * (ADR-028). A player under 13 for the whole year cannot have an account (CC-152).
     *
     * @param {{ username: unknown, email: unknown, password: unknown, birthYear?: unknown, now: number }} input
     *   leave `birthYear` out when the player did not say
     * @returns {Promise<Readonly<SignIn>>}
     */
    async signup({ username, email, password, birthYear, now }) {
      const credentials = {
        username: parseUsername(username),
        email: parseEmail(email),
        password: parsePassword(password),
        ...(birthYear !== undefined && { birthYear: statedBirthYear(birthYear, now) }),
      };
      const passwordHash = await passwordHasher.hash(credentials.password);
      // A legacy player's email stays theirs: they claim it by logging in, nobody can sign up with it. Once its
      // player deleted their account, the email is free for a new, empty account (CC-035).
      if (await hasOpenLegacyRow(credentials.email)) {
        throw new ConflictError(EMAIL_UNAVAILABLE, { details: { field: "email" } });
      }
      const account = await accountAccessor.create({
        username: credentials.username,
        email: credentials.email,
        passwordHash,
        createdAt: now,
        ...(credentials.birthYear !== undefined && { birthYear: credentials.birthYear }),
      });
      return signInOf(account);
    },

    /**
     * Same answer, and the same work, whether the email is unknown, belongs to an account or to a player of the old
     * app, or the password is wrong. Every login reads both stores and runs one scrypt and one bcrypt, so neither
     * the answer nor the time it takes shows who has an account (CC-245). Upgrades the stored hash when its
     * parameters are outdated.
     *
     * @param {{ email: unknown, password: unknown, now: number }} input
     * @returns {Promise<Readonly<SignIn>>}
     * @throws {UnauthorizedError}
     */
    async login({ email, password, now }) {
      let normalised;
      try {
        normalised = { email: parseLoginEmail(email), password: parsePassword(password) };
      } catch {
        throw new UnauthorizedError(INVALID_LOGIN);
      }
      const [accounts, legacy] = await Promise.all([
        accountAccessor.findByEmail(normalised.email),
        legacyRowsOf(normalised.email),
      ]);
      const [account] = accountToCheck(accounts, { normalised: normalised.email, typed: String(email) });
      if (account === undefined) {
        const typed = String(email).normalize("NFKC").trim();
        return signInOf(await loginLegacyUser(normalised, legacy, typed, now));
      }
      const [matches] = await Promise.all([
        passwordHasher.verify(normalised.password, account.passwordHash),
        legacyPasswords.verifyAgainstDummy(normalised.password),
      ]);
      if (!matches) {
        throw new UnauthorizedError(INVALID_LOGIN, legacy.failure);
      }
      // The account did not need the legacy store, but a failure of it is still passed up for the logs.
      const signedIn = Object.freeze({
        ...signInOf(account),
        ...(legacy.failure !== undefined && { legacyFailure: legacy.failure.cause }),
      });
      if (passwordHasher.needsRehash(account.passwordHash)) {
        await accountAccessor.updatePasswordHash(
          account.accountId,
          await passwordHasher.hash(normalised.password),
        );
      }
      if (account.email !== normalised.email) {
        const outcome = await accountAccessor.healEmail({
          accountId: account.accountId,
          from: account.email,
          to: normalised.email,
        });
        return Object.freeze({ ...signedIn, ...(outcome !== "unchanged" && { emailUpdate: outcome }) });
      }
      return signedIn;
    },

    /**
     * The account's current session version. A session made at another version was signed out (CC-116).
     *
     * @param {{ playerId: string }} input  an account's player id
     * @returns {Promise<number>}
     * @throws {NotFoundError} when the account is not there any more
     * @throws {ForbiddenError} for a guest
     */
    sessionVersionOf: async ({ playerId }) => accountAccessor.getSessionVersion(accountIdOf(playerId)),

    /**
     * Changes the password of a signed-in player who knows the current one, and signs out every other session.
     * The new hash and the new session version are written together, so no session made before can outlive the
     * old password.
     *
     * @param {{ playerId: string, currentPassword: unknown, newPassword: unknown }} input
     * @returns {Promise<number>} the new session version, for the session that asked to keep
     * @throws {ValidationError} with `details.field` "currentPassword" or "newPassword"
     * @throws {ForbiddenError} for a guest
     * @throws {NotFoundError} when the account is not there any more
     */
    async changePassword({ playerId, currentPassword, newPassword }) {
      const accountId = accountIdOf(playerId);
      let next;
      try {
        next = parsePassword(newPassword);
      } catch (err) {
        throw passwordFieldError("newPassword", err.message, err);
      }
      const account = await accountAccessor.getById(accountId);
      const current = typeof currentPassword === "string" ? currentPassword : "";
      if (!(await passwordHasher.verify(current, account.passwordHash))) {
        throw passwordFieldError("currentPassword", "That is not your current password");
      }
      if (next === current) {
        throw passwordFieldError("newPassword", "Choose a password different from your current one");
      }
      return accountAccessor.bumpSessionVersion({ accountId, passwordHash: await passwordHasher.hash(next) });
    },

    /**
     * Signs out every session of the account. The session that asked keeps going by taking the new version.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<number>} the new session version
     * @throws {ForbiddenError} for a guest
     * @throws {NotFoundError} when the account is not there any more
     */
    signOutOtherDevices: async ({ playerId }) =>
      accountAccessor.bumpSessionVersion({ accountId: accountIdOf(playerId) }),

    /**
     * What the player's own settings show: the username, when the account was made, the birth year if stated, and
     * the age group it gives (CC-152).
     *
     * @param {{ playerId: string, now: number }} query
     * @throws {ForbiddenError} for a guest
     * @throws {NotFoundError} when the account is not there any more
     */
    profileOf: async ({ playerId, now }) =>
      profile(await accountAccessor.getById(accountIdOf(playerId)), now),

    /**
     * Sets the birth year of an account that has none. Once set it stays: a free change would let a minor unlock
     * the adult defaults with one click, so a mistake is corrected by the owner on request (CC-152).
     *
     * @param {{ playerId: string, birthYear: unknown, now: number }} input
     * @throws {ValidationError} with `details.field` "birthYear"
     * @throws {ConflictError} when the year is set already
     * @throws {ForbiddenError} for a guest
     * @throws {NotFoundError} when the account is not there any more
     */
    async setBirthYear({ playerId, birthYear, now }) {
      const accountId = accountIdOf(playerId);
      const year = statedBirthYear(birthYear, now);
      const { set } = await accountAccessor.setBirthYear({ accountId, birthYear: year });
      if (!set) {
        throw new ConflictError("Your year of birth is already set", { details: { field: "birthYear" } });
      }
      return profile(await accountAccessor.getById(accountId), now);
    },

    /**
     * Which of these players are adults: accounts whose birth year makes them surely 18. Guests, computer
     * characters and accounts without a year are not (ADR-028).
     *
     * @param {{ playerIds: ReadonlyArray<string>, now: number }} query
     * @returns {Promise<ReadonlySet<string>>}
     */
    async adultsAmong({ playerIds, now }) {
      const accountIds = playerIds.filter(isAccountId).map((id) => id.slice(ACCOUNT_ID_PREFIX.length));
      if (accountIds.length === 0) {
        return new Set();
      }
      const currentYear = yearOf(now);
      const years = await accountAccessor.listBirthYears(accountIds);
      return new Set(
        years
          .filter(({ birthYear }) => ageGroupFor({ birthYear, currentYear }) === AGE_GROUPS.ADULT)
          .map(({ accountId }) => `${ACCOUNT_ID_PREFIX}${accountId}`),
      );
    },

    /**
     * Checks the password of a signed-in player again before something that cannot be undone or that shows their
     * email (CC-035). Answers what the account itself holds.
     *
     * @param {{ playerId: string, password: unknown }} input
     * @returns {Promise<Readonly<{ username: string, email: string, createdAt: number, birthYear?: number }>>}
     * @throws {ValidationError} with `details.field` "password"
     * @throws {ForbiddenError} for a guest
     * @throws {NotFoundError} when the account is not there any more
     */
    async confirmPassword({ playerId, password }) {
      const account = await accountAccessor.getById(accountIdOf(playerId));
      const given = typeof password === "string" ? password : "";
      if (!(await passwordHasher.verify(given, account.passwordHash))) {
        throw passwordFieldError("password", "That is not your password");
      }
      return Object.freeze({
        username: account.username,
        email: account.email,
        createdAt: account.createdAt,
        ...(account.birthYear !== undefined && { birthYear: account.birthYear }),
      });
    },

    /**
     * Deletes the account itself (CC-035). Every legacy row of its email is closed first, so an old password
     * cannot make the account again. Every session of the account stops working at its next request, because its
     * account is gone. Running it again changes nothing.
     *
     * @param {{ playerId: string, now: number }} input
     * @returns {Promise<{ closed: boolean }>} false when the account was gone already
     */
    async close({ playerId, now }) {
      const accountId = accountIdOf(playerId);
      let account;
      try {
        account = await accountAccessor.getById(accountId);
      } catch (err) {
        if (err instanceof NotFoundError) return { closed: false };
        throw err;
      }
      for (const legacy of await legacyUserAccessor.findByEmail(account.email)) {
        await accountDeletionAccessor.closeLegacy({ legacyId: legacy.legacyId, at: now });
      }
      const { deleted } = await accountAccessor.delete(accountId);
      return { closed: deleted };
    },
  });
}
