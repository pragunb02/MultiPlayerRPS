import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RatingBadge, RatingChanges } from "./Rating.jsx";

describe("chess rating display", () => {
  it("names the rating and whether it is provisional for screen readers", () => {
    render(<RatingBadge rating={{ rating: 1500, provisional: true }} />);

    expect(screen.getByRole("img", { name: "Rating 1500, provisional" })).toHaveTextContent("1500?");
  });

  it("lists the new rating and the change of each player the game rated", () => {
    render(
      <RatingChanges
        players={[
          { name: "You", rating: { rating: 1662, provisional: true, change: 162 } },
          { name: "Riya", rating: { rating: 1588, provisional: false, change: -12 } },
        ]}
      />,
    );

    const [you, riya] = within(screen.getByRole("list", { name: "Rating changes" })).getAllByRole("listitem");
    expect(you).toHaveTextContent("You1662+162Provisional");
    expect(riya).toHaveTextContent("Riya1588−12");
    expect(riya).not.toHaveTextContent("Provisional");
  });

  it("shows nothing for a game that changed no rating", () => {
    const { container } = render(
      <RatingChanges players={[{ name: "You", rating: { rating: 1500, provisional: true } }]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
