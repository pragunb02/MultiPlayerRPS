import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installMatchMedia } from "../testing/matchMedia.js";
import { useReducedMotion } from "./useReducedMotion.js";

function Probe() {
  return <p>{useReducedMotion() ? "still" : "moving"}</p>;
}

describe("useReducedMotion", () => {
  it("is false when the system allows motion", () => {
    installMatchMedia({ reducedMotion: false });

    render(<Probe />);

    expect(screen.getByText("moving")).toBeInTheDocument();
  });

  it("is true when the player asked for reduced motion", () => {
    installMatchMedia({ reducedMotion: true });

    render(<Probe />);

    expect(screen.getByText("still")).toBeInTheDocument();
  });

  it("follows the setting when it changes while the page is open", () => {
    const media = installMatchMedia({ reducedMotion: false });
    render(<Probe />);

    act(() => media.setReducedMotion(true));
    expect(screen.getByText("still")).toBeInTheDocument();

    act(() => media.setReducedMotion(false));
    expect(screen.getByText("moving")).toBeInTheDocument();
  });

  it("stops listening when the component goes away", () => {
    const media = installMatchMedia();
    const { unmount } = render(<Probe />);
    expect(media.listenerCount()).toBe(1);

    unmount();

    expect(media.listenerCount()).toBe(0);
  });
});
