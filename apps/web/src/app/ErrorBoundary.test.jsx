import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

function Broken() {
  throw new Error("render failed");
}

/** Renders a page that crashes, with the two ways out faked. */
function renderCrash() {
  const onReload = vi.fn();
  const onHome = vi.fn();
  render(
    <ErrorBoundary onReload={onReload} onHome={onHome}>
      <Broken />
    </ErrorBoundary>,
  );
  return { onReload, onHome };
}

describe("ErrorBoundary", () => {
  let quiet;
  beforeEach(() => {
    quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => quiet.mockRestore());

  it("says in plain words that the page broke and that games and progress are safe (CL-01)", () => {
    renderCrash();

    expect(screen.getByRole("heading", { level: 1, name: "This page broke" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something on this page stopped working. Your games and progress are safe.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("render failed");
  });

  it("reloads the page from its first button", async () => {
    const { onReload, onHome } = renderCrash();

    await userEvent.click(screen.getByRole("button", { name: "Reload the page" }));

    expect(onReload).toHaveBeenCalledOnce();
    expect(onHome).not.toHaveBeenCalled();
  });

  it("goes to the home page from its second button", async () => {
    const { onReload, onHome } = renderCrash();

    await userEvent.click(screen.getByRole("button", { name: "Go to the home page" }));

    expect(onHome).toHaveBeenCalledOnce();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("reloads and goes home through the browser when nothing is passed in", async () => {
    const location = { reload: vi.fn(), assign: vi.fn() };
    vi.stubGlobal("location", location);
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reload the page" }));
    await userEvent.click(screen.getByRole("button", { name: "Go to the home page" }));

    expect(location.reload).toHaveBeenCalledOnce();
    expect(location.assign).toHaveBeenCalledWith("/");
    vi.unstubAllGlobals();
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
