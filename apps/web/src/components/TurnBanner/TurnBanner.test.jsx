import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TurnBanner } from "./TurnBanner.jsx";

// Whose turn it is uses the player roles of the design contract (docs/design/CONTRACT.md, CC-314, AC-8): "you" and
// "opponent", always with a word and the seat marker's dot, never colour alone.

const CSS = readFileSync(path.join(import.meta.dirname, "TurnBanner.module.css"), "utf8");
const ruleOf = (selector) => new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? "";

const seats = [
  { playerId: "a", displayName: "Riya" },
  { playerId: "b", displayName: "Guest-ABCD" },
];
const playing = (you, activePlayers) => ({ you, status: "playing", seats, game: { activePlayers } });

describe("TurnBanner", () => {
  it("turn uses the player role and a word", () => {
    const { rerender } = render(<TurnBanner room={playing("a", ["a"])} />);
    const yours = screen.getByText("Your turn");
    expect(yours).toHaveAttribute("data-turn", "you");
    expect(yours).toHaveClass("you");

    rerender(<TurnBanner room={playing("a", ["b"])} />);
    const theirs = screen.getByText("Waiting for Guest-ABCD");
    expect(theirs).toHaveAttribute("data-turn", "opponent");
    expect(theirs).toHaveClass("opponent");

    expect(ruleOf("you")).toMatch(/background: var\(--color-you\)/);
    expect(ruleOf("you")).toMatch(/color: var\(--color-on-you\)/);
    expect(ruleOf("opponent")).toMatch(/background: var\(--color-opponent-soft\)/);
    expect(ruleOf("opponent")).toMatch(/color: var\(--color-opponent\)/);
    // The seat marker's dot, in the text's colour, so the shape and the word carry the meaning too.
    expect(ruleOf("banner::before")).toMatch(/border-radius: var\(--radius-full\)/);
    expect(ruleOf("banner::before")).toMatch(/background: currentColor/);
  });

  it("stays neutral for a spectator, who is neither player", () => {
    render(<TurnBanner room={playing("", ["a", "b"])} />);
    const banner = screen.getByText("Waiting for Riya and Guest-ABCD");
    expect(banner).toHaveAttribute("data-turn", "watching");
    expect(banner).not.toHaveClass("you");
    expect(banner).not.toHaveClass("opponent");
  });

  it("lights the turn of the player holding a shared phone as theirs", () => {
    render(<TurnBanner room={{ ...playing("b", ["b"]), sharedScreen: true }} />);
    expect(screen.getByText("Guest-ABCD's turn")).toHaveAttribute("data-turn", "you");
  });
});
