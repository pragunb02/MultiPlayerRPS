import { describe, expect, it } from "vitest";
import { changeText, ratingText, spokenRating } from "./ratingText.js";

describe("chess rating words", () => {
  it("writes a provisional rating with a question mark", () => {
    expect(ratingText({ rating: 1500, provisional: true })).toBe("1500?");
    expect(ratingText({ rating: 1612, provisional: false })).toBe("1612");
  });

  it("says whether a rating is provisional to screen readers", () => {
    expect(spokenRating({ rating: 1500, provisional: true })).toBe("Rating 1500, provisional");
    expect(spokenRating({ rating: 1612, provisional: false })).toBe("Rating 1612");
  });

  it("writes a change with its sign and a real minus sign", () => {
    expect(changeText(12)).toBe("+12");
    expect(changeText(-8)).toBe("−8");
    expect(changeText(0)).toBe("±0");
  });
});
