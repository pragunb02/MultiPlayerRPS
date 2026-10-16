import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

function Broken() {
  throw new Error("render failed");
}

describe("ErrorBoundary", () => {
  it("shows a friendly message instead of a blank page", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    quiet.mockRestore();
  });

  it("renders children when nothing fails", () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("fine")).toBeInTheDocument();
  });
});
