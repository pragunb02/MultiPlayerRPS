import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Tabs } from "./Tabs.jsx";

describe("Tabs (CC-323)", () => {
  it("is one named navigation of real links, the shown one marked as the current page (AC-13)", () => {
    render(
      <MemoryRouter>
        <Tabs
          label="Leaderboards"
          control="leaderboard.tab"
          current="weekly"
          items={[
            { id: "overall", label: "Overall", to: "/leaderboards/overall", icon: <svg data-testid="i" /> },
            { id: "weekly", label: "This week", to: "/leaderboards/weekly" },
          ]}
        />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Leaderboards" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Overall", "/leaderboards/overall"],
      ["This week", "/leaderboards/weekly"],
    ]);
    expect(links[1]).toHaveAttribute("aria-current", "page");
    expect(links[0]).not.toHaveAttribute("aria-current");
    expect(links[0]).toHaveAttribute("data-cc-control", "leaderboard.tab.overall");
    expect(screen.getByTestId("i").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});
