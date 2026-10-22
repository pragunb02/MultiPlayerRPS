import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader, Section, Sections } from "./Page.jsx";

describe("PageHeader and Section (CC-323)", () => {
  it("draws the one page title in the shared type role, with its lede and art (AC-15)", () => {
    render(
      <PageHeader id="t" title="Leaderboards" lede="Top players by XP." aside={<svg data-testid="a" />} />,
    );
    const title = screen.getByRole("heading", { level: 1, name: "Leaderboards" });
    expect(title).toHaveClass("pageTitle");
    expect(title).toHaveAttribute("id", "t");
    expect(screen.getByText("Top players by XP.")).toHaveClass("lede");
    expect(screen.getByTestId("a")).toBeInTheDocument();
  });

  it("a page header needs only its title", () => {
    render(<PageHeader title="Design" className="x" />);
    expect(document.querySelector("header")).toHaveClass("pageHeader", "x");
    expect(document.querySelector(".lede")).toBeNull();
  });

  it("every section has a heading, one line saying what it holds, then the content (AC-16)", () => {
    render(
      <Sections>
        <Section title="Stats" description="Your games, all time." actions={<a href="/x">All</a>}>
          <p>12 wins</p>
        </Section>
        <Section title="Matches" headingLevel={3} id="m" className="c">
          <p>None</p>
        </Section>
      </Sections>,
    );
    const stats = screen.getByRole("region", { name: "Stats" });
    expect(stats).toHaveTextContent("Your games, all time.");
    expect(stats).toHaveTextContent("12 wins");
    expect(screen.getByRole("link", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Matches" })).toHaveAttribute("id", "m");
    expect(screen.getByRole("region", { name: "Matches" })).toHaveClass("section", "c");
    expect(document.querySelector(".sections").children).toHaveLength(2);
  });
});
