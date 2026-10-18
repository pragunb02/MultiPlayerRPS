import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GAMES } from "@classicade/shared";
import { gameView } from "../../games/registry.js";
import { renderApp } from "../../testing/render.jsx";
import { HowToPlay } from "./HowToPlay.jsx";

const strip = () => screen.getByRole("region", { name: "How to play" });
const steps = () => within(strip()).getAllByRole("listitem");

describe("the lobby's How to play strip (CC-259)", () => {
  it.each(GAMES.map((game) => [game.name, game.id]))("gives %s three short steps", (_name, gameId) => {
    const entries = gameView(gameId).howToPlay;

    expect(entries).toHaveLength(3);
    for (const { text } of entries) {
      expect(text.split(" ").length).toBeLessThanOrEqual(14);
      expect(text).toMatch(/\.$/);
    }
  });

  it("shows the game's steps in order, under the lobby's cards", () => {
    renderApp({ path: "/games/rock-paper-scissors" });

    expect(steps().map((step) => step.textContent)).toEqual([
      "You both pick rock, paper or scissors in secret.",
      "Rock beats scissors, scissors beat paper, paper beats rock.",
      "Win more than half of the rounds to take the match.",
    ]);
  });

  it.each([
    ["rock-paper-scissors", "rps"],
    ["tic-tac-toe", "tictactoe"],
    ["chess", "chess"],
  ])(
    "draws each step's glyph on /games/%s in the game's colour, hidden from screen readers",
    (slug, tone) => {
      renderApp({ path: `/games/${slug}` });

      for (const step of steps()) {
        const glyph = step.querySelector("svg");
        expect(glyph).toHaveAttribute("aria-hidden", "true");
        expect(glyph).toHaveClass(tone);
        expect(glyph.children.length).toBeGreaterThan(0);
      }
    },
  );

  it("shows nothing for a game the web app has no steps for", () => {
    const { container } = render(<HowToPlay gameId="ludo" />);

    expect(container).toBeEmptyDOMElement();
  });
});
