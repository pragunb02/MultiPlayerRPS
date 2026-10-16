import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../utils/errors.js";
import { toClientError } from "./errorTranslation.js";

describe("toClientError", () => {
  it.each([
    [new ValidationError("Bad move"), 400, ERROR_CODES.VALIDATION_FAILED],
    [new UnauthorizedError("Log in first"), 401, ERROR_CODES.UNAUTHORIZED],
    [new ForbiddenError("Not your room"), 403, ERROR_CODES.FORBIDDEN],
    [new NotFoundError("Room not found"), 404, ERROR_CODES.NOT_FOUND],
    [new ConflictError("Room is full"), 409, ERROR_CODES.CONFLICT],
    [new GoneError("This room has closed"), 410, ERROR_CODES.GONE],
  ])("maps %o to %i", (err, status, code) => {
    expect(toClientError(err)).toEqual({ status, code, message: err.message });
  });

  it("includes details only when there are some", () => {
    const err = new ValidationError("Invalid username", { details: { field: "username" } });

    expect(toClientError(err).details).toEqual({ field: "username" });
  });

  it("treats an AppError with an unmapped code as an internal error", () => {
    class UnmappedError extends AppError {
      constructor() {
        super("odd", { code: "SOMETHING_NEW" });
      }
    }

    expect(toClientError(new UnmappedError())).toEqual({
      status: 500,
      code: ERROR_CODES.INTERNAL,
      message: "Internal server error",
    });
  });

  it("maps body-parser client errors to fixed messages", () => {
    const parseError = Object.assign(new Error("Unexpected token"), {
      type: "entity.parse.failed",
      status: 400,
      expose: true,
    });
    const tooLarge = Object.assign(new Error("request entity too large"), {
      type: "entity.too.large",
      status: 413,
      expose: true,
    });

    expect(toClientError(parseError)).toEqual({
      status: 400,
      code: ERROR_CODES.BAD_REQUEST,
      message: "Malformed request body",
    });
    expect(toClientError(tooLarge)).toEqual({
      status: 413,
      code: ERROR_CODES.PAYLOAD_TOO_LARGE,
      message: "Request body is too large",
    });
  });

  it.each([
    new Error("connection string mongodb://user:pass@host"),
    new TypeError("cannot read properties of undefined"),
    "a thrown string",
    undefined,
    Object.assign(new Error("not exposed"), { type: "x", status: 400, expose: false }),
  ])("hides everything else behind a generic 500: %o", (thrown) => {
    expect(toClientError(thrown)).toEqual({
      status: 500,
      code: ERROR_CODES.INTERNAL,
      message: "Internal server error",
    });
  });
});
