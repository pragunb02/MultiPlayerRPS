import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import {
  AppError,
  ConcurrentChangeError,
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ServerBusyError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from "./errors.js";

describe("application errors", () => {
  it.each([
    [ValidationError, ERROR_CODES.VALIDATION_FAILED],
    [UnauthorizedError, ERROR_CODES.UNAUTHORIZED],
    [ForbiddenError, ERROR_CODES.FORBIDDEN],
    [NotFoundError, ERROR_CODES.NOT_FOUND],
    [ConflictError, ERROR_CODES.CONFLICT],
    [ConcurrentChangeError, ERROR_CODES.CONFLICT],
    [GoneError, ERROR_CODES.GONE],
    [TooManyRequestsError, ERROR_CODES.RATE_LIMITED],
    [ServerBusyError, ERROR_CODES.SERVER_BUSY],
  ])("%o carries code %s and is an AppError", (ErrorType, code) => {
    const err = new ErrorType("something went wrong");

    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(code);
    expect(err.name).toBe(ErrorType.name);
    expect(err.message).toBe("something went wrong");
  });

  it("reports a concurrent change as a conflict to anyone who does not retry", () => {
    expect(new ConcurrentChangeError("changed")).toBeInstanceOf(ConflictError);
  });

  it("cannot be instantiated as the abstract base class", () => {
    expect(() => new AppError("x", { code: "ANY" })).toThrow(TypeError);
  });

  it("keeps the underlying cause for logs", () => {
    const cause = new Error("duplicate key");

    const err = new ConflictError("Username is already taken", { cause });

    expect(err.cause).toBe(cause);
  });

  it("has no cause property when none is given", () => {
    expect(Object.hasOwn(new NotFoundError("Room not found"), "cause")).toBe(false);
  });

  it("freezes details and does not share them with the caller's object", () => {
    const details = { field: "username" };

    const err = new ValidationError("Invalid username", { details });
    details.field = "changed";

    expect(err.details).toEqual({ field: "username" });
    expect(Object.isFrozen(err.details)).toBe(true);
  });

  it("defaults details to an empty object, never undefined", () => {
    expect(new NotFoundError("Room not found").details).toEqual({});
  });

  it("does not let callers override the code", () => {
    expect(new NotFoundError("x", { code: "OTHER" }).code).toBe(ERROR_CODES.NOT_FOUND);
  });
});
