import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "./errors.js";
import { createSocketClient } from "./socket.js";

/** A fake Socket.IO: `connect` is its `io()`, and the socket keeps its handlers so a test can play the server. */
function fakeIo(ack) {
  const handlers = new Map();
  const socket = {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler])),
    off: vi.fn((event, handler) =>
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== handler),
      ),
    ),
    timeout: vi.fn(() => ({ emitWithAck: ack })),
  };
  const emit = (event, value) => (handlers.get(event) ?? []).forEach((handler) => handler(value));
  return { connect: vi.fn(() => socket), socket, emit };
}

/** A download of Socket.IO that the test finishes or fails when it chooses, as the network would. */
function deferredLoad() {
  const calls = [];
  const load = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return {
    load,
    finish: (io) => calls.at(-1).resolve(io),
    fail: () => calls.at(-1).reject(new Error("404")),
  };
}

/** A client whose Socket.IO is already downloaded, once `needNow` was called. */
async function loadedClient(io, options = {}) {
  const client = createSocketClient({ load: async () => io.connect, ...options });
  client.needNow();
  await vi.waitFor(() => expect(io.connect).toHaveBeenCalled());
  return client;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("socket client", () => {
  it("does not connect until asked (the session must exist first)", async () => {
    const io = fakeIo();

    await loadedClient(io);

    expect(io.connect).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ autoConnect: false, transports: ["websocket"] }),
    );
    expect(io.socket.connect).not.toHaveBeenCalled();
  });

  it("gives Socket.IO options it may write to, as it does while it sets itself up", async () => {
    const io = fakeIo(vi.fn().mockResolvedValue({ ok: true, data: {} }));
    io.connect.mockImplementation((_url, options) => {
      options.path = "/socket.io";
      return io.socket;
    });

    await expect((await loadedClient(io)).request("room:create", {})).resolves.toEqual({});
  });

  it("resolves a request with the acknowledgement's data", async () => {
    const io = fakeIo(vi.fn().mockResolvedValue({ ok: true, data: { code: "AB2CD3" } }));

    await expect((await loadedClient(io)).request("room:create", { gameId: "rps" })).resolves.toEqual({
      code: "AB2CD3",
    });
  });

  it("rejects with the server's error code", async () => {
    const io = fakeIo(
      vi.fn().mockResolvedValue({ ok: false, error: { code: "CONFLICT", message: "Room is full" } }),
    );

    const error = await (await loadedClient(io)).request("room:join", {}).catch((err) => err);

    expect(error).toBeInstanceOf(AppRequestError);
    expect(error).toMatchObject({ code: "CONFLICT", message: "Room is full" });
  });

  it("rejects with TIMEOUT when the server does not answer", async () => {
    const io = fakeIo(vi.fn().mockRejectedValue(new Error("operation has timed out")));

    await expect((await loadedClient(io)).request("room:join", {})).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("subscribes to pushes and returns an unsubscribe", async () => {
    const io = fakeIo();
    const client = await loadedClient(io);
    const handler = () => {};

    const off = client.on("room:updated", handler);
    off();

    expect(io.socket.on).toHaveBeenCalledWith("room:updated", handler);
    expect(io.socket.off).toHaveBeenCalledWith("room:updated", handler);
  });

  it("connects and disconnects only when asked, and reports the connection state", async () => {
    const io = fakeIo();
    const client = await loadedClient(io);

    client.connect();
    io.socket.connected = true;
    const whileConnected = client.isConnected();
    client.disconnect();

    expect(io.socket.connect).toHaveBeenCalledOnce();
    expect(whileConnected).toBe(true);
    expect(io.socket.disconnect).toHaveBeenCalledOnce();
  });

  describe("before Socket.IO is downloaded (CC-333)", () => {
    it("downloads nothing until something needs the socket", async () => {
      const { load } = deferredLoad();
      const client = createSocketClient({ load });

      client.on("room:updated", () => {});
      client.onEndedByServer(() => {});
      client.connect();
      await flush();

      expect(load).not.toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });

    it("downloads once however often it is needed", async () => {
      const { load } = deferredLoad();
      const client = createSocketClient({ load });

      client.needNow();
      client.needNow();

      expect(load).toHaveBeenCalledOnce();
    });

    it("attaches every subscription made meanwhile, in order, before it can connect", async () => {
      const io = fakeIo();
      const { load, finish } = deferredLoad();
      const client = createSocketClient({ load });
      const order = [];
      client.on("connect", () => order.push("first"));
      client.on("connect", () => order.push("second"));
      client.connect();

      client.needNow();
      finish(io.connect);
      await vi.waitFor(() => expect(io.socket.connect).toHaveBeenCalledOnce());
      io.emit("connect");

      expect(order).toEqual(["first", "second"]);
      expect(io.socket.on.mock.invocationCallOrder[1]).toBeLessThan(
        io.socket.connect.mock.invocationCallOrder[0],
      );
    });

    it("never attaches a subscription that was unsubscribed meanwhile", async () => {
      const io = fakeIo();
      const { load, finish } = deferredLoad();
      const client = createSocketClient({ load });
      const gone = vi.fn();
      const kept = vi.fn();
      client.on("room:updated", gone)();
      client.on("room:updated", kept);

      client.needNow();
      finish(io.connect);
      await vi.waitFor(() => expect(io.connect).toHaveBeenCalled());
      io.emit("room:updated", { code: "AB2CD3" });

      expect(gone).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledWith({ code: "AB2CD3" });
    });

    it("unsubscribes on the socket a subscription that was attached after it was made", async () => {
      const io = fakeIo();
      const { load, finish } = deferredLoad();
      const client = createSocketClient({ load });
      const handler = vi.fn();
      const off = client.on("room:updated", handler);
      client.needNow();
      finish(io.connect);
      await vi.waitFor(() => expect(io.connect).toHaveBeenCalled());

      off();
      io.emit("room:updated", {});

      expect(handler).not.toHaveBeenCalled();
    });

    it("tells a server-ended listener made meanwhile, so a stale session is still noticed (CC-234)", async () => {
      const io = fakeIo();
      const { load, finish } = deferredLoad();
      const client = createSocketClient({ load });
      const handler = vi.fn();
      client.onEndedByServer(handler);

      client.needNow();
      finish(io.connect);
      await vi.waitFor(() => expect(io.connect).toHaveBeenCalled());
      io.emit("connect_error", Object.assign(new Error("refused"), { data: { code: "UNAUTHORIZED" } }));

      expect(handler).toHaveBeenCalledOnce();
    });

    it("connects once downloaded only when the last ask was to connect", async () => {
      const io = fakeIo();
      const { load, finish } = deferredLoad();
      const client = createSocketClient({ load });
      client.connect();
      client.disconnect();

      client.needNow();
      finish(io.connect);
      await vi.waitFor(() => expect(io.connect).toHaveBeenCalled());

      expect(io.socket.connect).not.toHaveBeenCalled();
    });

    it("connects at once when asked after the download", async () => {
      const io = fakeIo();
      const client = await loadedClient(io);

      client.connect();

      expect(io.socket.connect).toHaveBeenCalledOnce();
    });

    it("downloads at once for a request, and sends it once the socket is here", async () => {
      const io = fakeIo(vi.fn().mockResolvedValue({ ok: true, data: { code: "AB2CD3" } }));
      const { load, finish } = deferredLoad();
      const client = createSocketClient({ load });

      const answer = client.request("room:create", { gameId: "rps" });
      expect(load).toHaveBeenCalledOnce();
      finish(io.connect);

      await expect(answer).resolves.toEqual({ code: "AB2CD3" });
      expect(io.socket.timeout.mock.results[0].value.emitWithAck).toHaveBeenCalledWith("room:create", {
        gameId: "rps",
      });
    });

    it("counts the download inside the request's time limit, as one wait for the server", async () => {
      const io = fakeIo(vi.fn().mockResolvedValue({ ok: true, data: {} }));
      const { load, finish } = deferredLoad();
      let time = 1_000;
      const client = createSocketClient({ load, now: () => time });

      const answer = client.request("room:create", {});
      time += 3_000;
      finish(io.connect);
      await answer;

      expect(io.socket.timeout).toHaveBeenCalledWith(5_000);
    });

    it("rejects a request with TIMEOUT when the download fails", async () => {
      const { load, fail } = deferredLoad();
      const client = createSocketClient({ load, setTimer: () => {} });

      const answer = client.request("room:join", {});
      fail();

      await expect(answer).rejects.toMatchObject({ code: "TIMEOUT" });
    });

    it("tries a failed download again while the connection is wanted", async () => {
      const io = fakeIo();
      const { load, fail, finish } = deferredLoad();
      const timers = [];
      const client = createSocketClient({ load, setTimer: (run, ms) => timers.push({ run, ms }) });
      client.connect();
      client.needNow();
      fail();
      await vi.waitFor(() => expect(timers).toHaveLength(1));

      timers[0].run();
      finish(io.connect);

      expect(timers[0].ms).toBe(2_000);
      await vi.waitFor(() => expect(io.socket.connect).toHaveBeenCalledOnce());
    });

    it("waits for the next need after a failed download when no connection is wanted", async () => {
      const io = fakeIo();
      const { load, fail, finish } = deferredLoad();
      const timers = [];
      const client = createSocketClient({ load, setTimer: (run, ms) => timers.push({ run, ms }) });
      client.needNow();
      fail();
      await flush();

      client.connect();
      finish(io.connect);

      expect(timers).toEqual([]);
      expect(load).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(io.socket.connect).toHaveBeenCalledOnce());
    });

    it("does nothing more when the download gave way to a reload for a newer version (CC-181)", async () => {
      const { load, finish } = deferredLoad();
      const timers = [];
      const client = createSocketClient({ load, setTimer: (run, ms) => timers.push({ run, ms }) });
      client.connect();
      client.needNow();

      finish(undefined);
      await flush();
      client.needNow();

      expect(load).toHaveBeenCalledOnce();
      expect(timers).toEqual([]);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("ended by the server (CC-234)", () => {
    const refused = (code) => Object.assign(new Error("refused"), { data: { code } });

    it("tells when the server disconnected the socket on purpose", async () => {
      const io = fakeIo();
      const handler = vi.fn();
      (await loadedClient(io)).onEndedByServer(handler);

      io.emit("disconnect", "io server disconnect");

      expect(handler).toHaveBeenCalledOnce();
    });

    it("tells when the server refused the connection because the session may not be used", async () => {
      const io = fakeIo();
      const handler = vi.fn();
      (await loadedClient(io)).onEndedByServer(handler);

      io.emit("connect_error", refused("UNAUTHORIZED"));

      expect(handler).toHaveBeenCalledOnce();
    });

    it.each([
      ["a network drop", "disconnect", "transport close"],
      ["a server restart", "disconnect", "transport error"],
      ["this tab disconnecting itself", "disconnect", "io client disconnect"],
      ["a refusal for too many connections", "connect_error", refused("RATE_LIMITED")],
      ["a connection that could not be made", "connect_error", new Error("websocket error")],
    ])("says nothing about %s, which does not mean the session ended", async (_case, event, value) => {
      const io = fakeIo();
      const handler = vi.fn();
      (await loadedClient(io)).onEndedByServer(handler);

      io.emit(event, value);

      expect(handler).not.toHaveBeenCalled();
    });

    it("stops telling after unsubscribing", async () => {
      const io = fakeIo();
      const handler = vi.fn();
      const off = (await loadedClient(io)).onEndedByServer(handler);

      off();
      io.emit("disconnect", "io server disconnect");
      io.emit("connect_error", refused("UNAUTHORIZED"));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["a refusal without an error body", { ok: false }],
    ["no acknowledgement at all", undefined],
  ])("rejects with UNKNOWN for %s", async (_case, ack) => {
    const io = fakeIo(vi.fn().mockResolvedValue(ack));

    await expect((await loadedClient(io)).request("room:join", {})).rejects.toMatchObject({
      code: "UNKNOWN",
      message: "Something went wrong",
    });
  });
});
