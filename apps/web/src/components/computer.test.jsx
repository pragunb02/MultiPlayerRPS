import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { fakeSocket, fakeSound } from "../testing/fakes.js";
import { renderApp } from "../testing/render.jsx";
import { computerSeats, isComputer, levelNameOf } from "./computer.js";
import { ComputerNote } from "./ComputerNote/ComputerNote.jsx";
import { computerXpMessage, isComputerGame } from "./notCounted.js";
import { Seats } from "./Seats/Seats.jsx";

// Computer characters are always labelled as computer players, and their games say how they count (ADR-025).
const PERSON = { playerId: "guest_a", displayName: "Alice", connected: true };
const ROCKY = {
  playerId: "bot_rocky_hard",
  displayName: "Rocky",
  connected: true,
  bot: { character: "rocky", level: "hard" },
};
const room = (seats) => ({ hostId: "guest_a", you: "guest_a", players: { min: 2, max: 2 }, seats });

describe("computer seats", () => {
  it("finds the computer players in a room", () => {
    expect(computerSeats(room([PERSON, ROCKY]))).toEqual([ROCKY]);
    expect(computerSeats(room([PERSON]))).toEqual([]);
    expect(isComputer(ROCKY)).toBe(true);
    expect(isComputer(PERSON)).toBe(false);
    expect(isComputer(undefined)).toBe(false);
  });

  it("names the level as the level picker does, and keeps an unknown level's id", () => {
    expect(levelNameOf(ROCKY)).toBe("Hard");
    expect(levelNameOf({ bot: { character: "pip", level: "hard" } })).toBe("Unbeatable");
    expect(levelNameOf({ bot: { character: "rocky", level: "expert" } })).toBe("expert");
    expect(levelNameOf({ bot: { character: "nobody", level: "easy" } })).toBe("easy");
  });

  it("labels the computer in the list of players", () => {
    render(
      <ServicesProvider services={{ sound: fakeSound() }}>
        <Seats room={{ ...room([PERSON, ROCKY]), status: "finished", serverTime: 0 }} />
      </ServicesProvider>,
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Aliceyouhostconnected",
      "Rockycomputer · Hardconnected",
    ]);
  });
});

describe("ComputerNote", () => {
  it("says the computer is a computer, and that the game counts within the daily XP", () => {
    render(<ComputerNote room={room([PERSON, ROCKY])} />);

    expect(
      screen.getByText(/Rocky is a computer player\. This game counts for your quests/),
    ).toHaveTextContent("up to 100 XP a day from computer games. It never counts on leaderboards.");
  });

  it("says nothing in a game between people", () => {
    const { container } = render(<ComputerNote room={room([PERSON])} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("XP from computer games", () => {
  it.each([
    [{ source: "match", counted: true, botXpLeft: 40 }, true],
    [{ source: "match", counted: true }, false],
    [{ source: "match", counted: false, botXpLeft: 0 }, false],
    [{ source: "quest", counted: true, botXpLeft: 10 }, false],
  ])("%o is a counted computer game: %s", (update, expected) => {
    expect(isComputerGame(update)).toBe(expected);
  });

  it("says the XP and what is left today, or that the game still counts once it is used up", () => {
    expect(computerXpMessage({ xpGained: 30, botXpLeft: 40 })).toBe(
      "+30 XP · 40 XP left today from computer games",
    );
    expect(computerXpMessage({ xpGained: 0, botXpLeft: 0 })).toBe(
      "This game counts for your quests. You already have today's 100 XP from computer games",
    );
  });

  it("shows it as a toast after the game", async () => {
    const socket = fakeSocket();
    renderApp({ socket });
    await screen.findByRole("heading", { name: /Play the classics/ });

    act(() =>
      socket.push("progress:updated", {
        source: "match",
        xpGained: 10,
        leveledUp: false,
        counted: true,
        botXpLeft: 0,
        progress: { level: 1 },
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("+10 XP · 0 XP left today from computer games");
  });
});
