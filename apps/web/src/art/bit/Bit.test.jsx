import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMatchMedia } from "../../testing/matchMedia.js";
import { Bit } from "./Bit.jsx";
import { BIT_POSE_NAMES, BIT_POSES } from "./bitPoses.js";

const svgOf = (container) => container.querySelector("svg");

describe("Bit", () => {
  beforeEach(() => {
    installMatchMedia({ reducedMotion: false });
  });

  it("has the six poses of the story scripts", () => {
    expect(BIT_POSES).toEqual(["idle", "happy", "sad", "thinking", "surprised", "cheer"]);
  });

  it.each(BIT_POSES)("draws the %s pose as an image named after it", (pose) => {
    const { container } = render(<Bit pose={pose} />);

    const image = screen.getByRole("img", { name: BIT_POSE_NAMES[pose] });
    expect(image.querySelector(`[data-pose="${pose}"]`)).not.toBeNull();
    expect(svgOf(container).querySelectorAll("path, rect, circle").length).toBeGreaterThan(10);
  });

  it("gives every pose its own drawing", () => {
    const drawings = BIT_POSES.map((pose) => {
      const { container, unmount } = render(<Bit pose={pose} />);
      const markup = svgOf(container).querySelector("[data-pose]").innerHTML;
      unmount();
      return markup;
    });

    expect(new Set(drawings).size).toBe(BIT_POSES.length);
  });

  it("is idle and 64 pixels square unless told otherwise", () => {
    const { container } = render(<Bit />);

    const svg = svgOf(container);
    expect(svg.querySelector('[data-pose="idle"]')).not.toBeNull();
    expect(svg).toHaveAttribute("width", "64");
    expect(svg).toHaveAttribute("height", "64");
  });

  it("takes another size, a class and its own accessible name", () => {
    render(<Bit pose="happy" size={128} title="Bit cheers you on" className="extra" />);

    const image = screen.getByRole("img", { name: "Bit cheers you on" });
    expect(image).toHaveAttribute("width", "128");
    expect(image).toHaveClass("bit", "extra");
  });

  it("is hidden from screen readers and never focusable when decorative", () => {
    const { container } = render(<Bit pose="thinking" decorative />);

    const svg = svgOf(container);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).not.toHaveAttribute("role");
    expect(svg.querySelector("title")).toBeNull();
  });

  it("uses no style attribute or style element (strict CSP)", () => {
    const { container } = render(
      <>
        {BIT_POSES.map((pose) => (
          <Bit key={pose} pose={pose} />
        ))}
      </>,
    );

    expect(container.querySelectorAll("[style], style")).toHaveLength(0);
  });

  it("hops when it appears if the player allows motion", () => {
    const { container } = render(<Bit pose="thinking" />);

    expect(svgOf(container).querySelector(".alive")).not.toBeNull();
  });

  it("stays still when the player asked for reduced motion, and follows a change of the setting", () => {
    const media = installMatchMedia({ reducedMotion: true });
    const { container } = render(<Bit pose="happy" />);
    expect(svgOf(container).querySelector(".alive")).toBeNull();

    act(() => media.setReducedMotion(false));

    expect(svgOf(container).querySelector(".alive")).not.toBeNull();
  });

  it("refuses a pose it does not have, naming the ones it has", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Bit pose="angry" />)).toThrow(RangeError);
    expect(() => render(<Bit pose="angry" />)).toThrow(/idle, happy, sad, thinking, surprised, cheer/);

    vi.restoreAllMocks();
  });
});
