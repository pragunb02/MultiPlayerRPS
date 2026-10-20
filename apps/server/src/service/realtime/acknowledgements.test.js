import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { captureLogger } from "../../testing/captureLogger.js";
import { ConflictError } from "../../utils/errors.js";
import { registerHandlers } from "./acknowledgements.js";

function setup(handlers) {
  const socket = new EventEmitter();
  const capture = captureLogger();
  registerHandlers(socket, handlers, capture.logger);
  const emit = (event, ...args) =>
    new Promise((resolve) => {
      socket.emit(event, ...args, resolve);
    });
  return { socket, emit, ...capture };
}

describe("registerHandlers", () => {
  it("acknowledges with the handler's result", async () => {
    const { emit } = setup({ "room:create": (payload) => ({ received: payload }) });

    expect(await emit("room:create", { game: "rps" })).toEqual({
      ok: true,
      data: { received: { game: "rps" } },
    });
  });

  it("passes undefined when the client sends no payload", async () => {
    const handler = vi.fn().mockReturnValue("ok");
    const { emit } = setup({ ping: handler });

    await emit("ping");

    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it("translates application errors into the standard error shape", async () => {
    const { emit, entries } = setup({
      "room:join": async () => {
        throw new ConflictError("Room is full");
      },
    });

    expect(await emit("room:join", {})).toEqual({
      ok: false,
      error: { code: ERROR_CODES.CONFLICT, message: "Room is full" },
    });
    expect(entries).toEqual([]);
  });

  it("hides and logs unexpected failures", async () => {
    const { emit, find } = setup({
      "room:join": () => {
        throw new Error("db password leaked in message");
      },
    });

    const ack = await emit("room:join", {});

    expect(ack).toEqual({
      ok: false,
      error: { code: ERROR_CODES.INTERNAL, message: "Internal server error" },
    });
    expect(find("socket handler failed")[0]).toEqual(
      expect.objectContaining({ event: "room:join", level: 50 }),
    );
  });

  it("ignores and logs events sent without an acknowledgement callback", () => {
    const handler = vi.fn();
    const { socket, find } = setup({ ping: handler });

    socket.emit("ping", { no: "ack" });

    expect(handler).not.toHaveBeenCalled();
    expect(find("socket event without acknowledgement ignored")[0].event).toBe("ping");
  });

  describe("timing for operations telemetry (ADR-055)", () => {
    /** Handlers whose events are timed on a clock that moves 4 ms between the start and the reply. */
    function timed(handlers, { allow } = {}) {
      const socket = new EventEmitter();
      const recorded = [];
      let time = 100;
      registerHandlers(socket, handlers, captureLogger().logger, {
        ...(allow && { allow }),
        recordEvent: (event) => recorded.push(event),
        now: () => (time += 4),
      });
      const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
      return { socket, emit, recorded };
    }

    it("records an answered event as ok, with its name and time", async () => {
      const { emit, recorded } = timed({ "room:create": () => ({}) });

      await emit("room:create", {});

      expect(recorded).toEqual([{ event: "room:create", outcome: "ok", durationMs: 4 }]);
    });

    it("records a typed error as refused", async () => {
      const { emit, recorded } = timed({
        "room:join": () => {
          throw new ConflictError("Room is full");
        },
      });

      await emit("room:join", { code: "AB2CDE" });

      expect(recorded).toEqual([{ event: "room:join", outcome: "refused", durationMs: 4 }]);
    });

    it("records a fault of ours as failed", async () => {
      const { emit, recorded } = timed({
        "room:join": async () => {
          throw new Error("database down");
        },
      });

      await emit("room:join", {});

      expect(recorded).toEqual([{ event: "room:join", outcome: "failed", durationMs: 4 }]);
    });

    it("records a refused flood as rate_limited", async () => {
      const handler = vi.fn();
      const { emit, recorded } = timed({ "game:move": handler }, { allow: () => false });

      await emit("game:move", {});

      expect(handler).not.toHaveBeenCalled();
      expect(recorded).toEqual([{ event: "game:move", outcome: "rate_limited", durationMs: 4 }]);
    });

    it("records nothing for an event without an acknowledgement", () => {
      const { socket, recorded } = timed({ ping: vi.fn() });

      socket.emit("ping", {});

      expect(recorded).toEqual([]);
    });
  });
});
