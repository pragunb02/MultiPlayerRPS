import { ERROR_CODES } from "@classicade/shared";

/**
 * @typedef {Object} ErrorOptions
 * @property {Record<string, unknown>} [details]  safe, client-facing specifics (e.g. which field failed)
 * @property {unknown} [cause]                    the underlying error, kept for logs only
 */

/**
 * Base class for errors the application throws on purpose. Carries a stable `code` from ERROR_CODES;
 * how a code maps to a transport (HTTP status, socket ack) is decided in the service layer.
 * Abstract: throw one of the subclasses so every error has a known code.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {ErrorOptions & { code: string }} options
   */
  constructor(message, { code, details = {}, cause }) {
    if (new.target === AppError) {
      throw new TypeError("AppError is abstract; throw a specific subclass");
    }
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** Input is well-formed but breaks a rule (field too long, unknown game, illegal move). */
export class ValidationError extends AppError {
  /** @param {string} message @param {ErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, code: ERROR_CODES.VALIDATION_FAILED });
  }
}

/** The caller is not authenticated. */
export class UnauthorizedError extends AppError {
  /** @param {string} message @param {ErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, code: ERROR_CODES.UNAUTHORIZED });
  }
}

/** The caller is authenticated but not allowed to do this. */
export class ForbiddenError extends AppError {
  /** @param {string} message @param {ErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, code: ERROR_CODES.FORBIDDEN });
  }
}

/** The requested thing does not exist (or the caller may not know it exists). */
export class NotFoundError extends AppError {
  /** @param {string} message @param {ErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, code: ERROR_CODES.NOT_FOUND });
  }
}

/** The request conflicts with current state (room full, username taken). */
export class ConflictError extends AppError {
  /** @param {string} message @param {ErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, code: ERROR_CODES.CONFLICT });
  }
}
