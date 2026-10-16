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
