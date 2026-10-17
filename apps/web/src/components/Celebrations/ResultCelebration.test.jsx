import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { fakeApi, fakeSocket } from "../../testing/fakes.js";
import { installMatchMedia } from "../../testing/matchMedia.js";
import { outcomeFor } from "./outcome.js";
import { ResultCelebration } from "./ResultCelebration.jsx";

const finished = ({ you = "a", result = "win", winners = ["a"] } = {}) => ({
  you,
  game: { outcome: { status: "finished", result, winners } },
});

function celebrate(room, socket = fakeSocket()) {
  const view = render(
    <ServicesProvider services={{ api: fakeApi(), socket }}>
      <ResultCelebration room={room} />
    </ServicesProvider>,
  );
  return { ...view, socket };
}

const confetti = () => document.querySelector("[data-effect='confetti']");

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
  ])("celebrates %s with its banner; confetti only for a win", (_case, room, banner, withConfetti) => {
    const { container } = celebrate(room);

    expect(screen.getByText(banner)).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(Boolean(confetti())).toBe(withConfetti);
  });

  it("floats the XP once the server has recorded the match", () => {
    const { socket } = celebrate(finished());
    expect(document.querySelector("[data-effect='xp-pop']")).toBeNull();

    act(() => socket.push("progress:updated", { xpGained: 30, leveledUp: false, progress: { level: 1 } }));

    expect(document.querySelector("[data-effect='xp-pop']")).toHaveTextContent("+30 XP");
  });

  it("floats the match's XP, not a quest bonus that follows it", () => {
    const { socket } = celebrate(finished());

    act(() => socket.push("progress:updated", { source: "match", xpGained: 30, progress: { level: 1 } }));
    act(() => socket.push("progress:updated", { source: "quest", xpGained: 20, progress: { level: 1 } }));

    expect(document.querySelector("[data-effect='xp-pop']")).toHaveTextContent("+30 XP");
  });

  it("shows no XP pop for a match that earned nothing (a forfeit)", () => {
    const { socket } = celebrate(finished({ winners: ["b"] }));

    act(() => socket.push("progress:updated", { xpGained: 0, leveledUp: false, progress: { level: 1 } }));

    expect(document.querySelector("[data-effect='xp-pop']")).toBeNull();
  });

  it("keeps the banner and drops the motion under reduced motion", () => {
    installMatchMedia({ reducedMotion: true });
    const { socket } = celebrate(finished());

    act(() => socket.push("progress:updated", { xpGained: 30, leveledUp: false, progress: { level: 1 } }));

    expect(screen.getByText("Victory!")).toBeInTheDocument();
    expect(confetti()).toBeNull();
    expect(document.querySelector("[data-effect='xp-pop']")).toBeNull();
  });

  it("says under the banner why a game didn't count, and forgets it when the next match counted (CC-095)", () => {
    const { socket } = celebrate(finished());
    const uncounted = { source: "match", xpGained: 0, counted: false, notCountedReason: "ended-too-soon" };

    act(() => socket.push("progress:updated", { ...uncounted, progress: { level: 1 } }));

    expect(screen.getByText("This game didn't count: it ended too soon")).toBeInTheDocument();
    expect(document.querySelector("[data-effect='xp-pop']")).toBeNull();

    act(() =>
      socket.push("progress:updated", {
        source: "match",
        xpGained: 30,
        counted: true,
        progress: { level: 1 },
      }),
    );

    expect(screen.queryByText(/didn't count/)).toBeNull();
  });

  it("keeps the reason when a quest push follows", () => {
    const { socket } = celebrate(finished());

    act(() =>
      socket.push("progress:updated", {
        source: "match",
        xpGained: 0,
        counted: false,
        notCountedReason: "hourly-limit",
      }),
    );
    act(() => socket.push("progress:updated", { source: "quest", xpGained: 20, counted: true }));

    expect(screen.getByText(/didn't count: you reached the limit/)).toBeInTheDocument();
  });
});
