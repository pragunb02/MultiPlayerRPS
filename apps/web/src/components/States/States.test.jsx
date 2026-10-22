import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SKELETON_SHAPES } from "../looks.js";
import { EmptyState, ErrorState, Skeleton } from "./States.jsx";

describe("EmptyState (CC-323)", () => {
  it("shows art hidden from readers, a real heading, one line and one way on (AC-7)", () => {
    render(
      <EmptyState
        title="No friends yet"
        art={<svg data-testid="art" />}
        action={<button type="button">Add a friend</button>}
        secondary={<a href="/">Back home</a>}
      >
        Friends you add show up here.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "No friends yet" })).toBeInTheDocument();
    expect(screen.getByTestId("art").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Friends you add show up here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a friend" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back home" })).toBeInTheDocument();
  });

  it("is the page's own title on a dead end, and needs no art or button", () => {
    render(<EmptyState title="Page not found" headingLevel={1} />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toHaveClass("pageTitle");
    expect(document.querySelector("[data-cc-state='empty'] p")).toBeNull();
  });
});

describe("ErrorState (CC-323)", () => {
  it("is an alert that says what failed and offers Retry when it can help (AC-8)", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState title="Couldn't load the leaderboard." control="leaderboard.load" onRetry={onRetry}>
        Check your connection.
      </ErrorState>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load the leaderboard.Check your connection.",
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toHaveAttribute("data-cc-control", "leaderboard.load.retry");
    await userEvent.setup().click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("has no Retry when trying again cannot help", () => {
    render(<ErrorState title="This link has expired." control="x" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Skeleton (CC-323)", () => {
  it("is one busy status with its label, and shapes hidden from readers that reserve the room (AC-9)", () => {
    render(<Skeleton label="Loading the leaderboard" shape="row" count={5} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading the leaderboard");
    const bones = status.querySelectorAll("[aria-hidden='true']");
    expect(bones).toHaveLength(5);
    for (const bone of bones) expect(bone).toHaveClass("bone", "bone-row");
  });

  it("has a shape for every kind of content, and refuses others", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(SKELETON_SHAPES).toEqual(["line", "row", "tile", "card", "board", "block"]);
    render(<Skeleton label="Loading" />);
    expect(screen.getByRole("status").querySelectorAll(".bone-line")).toHaveLength(1);
    expect(() => render(<Skeleton label="x" shape="blob" />)).toThrow(/shape "blob"/);
  });
});
