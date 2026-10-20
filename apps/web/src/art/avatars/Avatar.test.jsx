import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AVATARS } from "@classicade/shared";
import { Avatar } from "./Avatar.jsx";
import { AVATAR_ART } from "./avatarArt.js";

const markupOf = (props) => render(<Avatar {...props} />).container.innerHTML;

describe("Avatar (CC-034)", () => {
  it("has a drawing for every avatar of the catalogue, and none the catalogue lacks", () => {
    expect(Object.keys(AVATAR_ART).sort()).toEqual(AVATARS.map((avatar) => avatar.id).sort());
  });

  it("draws every avatar differently, and differently from the silhouette", () => {
    const drawings = [...AVATARS.map((avatar) => markupOf({ avatar: avatar.id })), markupOf({})];

    expect(new Set(drawings).size).toBe(AVATARS.length + 1);
  });

  it("draws the silhouette for no avatar and for any id it does not know", () => {
    const silhouette = markupOf({});

    expect(markupOf({ avatar: "not-an-avatar" })).toBe(silhouette);
    expect(markupOf({ avatar: "constructor" })).toBe(silhouette);
  });

  it("is decoration without a title, and a named picture with one", () => {
    const { container, getByRole } = render(
      <>
        <Avatar avatar="owl" />
        <Avatar avatar="fox" title="Fox" />
      </>,
    );

    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    expect(getByRole("img", { name: "Fox" })).toBeInTheDocument();
  });

  it("is drawn at the size asked, with no style attribute anywhere (CSP)", () => {
    const { container } = render(<Avatar avatar="rocket" size={96} className="extra" />);
    const svg = container.querySelector("svg");

    expect(svg.getAttribute("width")).toBe("96");
    expect(svg.getAttribute("class")).toContain("extra");
    expect(container.querySelector("[style]")).toBeNull();
  });
});
