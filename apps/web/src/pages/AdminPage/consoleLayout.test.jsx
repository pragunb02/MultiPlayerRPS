import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Conversion, Retention } from "./sections.jsx";

// The console's layout rules (CC-323): every figure says what it counts and over which days, and a part with
// nothing to show says so.

const RANGE = Object.freeze({ from: "2025-03-03", to: "2025-03-09", bucket: "day" });

describe("owner console layout (CC-323)", () => {
  it("a table with no rows says so, under its unit and time window", () => {
    render(<Retention report={{ range: RANGE, retention: { cohorts: [] } }} />);

    const figure = screen.getByRole("figure", { name: "Cohort retention" });
    expect(figure).toHaveTextContent("In share of new players, from 2025-03-03 to 2025-03-09, India time.");
    expect(figure).toHaveTextContent("Nothing yet in this period.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("a chart with no bars says so to screen readers, and its section names the window", () => {
    render(
      <Conversion
        report={{
          range: RANGE,
          conversion: { rate: 0, guestsConverted: 0, accountsCreated: 0, legacyReturned: 0, series: [] },
        }}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Guests who saved progress. Nothing yet in this period." }),
    ).toBeVisible();
    expect(screen.getByRole("region", { name: "Conversion" })).toHaveTextContent(
      "From 2025-03-03 to 2025-03-09, India time.",
    );
    expect(screen.getByRole("heading", { level: 2, name: "Sign ups" })).toBeInTheDocument();
  });
});
