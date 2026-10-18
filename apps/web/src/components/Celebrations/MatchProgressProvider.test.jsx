import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { SessionProvider } from "../../hooks/SessionProvider.jsx";
import { useSession } from "../../hooks/useSession.js";
import { fakeApi, fakeSessionBroadcast, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { KEPT_MATCHES, keepMatchUpdate, useMatchProgress } from "./matchProgressContext.js";
import { MatchProgressProvider } from "./MatchProgressProvider.jsx";
import { ResultCelebration } from "./ResultCelebration.jsx";

const ACCOUNT = Object.freeze({ kind: "user", id: "user_1", displayName: "Alice" });
const update = (matchId, overrides = {}) =>
  Object.freeze({
    source: "match",
    key: matchId,
    matchId,
    xpGained: 30,
    leveledUp: false,
    progress: { level: 1 },
    counted: true,
    notCountedReason: "",
    ...overrides,
  });
const won = (matchId) => ({
  you: GUEST.id,
  game: { matchId, outcome: { result: "win", winners: [GUEST.id] } },
});

/** Shows the XP the kept update of `matchId` gave, and lets the test sign in as someone else. */
function Probe({ matchId }) {
  const kept = useMatchProgress(matchId);
  const session = useSession();
  return (
    <>
      <p>{kept === undefined ? "nothing kept" : `kept +${kept.xpGained} XP`}</p>
      <button type="button" onClick={() => session.login({})}>
        Sign in
      </button>
    </>
  );
}

/** Renders `children` inside the app's providers as a signed-in guest, once the session is ready. */
async function renderKept(children) {
  const socket = fakeSocket();
  const services = {
    api: fakeApi({ getSession: async () => GUEST, login: async () => ({ identity: ACCOUNT }) }),
    socket,
    sound: fakeSound(),
    sessionBroadcast: fakeSessionBroadcast(),
  };
  const providers = (inside) => (
    <ServicesProvider services={services}>
      <SessionProvider>
        <MatchProgressProvider>{inside}</MatchProgressProvider>
      </SessionProvider>
    </ServicesProvider>
  );
  const view = render(providers(children));
  await waitFor(() => expect(socket.connect).toHaveBeenCalled());
  return { ...view, socket, show: (next) => view.rerender(providers(next)) };
}

describe("MatchProgressProvider", () => {
  it("gives a result that mounts after its match's update that update (CC-235)", async () => {
    const { socket, show } = await renderKept(null);

    act(() =>
      socket.push(
        "progress:updated",
        update("match-1", { xpGained: 0, counted: false, notCountedReason: "ended-too-soon" }),
      ),
    );
    show(<ResultCelebration room={won("match-1")} />);

    expect(screen.getByText("This game didn't count: it ended too soon")).toBeInTheDocument();
  });

  it("forgets the kept updates when someone else signs in, so they never see another person's XP", async () => {
    const { socket } = await renderKept(<Probe matchId="match-1" />);
    act(() => socket.push("progress:updated", update("match-1")));
    expect(screen.getByText("kept +30 XP")).toBeInTheDocument();

    await act(async () => screen.getByRole("button", { name: "Sign in" }).click());

    expect(screen.getByText("nothing kept")).toBeInTheDocument();
    // The new player's first update must not carry the last player's updates along with it.
    act(() => socket.push("progress:updated", update("match-2", { xpGained: 10 })));
    expect(screen.getByText("nothing kept")).toBeInTheDocument();
  });

  it("needs to be inside the provider", () => {
    expect(() => render(<Probe matchId="match-1" />)).toThrow(/inside <MatchProgressProvider>/);
  });
});

describe("keepMatchUpdate", () => {
  it("keeps match updates and leaves quest bonuses out, because they belong to no match", () => {
    const quest = update("", { source: "quest", key: "quest:2026-10-16:win-1" });

    expect(keepMatchUpdate([], quest)).toEqual([]);
    expect(keepMatchUpdate([], update("match-1"))).toEqual([update("match-1")]);
  });

  it("replaces an earlier update of the same match", () => {
    const kept = keepMatchUpdate([update("match-1"), update("match-2")], update("match-1", { xpGained: 5 }));

    expect(kept).toEqual([update("match-2"), update("match-1", { xpGained: 5 })]);
  });

  it(`keeps only the last ${KEPT_MATCHES} matches and does not change the list it was given`, () => {
    const full = Object.freeze(Array.from({ length: KEPT_MATCHES }, (_, n) => update(`match-${n}`)));

    const kept = keepMatchUpdate(full, update("match-new"));

    expect(kept).toHaveLength(KEPT_MATCHES);
    expect(kept.map(({ matchId }) => matchId)).toEqual([
      ...full.slice(1).map(({ matchId }) => matchId),
      "match-new",
    ]);
    expect(Object.isFrozen(kept)).toBe(true);
    expect(full[0].matchId).toBe("match-0");
  });
});
