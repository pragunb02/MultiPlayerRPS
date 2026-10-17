import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { AppRequestError } from "../lib/errors.js";
import { fakeApi, fakeSessionBroadcast, fakeSocket, GUEST } from "../testing/fakes.js";
import { SessionProvider } from "./SessionProvider.jsx";
import { useSession } from "./useSession.js";

// The latest session value, captured after each render (effects may write outside React; render may not).
const latest = { current: undefined };
function Probe() {
  const value = useSession();
  useEffect(() => {
    latest.current = value;
  });
  return <p>{value.status}</p>;
}
const session = new Proxy({}, { get: (_target, key) => latest.current[key] });

function setup(api = fakeApi(), sessionBroadcast = fakeSessionBroadcast()) {
  const socket = fakeSocket();
  render(
    <ServicesProvider services={{ api, socket, sessionBroadcast }}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </ServicesProvider>,
  );
  return { api, socket, sessionBroadcast };
}

describe("SessionProvider", () => {
  it("is anonymous when there is no session, and does not open a socket", async () => {
    const { socket } = setup();

    expect(await screen.findByText("anonymous")).toBeInTheDocument();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it("restores an existing session and connects the socket", async () => {
    const { socket } = setup(fakeApi({ getSession: async () => GUEST }));

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(session.identity).toEqual(GUEST);
    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it("starts a guest session on demand, only once", async () => {
    const { api, socket } = setup();
    await screen.findByText("anonymous");

    await act(() => session.ensurePlayer());
    await act(() => session.ensurePlayer());

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(session.identity).toEqual(GUEST);
    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it("shares one guest session between pages asking at the same time, connecting once (CC-081)", async () => {
    let finish;
    const { api, socket } = setup(
      fakeApi({ startGuest: vi.fn(() => new Promise((resolve) => (finish = resolve))) }),
    );
    await screen.findByText("anonymous");

    const asks = [session.ensurePlayer(), session.ensurePlayer()];
    await act(async () => {
      finish(GUEST);
      await Promise.all(asks);
    });

    expect(await Promise.all(asks)).toEqual([GUEST, GUEST]);
    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(socket.disconnect).toHaveBeenCalledOnce(); // only before the first connect, never a connecting socket
  });

  it("ignores a slow first session answer once a guest session started meanwhile (CC-084)", async () => {
    let answerSession;
    const api = fakeApi({ getSession: vi.fn(() => new Promise((resolve) => (answerSession = resolve))) });
    const { socket } = setup(api);
    await act(() => session.ensurePlayer());

    await act(async () => answerSession(undefined)); // "no session" — true when asked, stale now

    expect(session.identity).toEqual(GUEST);
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(socket.disconnect).toHaveBeenCalledOnce();
  });

  it("reconnects the socket when the identity changes (the socket authenticates at connect time)", async () => {
    const user = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
    const carriedOver = { xp: 30, matchesPlayed: 1, matches: 1 };
    const { socket } = setup(
      fakeApi({ getSession: async () => GUEST, login: async () => ({ identity: user, carriedOver }) }),
    );
    await screen.findByText("ready");

    const result = await act(() => session.login({ email: "riya@example.com", password: "x" }));

    expect(result).toEqual({ identity: user, carriedOver }); // passed through for the welcome message
    expect(session.identity).toEqual(user);
    expect(socket.disconnect).toHaveBeenCalledTimes(2);
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it("logs out: ends the session and closes the socket", async () => {
    const { api, socket } = setup(fakeApi({ getSession: async () => GUEST }));
    await screen.findByText("ready");

    await act(() => session.logout());

    expect(api.endSession).toHaveBeenCalledOnce();
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    expect(socket.isConnected()).toBe(false);
  });

  it("treats a session the server rejects (e.g. corrupt) as no session", async () => {
    const { socket } = setup(
      fakeApi({
        getSession: async () =>
          Promise.reject(new AppRequestError({ code: "UNAUTHORIZED", message: "No", status: 401 })),
      }),
    );

    expect(await screen.findByText("anonymous")).toBeInTheDocument();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it.each([
    ["an answer", () => Promise.resolve(GUEST)],
    [
      "a failure",
      () => Promise.reject(new AppRequestError({ code: "UNAUTHORIZED", message: "No", status: 401 })),
    ],
  ])("ignores %s that arrives after the app is gone", async (_case, settle) => {
    let finish;
    const api = fakeApi({ getSession: () => new Promise((resolve) => (finish = resolve)) });
    const socket = fakeSocket();
    const { unmount } = render(
      <ServicesProvider services={{ api, socket, sessionBroadcast: fakeSessionBroadcast() }}>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </ServicesProvider>,
    );

    unmount();
    await act(async () => {
      finish(settle().catch((err) => Promise.reject(err)));
      await Promise.resolve();
    });

    expect(socket.connect).not.toHaveBeenCalled();
  });

  it("reports unexpected failures loading the session", async () => {
    setup(
      fakeApi({
        getSession: async () => Promise.reject(Object.assign(new Error("down"), { code: "NETWORK" })),
      }),
    );

    await waitFor(() => expect(screen.getByText("error")).toBeInTheDocument());
  });

  describe("when the server ends the socket on purpose (CC-234)", () => {
    const USER = Object.freeze({ kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" });

    it("asks the server again and shows signed out when the session was ended elsewhere", async () => {
      const api = fakeApi({ getSession: vi.fn().mockResolvedValueOnce(USER).mockResolvedValue(undefined) });
      const { socket } = setup(api);
      await screen.findByText("ready");

      act(() => socket.endByServer());

      expect(await screen.findByText("anonymous")).toBeInTheDocument();
      expect(api.getSession).toHaveBeenCalledTimes(2);
      expect(session.identity).toBeUndefined();
      expect(socket.isConnected()).toBe(false);
    });

    it("connects again when the session is still the same player", async () => {
      const api = fakeApi({ getSession: vi.fn().mockResolvedValue(USER) });
      const { socket } = setup(api);
      await screen.findByText("ready");

      await act(async () => socket.endByServer());

      await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(socket.isConnected()).toBe(true));
      expect(socket.connect).toHaveBeenCalledTimes(2);
      expect(session.identity).toEqual(USER);
    });

    it("connects as the player the session holds now", async () => {
      const api = fakeApi({ getSession: vi.fn().mockResolvedValueOnce(GUEST).mockResolvedValue(USER) });
      const { socket } = setup(api);
      await screen.findByText("ready");

      await act(async () => socket.endByServer());

      await waitFor(() => expect(session.identity).toEqual(USER));
      expect(socket.isConnected()).toBe(true);
    });

    it("leaves it to this tab's own log in, without showing signed out meanwhile", async () => {
      let answerLogin;
      const api = fakeApi({
        getSession: vi.fn().mockResolvedValueOnce(GUEST).mockResolvedValue(undefined),
        login: vi.fn(() => new Promise((resolve) => (answerLogin = resolve))),
      });
      const { socket } = setup(api);
      await screen.findByText("ready");
      const loggingIn = session.login({ email: "riya@example.com", password: "x" });

      act(() => socket.endByServer());
      await act(async () => {
        answerLogin({ identity: USER });
        await loggingIn;
      });

      expect(api.getSession).toHaveBeenCalledOnce();
      expect(session.identity).toEqual(USER);
      expect(socket.isConnected()).toBe(true);
    });

    it("asks the server once this tab's own attempt failed", async () => {
      let failLogin;
      const api = fakeApi({
        getSession: vi.fn().mockResolvedValueOnce(GUEST).mockResolvedValue(undefined),
        login: vi.fn(() => new Promise((_resolve, reject) => (failLogin = reject))),
      });
      const { socket } = setup(api);
      await screen.findByText("ready");
      const loggingIn = session.login({ email: "riya@example.com", password: "x" }).catch((err) => err);

      act(() => socket.endByServer());
      await act(async () => {
        failLogin(new AppRequestError({ code: "UNAUTHORIZED", message: "No", status: 401 }));
        await loggingIn;
      });

      expect(await screen.findByText("anonymous")).toBeInTheDocument();
      expect(api.getSession).toHaveBeenCalledTimes(2);
    });

    it("stops listening when the app is gone", async () => {
      const { socket, api } = setup(fakeApi({ getSession: vi.fn().mockResolvedValue(GUEST) }));
      await screen.findByText("ready");

      cleanup();
      socket.endByServer();

      expect(api.getSession).toHaveBeenCalledOnce();
    });
  });

  describe("other tabs of this browser (CC-115)", () => {
    const USER = Object.freeze({ kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" });

    it("asks the server again when another tab changed the session, and connects as that player", async () => {
      const api = fakeApi({ getSession: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(USER) });
      const { socket, sessionBroadcast } = setup(api);
      await screen.findByText("anonymous");

      act(() => sessionBroadcast.receive());

      expect(await screen.findByText("ready")).toBeInTheDocument();
      expect(session.identity).toEqual(USER);
      expect(socket.isConnected()).toBe(true);
    });

    it("shows signed out when another tab logged out", async () => {
      const api = fakeApi({ getSession: vi.fn().mockResolvedValueOnce(USER).mockResolvedValue(undefined) });
      const { socket, sessionBroadcast } = setup(api);
      await screen.findByText("ready");

      act(() => sessionBroadcast.receive());

      expect(await screen.findByText("anonymous")).toBeInTheDocument();
      expect(socket.isConnected()).toBe(false);
    });

    it("asks the server after this tab's own change when another tab spoke meanwhile", async () => {
      let answerLogin;
      const api = fakeApi({
        getSession: vi.fn().mockResolvedValueOnce(GUEST).mockResolvedValue(undefined),
        login: vi.fn(() => new Promise((resolve) => (answerLogin = resolve))),
      });
      const { sessionBroadcast } = setup(api);
      await screen.findByText("ready");
      const loggingIn = session.login({ email: "riya@example.com", password: "x" });

      act(() => sessionBroadcast.receive());
      const askedDuringLogin = api.getSession.mock.calls.length;
      await act(async () => {
        answerLogin({ identity: USER });
        await loggingIn;
      });

      expect(askedDuringLogin).toBe(1);
      expect(await screen.findByText("anonymous")).toBeInTheDocument();
      expect(api.getSession).toHaveBeenCalledTimes(2);
    });

    it("keeps a working socket when the session is still the same player", async () => {
      const api = fakeApi({ getSession: vi.fn().mockResolvedValue(USER) });
      const { socket, sessionBroadcast } = setup(api);
      await screen.findByText("ready");

      await act(async () => sessionBroadcast.receive());

      await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(2));
      expect(socket.connect).toHaveBeenCalledOnce();
      expect(socket.isConnected()).toBe(true);
    });

    it.each([
      ["signing up", () => session.signup({ username: "Riya", email: "riya@example.com", password: "x" })],
      ["logging in", () => session.login({ email: "riya@example.com", password: "x" })],
      ["logging out", () => session.logout()],
      ["starting a guest", () => session.ensurePlayer()],
    ])("tells the other tabs after %s, with no identity in the message", async (_case, change) => {
      const api = fakeApi({
        signup: vi.fn().mockResolvedValue({ identity: USER }),
        login: vi.fn().mockResolvedValue({ identity: USER }),
      });
      const { sessionBroadcast } = setup(api);
      await screen.findByText("anonymous");

      await act(change);

      expect(sessionBroadcast.announce).toHaveBeenCalledOnce();
      expect(sessionBroadcast.announce).toHaveBeenCalledWith();
    });

    it("tells nobody when nothing changed", async () => {
      const api = fakeApi({
        getSession: vi.fn().mockResolvedValue(GUEST),
        login: vi.fn().mockRejectedValue(new AppRequestError({ code: "UNAUTHORIZED", message: "No" })),
      });
      const { sessionBroadcast } = setup(api);
      await screen.findByText("ready");

      await act(() => session.ensurePlayer());
      await act(() => session.login({ email: "riya@example.com", password: "x" }).catch(() => undefined));
      await act(() => sessionBroadcast.receive());

      expect(sessionBroadcast.announce).not.toHaveBeenCalled();
    });
  });

  it("requires a provider", () => {
    expect(() => render(<Probe />)).toThrow(/inside <SessionProvider>/);
  });
});
