import { describe, expect, it } from "vitest";
import { captureLogger } from "../../testing/captureLogger.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";

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
