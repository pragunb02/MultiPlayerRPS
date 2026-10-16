import { describe, expect, it } from "vitest";
import { nextPath } from "./authNavigation.js";

describe("nextPath", () => {
  it.each([
    ["next=/room/AB2CD3", "/room/AB2CD3"],
    ["next=%2Fprofile", "/profile"],
    ["", "/"],
  ])("follows safe in-app paths (%s → %s)", (query, expected) => {
    expect(nextPath(new URLSearchParams(query))).toBe(expected);
  });

  it.each([
    "next=https://evil.example",
    "next=//evil.example",
    "next=/\\evil.example",
    "next=javascript:alert(1)",
  ])("refuses to leave the site (%s)", (query) => {
    expect(nextPath(new URLSearchParams(query))).toBe("/");
  });
});
