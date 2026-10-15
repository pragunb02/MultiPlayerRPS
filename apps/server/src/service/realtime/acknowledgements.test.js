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
});
