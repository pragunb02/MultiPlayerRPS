import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { SessionProvider } from "../../hooks/SessionProvider.jsx";
import { fakeApi, fakeSessionBroadcast, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { installMatchMedia } from "../../testing/matchMedia.js";
import { SessionStatus } from "../../testing/SessionStatus.jsx";
import { sessionReady } from "../../testing/sessionReady.js";
import { MatchProgressProvider } from "./MatchProgressProvider.jsx";
import { outcomeFor } from "./outcome.js";
import { ResultCelebration } from "./ResultCelebration.jsx";

const MATCH = "match-1";
const finished = ({ you = "a", result = "win", winners = ["a"], matchId = MATCH } = {}) => ({
  you,
  game: { matchId, outcome: { status: "finished", result, winners } },
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

/** Renders the result as a signed-in guest, once the session is ready. */
async function celebrate(room, socket = fakeSocket()) {
  const view = render(
    <ServicesProvider
      services={{
        api: fakeApi({ getSession: async () => GUEST }),
        socket,
        sound: fakeSound(),
        sessionBroadcast: fakeSessionBroadcast(),
      }}
    >
      <SessionProvider>
        <MatchProgressProvider>
          <ResultCelebration room={room} />
          <SessionStatus />
        </MatchProgressProvider>
      </SessionProvider>
    </ServicesProvider>,
  );
  await sessionReady();
  return { ...view, socket };
}

const confetti = () => document.querySelector("[data-effect='confetti']");
const xpPop = () => document.querySelector("[data-effect='xp-pop']");

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
  it.each([
    ["a win", finished(), "Victory!", true],
    ["a loss", finished({ winners: ["b"] }), "Defeat", false],
    ["a draw", finished({ result: "draw", winners: [] }), "Draw", false],
    ["a spectator", finished({ you: "" }), "Game over", false],
  ])("celebrates %s with its banner; confetti only for a win", async (_case, room, banner, withConfetti) => {
    const { container } = await celebrate(room);

    expect(screen.getByText(banner)).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(Boolean(confetti())).toBe(withConfetti);
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

  it("keeps the banner and drops the motion under reduced motion", async () => {
    installMatchMedia({ reducedMotion: true });
    const { socket } = await celebrate(finished());

    act(() => socket.push("progress:updated", matchUpdate()));

    expect(screen.getByText("Victory!")).toBeInTheDocument();
    expect(confetti()).toBeNull();
    expect(xpPop()).toBeNull();
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
