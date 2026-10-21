import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LocationProbe } from "../../testing/LocationProbe.jsx";
import { ACCENT_TONES, CARD_VARIANTS, NOTICE_TONES } from "../looks.js";
import { Card, CardBody, CardFooter, CardHeader, CardLink, CardMedia } from "./Card.jsx";

describe("Card (CC-323)", () => {
  it("draws every variant with the one card surface, and its parts in order (AC-5)", () => {
    for (const variant of CARD_VARIANTS) {
      const tone = { accent: "rps", notice: "info" }[variant];
      const { unmount } = render(
        <Card variant={variant} tone={tone} aria-labelledby="t">
          <CardMedia>
            <svg data-testid="art" />
          </CardMedia>
          <CardHeader id="t" title="Rock Paper Scissors" description="2 players" aside={<span>New</span>} />
          <CardBody>Best of 3</CardBody>
          <CardFooter>
            <button type="button">Play</button>
          </CardFooter>
        </Card>,
      );
      const card = screen.getByRole("article", { name: "Rock Paper Scissors" });
      expect(card).toHaveClass("card", variant);
      expect(card).toHaveAttribute("data-cc-card", variant);
      expect(screen.getByRole("heading", { level: 3, name: "Rock Paper Scissors" })).toBeInTheDocument();
      expect(screen.getByTestId("art").parentElement).toHaveClass("media");
      expect(screen.getByTestId("art").parentElement).toHaveAttribute("aria-hidden", "true");
      expect(card.lastElementChild).toHaveClass("footer");
      unmount();
    }
    expect(ACCENT_TONES).toEqual(["primary", "rps", "tictactoe", "chess", "gold"]);
    expect(NOTICE_TONES).toEqual(["info", "success", "warning", "danger"]);
  });

  it("refuses a tone that does not fit its variant", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Card variant="flat">x</Card>)).toThrow(/variant "flat"/);
    expect(() => render(<Card variant="accent">x</Card>)).toThrow(/tone "undefined"/);
    expect(() =>
      render(
        <Card variant="notice" tone="rps">
          x
        </Card>,
      ),
    ).toThrow(/tone "rps"/);
    expect(() => render(<Card tone="info">x</Card>)).toThrow(/tone "info"/);
  });

  it("an interactive card lifts on hover and follows its one stretched link from anywhere (AC-6)", async () => {
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <Card interactive as="li">
          <CardHeader
            title={
              <CardLink to="/games/chess" control="home.game.chess">
                Chess
              </CardLink>
            }
          />
        </Card>
        <LocationProbe onChange={onChange} onNavigator={() => {}} />
      </MemoryRouter>,
    );
    const card = screen.getByRole("listitem");
    expect(card).toHaveClass("interactive");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole("link", { name: "Chess" }));
    expect(onChange).toHaveBeenLastCalledWith("/games/chess");
  });

  it("shows selected and cannot-act states, the reason in words (AC-6)", () => {
    render(
      <>
        <Card selected aria-label="picked">
          Picked
        </Card>
        <Card interactive reason="Sign in to play ranked." aria-label="locked">
          Ranked
        </Card>
      </>,
    );
    expect(screen.getByRole("article", { name: "picked" })).toHaveAttribute("data-selected", "true");
    const locked = screen.getByRole("article", { name: "locked" });
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).not.toHaveClass("interactive");
    expect(locked).toHaveTextContent("Sign in to play ranked.");
  });

  it("adds no landmark of its own, even as a list item (CC-323)", () => {
    render(
      <ul>
        <Card as="li">
          <CardHeader title="Chess" />
          <CardFooter>Play</CardFooter>
        </Card>
      </ul>,
    );
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("gives a header without an id its own, and parts take extra classes", () => {
    render(
      <Card as="section">
        <CardMedia className="wide">
          <svg />
        </CardMedia>
        <CardHeader title="Quests" titleAs="h2" />
        <CardBody className="b">x</CardBody>
        <CardFooter className="f">y</CardFooter>
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Quests" }).id).not.toBe("");
    expect(document.querySelector(".media")).toHaveClass("wide");
    expect(document.querySelector(".body")).toHaveClass("b");
    expect(document.querySelector(".footer")).toHaveClass("f");
  });
});
