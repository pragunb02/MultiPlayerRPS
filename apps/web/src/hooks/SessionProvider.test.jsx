import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { AppRequestError } from "../lib/errors.js";
import { fakeApi, fakeSocket, GUEST } from "../testing/fakes.js";
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

function setup(api = fakeApi()) {
  const socket = fakeSocket();
  render(
    <ServicesProvider services={{ api, socket }}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </ServicesProvider>,
  );
  return { api, socket };
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
      <ServicesProvider services={{ api, socket }}>
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

  it("requires a provider", () => {
    expect(() => render(<Probe />)).toThrow(/inside <SessionProvider>/);
  });
});
