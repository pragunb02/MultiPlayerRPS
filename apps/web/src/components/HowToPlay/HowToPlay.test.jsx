import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GAME_IDS } from "@classicade/shared";
import { gameView } from "../../games/registry.js";
import { HowToPlayButton, HowToPlayFold, HowToPlayLine, HowToPlayStrip } from "./HowToPlay.jsx";

const STEPS = Object.fromEntries(
  await Promise.all(Object.values(GAME_IDS).map(async (id) => [id, await gameView(id).loadHowToPlay()])),
);

const RPS_STEPS = [
  "You both pick rock, paper or scissors in secret.",
  "Rock beats scissors, scissors beat paper, paper beats rock.",
  "Win more than half of the rounds to take the match.",
];

const texts = (list) =>
  within(list)
    .getAllByRole("listitem")
    .map((step) => step.textContent);

describe("How to play (CC-259, CC-349)", () => {
  describe("the strip under the lobby's cards", () => {
    it("shows the game's steps in order under a heading", () => {
      render(<HowToPlayStrip gameId={GAME_IDS.RPS} steps={STEPS[GAME_IDS.RPS]} />);

      const strip = screen.getByRole("region", { name: "How to play" });
      expect(texts(strip)).toEqual(RPS_STEPS);
    });

    it.each([
      [GAME_IDS.RPS, "rps"],
      [GAME_IDS.TIC_TAC_TOE, "tictactoe"],
      [GAME_IDS.CHESS, "chess"],
    ])("draws each step's glyph for %s in the game's colour, hidden from screen readers", (gameId, tone) => {
      render(<HowToPlayStrip gameId={gameId} steps={STEPS[gameId]} />);

      for (const step of screen.getAllByRole("listitem")) {
        const glyph = step.querySelector("svg");
        expect(glyph).toHaveAttribute("aria-hidden", "true");
        expect(glyph).toHaveClass(tone);
        expect(glyph.children.length).toBeGreaterThan(0);
      }
    });

    it("shows nothing for a game the web app has no steps for", () => {
      const { container } = render(<HowToPlayStrip gameId="ludo" steps={[]} />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("the one line that opens in place", () => {
    it("is closed at first and says how many steps there are", () => {
      const { container } = render(<HowToPlayFold gameId={GAME_IDS.CHESS} steps={STEPS[GAME_IDS.CHESS]} />);

      const fold = container.querySelector("details");
      expect(fold).not.toHaveAttribute("open");
      expect(within(fold).getByText("How to play: 3 steps")).toBeVisible();
    });

    it("opens to the steps when the line is pressed", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <HowToPlayFold gameId={GAME_IDS.RPS} steps={STEPS[GAME_IDS.RPS]} className="placed" />,
      );

      await user.click(screen.getByText("How to play: 3 steps"));

      const fold = container.querySelector("details");
      expect(fold).toHaveAttribute("open");
      expect(fold).toHaveClass("placed");
      expect(texts(fold)).toEqual(RPS_STEPS);
    });

    it("puts each step's Hinglish first and the English under it on a page that speaks Hinglish", () => {
      render(<HowToPlayFold gameId={GAME_IDS.TIC_TAC_TOE} steps={STEPS[GAME_IDS.TIC_TAC_TOE]} bilingual />);

      const [first] = screen.getAllByRole("listitem");
      const [hinglish, english] = first.querySelectorAll("[lang]");
      expect(hinglish).toHaveAttribute("lang", "hi-Latn");
      expect(hinglish).toHaveTextContent("Baari baari 3 by 3 grid pe apna nishaan lagao.");
      expect(english).toHaveAttribute("lang", "en");
      expect(english).toHaveTextContent("Take turns putting your mark on the 3 by 3 grid.");
    });

    it("shows nothing for a game the web app has no steps for", () => {
      const { container } = render(<HowToPlayFold gameId="ludo" steps={[]} />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("the line for the flag's state", () => {
    const space = (container) => container.querySelector("[data-cc-slot='how-to-play-space']");

    it.each([
      ["unknown", STEPS[GAME_IDS.CHESS]],
      ["on", undefined],
    ])(
      "keeps the closed line's space, hidden, while the state is %s and the steps are %s",
      (state, steps) => {
        const { container } = render(<HowToPlayLine gameId={GAME_IDS.CHESS} state={state} steps={steps} />);

        expect(space(container)).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelector("details")).toBeNull();
      },
    );

    it("is the closed line once the answer is on and the steps are here", () => {
      const { container } = render(
        <HowToPlayLine gameId={GAME_IDS.CHESS} state="on" steps={STEPS[GAME_IDS.CHESS]} className="placed" />,
      );

      expect(space(container)).toBeNull();
      expect(container.querySelector("details")).toHaveClass("placed");
    });

    it("is nothing when the answer is off", () => {
      const { container } = render(<HowToPlayLine gameId={GAME_IDS.CHESS} state="off" steps={undefined} />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("the match's button and dialog", () => {
    it("opens a dialog titled for the game with its steps, and tells the match", async () => {
      const user = userEvent.setup();
      const onOpen = vi.fn();
      render(<HowToPlayButton gameId={GAME_IDS.CHESS} gameName="Chess" onOpen={onOpen} />);

      await user.click(await screen.findByRole("button", { name: "How to play" }));

      const dialog = screen.getByRole("dialog", { name: "How to play Chess" });
      expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
      expect(within(dialog).getByRole("button", { name: "Back to the game" })).toHaveFocus();
      expect(onOpen).toHaveBeenCalledOnce();
    });

    it.each([
      ["Back to the game", (user) => user.click(screen.getByRole("button", { name: "Back to the game" }))],
      ["Escape", (user) => user.keyboard("{Escape}")],
      ["a tap outside", (user) => user.click(document.querySelector("[data-cc-modal-backdrop]"))],
    ])("closes with %s and gives the focus back to the button", async (_how, close) => {
      const user = userEvent.setup();
      render(<HowToPlayButton gameId={GAME_IDS.RPS} gameName="Rock Paper Scissors" />);
      const button = await screen.findByRole("button", { name: "How to play" });

      await user.click(button);
      await close(user);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });

    it("shows no button for a game the web app has no steps for", () => {
      const { container } = render(<HowToPlayButton gameId="ludo" gameName="Ludo" />);

      expect(container).toBeEmptyDOMElement();
    });
  });
});
