import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { captureLogger } from "../../testing/captureLogger.js";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/errors.js";
import { errorHandler, notFoundHandler, toHttpError } from "./errorMiddleware.js";

describe("toHttpError", () => {
  it.each([
    [new ValidationError("Bad move"), 400, ERROR_CODES.VALIDATION_FAILED],
    [new UnauthorizedError("Log in first"), 401, ERROR_CODES.UNAUTHORIZED],
    [new ForbiddenError("Not your room"), 403, ERROR_CODES.FORBIDDEN],
    [new NotFoundError("Room not found"), 404, ERROR_CODES.NOT_FOUND],
    [new ConflictError("Room is full"), 409, ERROR_CODES.CONFLICT],
  ])("maps %o to %i", (err, status, code) => {
    expect(toHttpError(err)).toEqual({ status, code, message: err.message });
  });

  it("includes details only when there are some", () => {
    const err = new ValidationError("Invalid username", { details: { field: "username" } });

    expect(toHttpError(err).details).toEqual({ field: "username" });
  });

  it("treats an AppError with an unmapped code as an internal error", () => {
    class UnmappedError extends AppError {
      constructor() {
        super("odd", { code: "SOMETHING_NEW" });
      }
    }

    expect(toHttpError(new UnmappedError())).toEqual({
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

    expect(toHttpError(parseError)).toEqual({
      status: 400,
      code: ERROR_CODES.BAD_REQUEST,
      message: "Malformed request body",
    });
    expect(toHttpError(tooLarge)).toEqual({
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
    expect(toHttpError(thrown)).toEqual({
      status: 500,
      code: ERROR_CODES.INTERNAL,
      message: "Internal server error",
    });
  });
});

describe("errorHandler", () => {
  const run = (err) => {
    const capture = captureLogger();
    const req = { id: "req-0001", log: capture.logger };
    const res = {
      locals: {},
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    errorHandler(err, req, res, () => {});
    return { res, ...capture };
  };

  it("responds with status, code, message and request id", () => {
    const { res } = run(new NotFoundError("Room not found"));

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: "Room not found", requestId: "req-0001" },
    });
    expect(res.locals.errorCode).toBe("NOT_FOUND");
  });

  it("does not log expected client errors (the access log records them)", () => {
    const { entries } = run(new ConflictError("Room is full"));

    expect(entries).toEqual([]);
  });

  it("logs server faults with stack and cause, and never sends them to the client", () => {
    const fault = new Error("db down", { cause: new Error("ECONNREFUSED") });

    const { res, find } = run(fault);

    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("db down");
    const [logged] = find("unhandled error");
    expect(logged.level).toBe(50);
    expect(logged.err.stack).toContain("db down");
  });
});

describe("notFoundHandler", () => {
  it("forwards a NotFoundError", () => {
    let forwarded;

    notFoundHandler({}, {}, (err) => {
      forwarded = err;
    });

    expect(forwarded).toBeInstanceOf(NotFoundError);
  });
});
