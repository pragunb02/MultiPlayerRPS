import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { outcomeMoment } from "../../games/outcomeMoment.js";
import { SessionProvider } from "../../hooks/SessionProvider.jsx";
import { fakeApi, fakeSessionBroadcast, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { installMatchMedia } from "../../testing/matchMedia.js";
import { SessionStatus } from "../../testing/SessionStatus.jsx";
import { sessionReady } from "../../testing/sessionReady.js";
import { ToastProvider } from "../Toast/ToastProvider.jsx";
import { useToast } from "../Toast/toastContext.js";
import { MatchProgressProvider } from "./MatchProgressProvider.jsx";
import { outcomeFor } from "./outcome.js";
import { ResultCelebration } from "./ResultCelebration.jsx";

const MATCH = "match-1";
const finished = ({
  you = "a",
  result = "win",
  winners = ["a"],
  reason = "checkmate",
  matchId = MATCH,
} = {}) => ({
  gameId: "chess",
  you,
  status: "finished",
  seats: [
    { playerId: "a", displayName: "Alice", connected: true },
    { playerId: "b", displayName: "Bob", connected: true },
  ],
  game: { matchId, view: {}, activePlayers: [], outcome: { status: "finished", result, winners, reason } },
});
/** A `progress:updated` push for a match, as the server sends it. */
const matchUpdate = (overrides = {}) => ({
  source: "match",
  key: MATCH,
  matchId: MATCH,
  xpGained: 30,
  leveledUp: false,
  progress: { level: 1 },
  counted: true,
  notCountedReason: "",
  ...overrides,
});
const questUpdate = (overrides = {}) => ({
  ...matchUpdate({ source: "quest", key: "quest:2026-10-16:win-1", matchId: "", xpGained: 20 }),
  ...overrides,
});

/** What the toasts can do, caught from inside the providers so a test can show one. */
const toasts = {};
function GrabToasts() {
  Object.assign(toasts, useToast());
  return null;
}

/**
 * Renders the result as a signed-in guest, once the session is ready. The result goes on screen only after that,
 * so a test can switch to fake timers first and the moment's own timer runs on them.
 */
async function celebrate(room, { socket = fakeSocket(), beforeResult = () => undefined, live = true } = {}) {
  const ui = (withResult) => (
    <ServicesProvider
      services={{
        api: fakeApi({ getSession: async () => GUEST }),
        socket,
        sound: fakeSound(),
        sessionBroadcast: fakeSessionBroadcast(),
      }}
    >
      <SessionProvider>
        <ToastProvider displayMs={10_000}>
          <MatchProgressProvider>
            <GrabToasts />
            {withResult && <ResultCelebration room={room} moment={outcomeMoment(room)} live={live} />}
            <SessionStatus />
          </MatchProgressProvider>
        </ToastProvider>
      </SessionProvider>
    </ServicesProvider>
  );
  const view = render(ui(false));
  await sessionReady();
  beforeResult();
  view.rerender(ui(true));
  return {
    ...view,
    socket,
    celebration: () => document.querySelector("[data-cc-moment]"),
    hide: () => view.rerender(ui(false)),
  };
}

const confetti = () => document.querySelector("[data-effect='confetti']");
const xpPop = () => document.querySelector("[data-effect='xp-pop']");
const toastText = () => screen.getByRole("status").textContent;

describe("outcomeFor", () => {
  it.each([
    ["a winner", finished(), "win"],
    ["a loser", finished({ winners: ["b"] }), "loss"],
    ["a drawn game", finished({ result: "draw", winners: [] }), "draw"],
    ["a spectator", finished({ you: "" }), "watched"],
    ["a spectator of a draw", finished({ you: "", result: "draw", winners: [] }), "draw"],
  ])("tells %s how it went", (_who, room, outcome) => {
    expect(outcomeFor(room)).toBe(outcome);
  });
});

describe("ResultCelebration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["a win played to the end", finished(), "Victory!", true, false],
    ["a win by forfeit", finished({ reason: "forfeit" }), "Victory", false, true],
    ["a win on the move timer", finished({ reason: "idle" }), "Victory", false, true],
    ["a draw", finished({ result: "draw", winners: [], reason: "stalemate" }), "Draw", false, false],
    [
      "an aborted game",
      finished({ result: "aborted", winners: [], reason: "aborted" }),
      "No result",
      false,
      false,
    ],
    ["a spectator", finished({ you: "" }), "Game over", false, false],
  ])(
    "stamps %s with its word, and confetti only for a win earned on the board",
    async (_case, room, stamp, withConfetti, trophy) => {
      const { celebration } = await celebrate(room);

      expect(celebration().querySelector("[data-cc-stamp]")).toHaveTextContent(stamp);
      expect(celebration()).toHaveAttribute("aria-hidden", "true");
      expect(Boolean(confetti())).toBe(withConfetti);
      expect(Boolean(celebration().querySelector("[data-cc-icon='trophy']"))).toBe(trophy);
    },
  );

  it("gives a loss no stamp and no confetti, so no big word shouts it", async () => {
    const { celebration } = await celebrate(finished({ winners: ["b"] }));

    expect(celebration().querySelector("[data-cc-stamp]")).toBeNull();
    expect(screen.queryByText("Defeat")).not.toBeInTheDocument();
    expect(confetti()).toBeNull();
  });

  it("keeps lower toasts waiting while the moment plays, then lets them through (CC-099 beat 1)", async () => {
    await celebrate(finished(), { beforeResult: () => vi.useFakeTimers() });

    act(() => toasts.show("+30 XP", { surface: "toast.xp", category: "reward" }));
    act(() => toasts.show("Bob left the room", { surface: "toast.xp", category: "social" }));
    expect(toastText()).toBe("");

    act(() => vi.advanceTimersByTime(1_199));
    expect(toastText()).toBe("");

    act(() => vi.advanceTimersByTime(1));
    expect(toastText()).toBe("+30 XPBob left the room");
  });

  it("holds nothing for a result that was already over when the page opened (a reload)", async () => {
    await celebrate(finished(), { beforeResult: () => vi.useFakeTimers(), live: false });

    act(() => toasts.show("+30 XP", { surface: "toast.xp", category: "reward" }));

    expect(toastText()).toBe("+30 XP");
  });

  it("never holds back what matters more than the result: a lost connection shows at once", async () => {
    await celebrate(finished(), { beforeResult: () => vi.useFakeTimers() });

    act(() => toasts.show("Connection lost", { surface: "toast.xp", category: "system" }));

    expect(toastText()).toBe("Connection lost");
  });

  it("lets the waiting toasts through when the result goes before the moment is over (a quick rematch)", async () => {
    const { hide } = await celebrate(finished(), { beforeResult: () => vi.useFakeTimers() });
    act(() => toasts.show("+30 XP", { surface: "toast.xp", category: "reward" }));

    hide();

    expect(toastText()).toBe("+30 XP");
  });

  it("floats the XP once the server has recorded the match", async () => {
    const { socket } = await celebrate(finished());
    expect(xpPop()).toBeNull();

    act(() => socket.push("progress:updated", matchUpdate()));

    expect(xpPop()).toHaveTextContent("+30 XP");
  });

  it("floats the match's XP, not a quest bonus that follows it", async () => {
    const { socket } = await celebrate(finished());

    act(() => socket.push("progress:updated", matchUpdate()));
    act(() => socket.push("progress:updated", questUpdate()));

    expect(xpPop()).toHaveTextContent("+30 XP");
  });

  it("shows no XP pop for a match that earned nothing (a forfeit)", async () => {
    const { socket } = await celebrate(finished({ winners: ["b"] }));

    act(() => socket.push("progress:updated", matchUpdate({ xpGained: 0 })));

    expect(xpPop()).toBeNull();
  });

  it("keeps the same words and drops every effect under reduced motion", async () => {
    installMatchMedia({ reducedMotion: true });
    const { socket, celebration } = await celebrate(finished());

    act(() => socket.push("progress:updated", matchUpdate()));

    expect(celebration().querySelector("[data-cc-stamp]")).toHaveTextContent("Victory!");
    expect(document.querySelector("[data-effect]")).toBeNull();
  });

  it("keeps the quiet win's trophy under reduced motion, because it is a still picture", async () => {
    installMatchMedia({ reducedMotion: true });
    const { celebration } = await celebrate(finished({ reason: "forfeit" }));

    expect(celebration().querySelector("[data-cc-stamp]")).toHaveTextContent("Victory");
    expect(celebration().querySelector("[data-cc-icon='trophy']")).not.toBeNull();
  });

  it("says under the banner why a game didn't count, with no XP (CC-095)", async () => {
    const { socket } = await celebrate(finished());

    act(() =>
      socket.push(
        "progress:updated",
        matchUpdate({ xpGained: 0, counted: false, notCountedReason: "ended-too-soon" }),
      ),
    );

    expect(screen.getByText("This game didn't count: it ended too soon")).toBeInTheDocument();
    expect(xpPop()).toBeNull();
  });

  it("keeps the reason when a quest push follows", async () => {
    const { socket } = await celebrate(finished());

    act(() =>
      socket.push(
        "progress:updated",
        matchUpdate({ xpGained: 0, counted: false, notCountedReason: "hourly-limit" }),
      ),
    );
    act(() => socket.push("progress:updated", questUpdate()));

    expect(screen.getByText(/didn't count: you reached the limit/)).toBeInTheDocument();
  });

  it("shows only its own match's update, not another room's or the game before a rematch", async () => {
    const { socket } = await celebrate(finished());

    act(() => socket.push("progress:updated", matchUpdate({ matchId: "match-0", key: "match-0" })));

    expect(xpPop()).toBeNull();
  });
});
