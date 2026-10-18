import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "./errors.js";
import { createSocketClient } from "./socket.js";

function fakeIo(ack) {
  const socket = {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    timeout: vi.fn(() => ({ emitWithAck: ack })),
  };
  return { connect: vi.fn(() => socket), socket };
}

describe("socket client", () => {
  it("does not connect until asked (the session must exist first)", () => {
    const io = fakeIo();

    createSocketClient({ connect: io.connect });

    expect(io.connect).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ autoConnect: false, transports: ["websocket"] }),
    );
    expect(io.socket.connect).not.toHaveBeenCalled();
  });

  it("resolves a request with the acknowledgement's data", async () => {
    const io = fakeIo(vi.fn().mockResolvedValue({ ok: true, data: { code: "AB2CD3" } }));

    await expect(
      createSocketClient({ connect: io.connect }).request("room:create", { gameId: "rps" }),
    ).resolves.toEqual({
      code: "AB2CD3",
    });
  });

  it("rejects with the server's error code", async () => {
    const io = fakeIo(
      vi.fn().mockResolvedValue({ ok: false, error: { code: "CONFLICT", message: "Room is full" } }),
    );

    const error = await createSocketClient({ connect: io.connect })
      .request("room:join", {})
      .catch((err) => err);

    expect(error).toBeInstanceOf(AppRequestError);
    expect(error).toMatchObject({ code: "CONFLICT", message: "Room is full" });
  });

  it("rejects with TIMEOUT when the server does not answer", async () => {
    const io = fakeIo(vi.fn().mockRejectedValue(new Error("operation has timed out")));

    await expect(createSocketClient({ connect: io.connect }).request("room:join", {})).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("subscribes to pushes and returns an unsubscribe", () => {
    const io = fakeIo();
    const client = createSocketClient({ connect: io.connect });
    const handler = () => {};

    const off = client.on("room:updated", handler);
    off();

    expect(io.socket.on).toHaveBeenCalledWith("room:updated", handler);
    expect(io.socket.off).toHaveBeenCalledWith("room:updated", handler);
  });

  it("connects and disconnects only when asked, and reports the connection state", () => {
    const io = fakeIo();
    const client = createSocketClient({ connect: io.connect });

    client.connect();
    io.socket.connected = true;
    const whileConnected = client.isConnected();
    client.disconnect();

    expect(io.socket.connect).toHaveBeenCalledOnce();
    expect(whileConnected).toBe(true);
    expect(io.socket.disconnect).toHaveBeenCalledOnce();
  });

  describe("ended by the server (CC-234)", () => {
    /** A fake Socket.IO socket that keeps its handlers, so a test can play what the server does. */
    function emittingIo() {
      const io = fakeIo();
      const handlers = new Map();
      io.socket.on = vi.fn((event, handler) =>
        handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      );
      io.socket.off = vi.fn((event, handler) =>
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler),
        ),
      );
      const emit = (event, value) => (handlers.get(event) ?? []).forEach((handler) => handler(value));
      return { io, emit };
    }
    const refused = (code) => Object.assign(new Error("refused"), { data: { code } });

    it("tells when the server disconnected the socket on purpose", () => {
      const { io, emit } = emittingIo();
      const handler = vi.fn();
      createSocketClient({ connect: io.connect }).onEndedByServer(handler);

      emit("disconnect", "io server disconnect");

      expect(handler).toHaveBeenCalledOnce();
    });

    it("tells when the server refused the connection because the session may not be used", () => {
      const { io, emit } = emittingIo();
      const handler = vi.fn();
      createSocketClient({ connect: io.connect }).onEndedByServer(handler);

      emit("connect_error", refused("UNAUTHORIZED"));

      expect(handler).toHaveBeenCalledOnce();
    });

    it.each([
      ["a network drop", "disconnect", "transport close"],
      ["a server restart", "disconnect", "transport error"],
      ["this tab disconnecting itself", "disconnect", "io client disconnect"],
      ["a refusal for too many connections", "connect_error", refused("RATE_LIMITED")],
      ["a connection that could not be made", "connect_error", new Error("websocket error")],
    ])("says nothing about %s, which does not mean the session ended", (_case, event, value) => {
      const { io, emit } = emittingIo();
      const handler = vi.fn();
      createSocketClient({ connect: io.connect }).onEndedByServer(handler);

      emit(event, value);

      expect(handler).not.toHaveBeenCalled();
    });

    it("stops telling after unsubscribing", () => {
      const { io, emit } = emittingIo();
      const handler = vi.fn();
      const off = createSocketClient({ connect: io.connect }).onEndedByServer(handler);

      off();
      emit("disconnect", "io server disconnect");
      emit("connect_error", refused("UNAUTHORIZED"));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["a refusal without an error body", { ok: false }],
    ["no acknowledgement at all", undefined],
  ])("rejects with UNKNOWN for %s", async (_case, ack) => {
    const io = fakeIo(vi.fn().mockResolvedValue(ack));

    await expect(createSocketClient({ connect: io.connect }).request("room:join", {})).rejects.toMatchObject({
      code: "UNKNOWN",
      message: "Something went wrong",
    });
  });
});
