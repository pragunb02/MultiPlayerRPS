import { act, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_TIMING, useAction } from "../../hooks/useAction.js";
import { BUTTON_SIZES, BUTTON_VARIANTS } from "../looks.js";
import { Button } from "./Button.jsx";

describe("Button looks, sizes and forms (CC-323)", () => {
  afterEach(() => vi.useRealTimers());

  it("draws each variant and size, and marks its look for the one-primary-per-region check (AC-1)", () => {
    for (const variant of BUTTON_VARIANTS) {
      for (const size of BUTTON_SIZES) {
        const { unmount } = render(
          <Button control={`x.${variant}.${size}`} variant={variant} size={size}>
            Go
          </Button>,
        );
        const button = screen.getByRole("button", { name: "Go" });
        expect(button).toHaveClass(variant, size);
        expect(button).toHaveAttribute("data-cc-variant", variant);
        unmount();
      }
    }
    expect(BUTTON_VARIANTS).toEqual(["primary", "accent", "secondary", "ghost", "danger"]);
    expect(BUTTON_SIZES).toEqual(["sm", "md", "lg"]);
  });

  it("refuses an unknown variant or size, so a typo fails its first test", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Button control="x" variant="loud" />)).toThrow(/variant "loud"/);
    expect(() => render(<Button control="x" size="xl" />)).toThrow(/size "xl"/);
  });

  it("renders a real router link with as=link and to, drawn as a button (AC-2)", () => {
    render(
      <MemoryRouter>
        <Button as="link" to="/games/chess" control="home.play" variant="secondary" size="sm">
          Play chess
        </Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Play chess" });
    expect(link).toHaveAttribute("href", "/games/chess");
    expect(link).toHaveAttribute("data-cc-control", "home.play");
    expect(link).toHaveClass("button", "secondary", "sm");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders an <a> for an address outside the app, and needs somewhere to go (AC-2)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Button as="link" href="https://wa.me/?text=hi" control="share.wa" variant="ghost">
        WhatsApp
      </Button>,
    );
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/?text=hi");
    expect(() =>
      render(
        <Button as="link" control="nowhere">
          Nowhere
        </Button>,
      ),
    ).toThrow(/needs a to or an href/);
  });

  it("a link that cannot go yet is a button with its reason, never a dead link", () => {
    render(
      <Button as="link" to="/x" control="x" reason="Finish the game first.">
        Leave
      </Button>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave" })).toHaveAttribute("aria-disabled", "true");
  });

  it("an icon-only button is named by its label, and refuses to render without one (AC-3)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Button control="x.close" variant="ghost" icon={<svg data-testid="icon" />} label="Close" />);
    const button = screen.getByRole("button", { name: "Close" });
    expect(button).toHaveClass("iconOnly");
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(() => render(<Button control="x" icon={<svg />} />)).toThrow(/needs a label/);
  });

  it("an icon beside text keeps the text as the name, and a link can be icon-only too", () => {
    render(
      <MemoryRouter>
        <Button control="x" icon={<svg />}>
          Share
        </Button>
        <Button as="link" to="/x" control="y" icon={<svg />} label="Open" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Share" })).not.toHaveClass("iconOnly");
    expect(screen.getByRole("link", { name: "Open" })).toHaveClass("iconOnly");
  });

  it("keeps the loading state of CC-164 on every variant: busy, and the label kept for the width (AC-4)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAction(() => new Promise(() => {}), { id: "x" }));
    const { rerender } = render(
      <Button control="x" variant="danger" action={result.current}>
        Delete
      </Button>,
    );
    act(() => {
      result.current.run();
    });
    act(() => vi.advanceTimersByTime(ACTION_TIMING.PENDING_AFTER_MS));
    rerender(
      <Button control="x" variant="danger" action={result.current}>
        Delete
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Sending…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Delete").closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
  });
});
