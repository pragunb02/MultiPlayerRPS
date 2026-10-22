import { describe, expect, it } from "vitest";
import { formatCls, formatMs } from "./format.js";
import { changeWords, formatBudgetValue, formatRatio, routeName } from "./uxText.js";

describe("the UX page's words for numbers (CC-177)", () => {
  it("writes a hidden value in words, a missing one as no data, and each measure in its unit", () => {
    expect(formatBudgetValue("optional_per_visit", "<5")).toBe("fewer than 5");
    expect(formatBudgetValue("optional_per_visit", null)).toBe("no data");
    expect(formatBudgetValue("optional_per_visit", 0.934)).toBe("0.93");
    expect(formatBudgetValue("visits_with_three_or_more", 0.0667)).toBe("6.7%");
    expect(formatBudgetValue("first_move_p75_slower", 0.12)).toBe("+12.0%");
    expect(formatCls("<5")).toBe("fewer than 5");
    expect(formatCls(null)).toBe("no data");
    expect(formatCls(0.1)).toBe("0.10");
    expect(formatMs("<5")).toBe("fewer than 5");
    expect(formatMs(undefined)).toBe("no data");
    expect(formatMs(180)).toBe("180 ms");
    expect(formatMs(2500)).toBe("2.5 s");
  });

  it("says when a ratio is capped, and leaves a change out when a side is hidden", () => {
    expect(formatRatio({ ratio: 1, capped: true })).toBe("100.0% (capped)");
    expect(formatRatio({ ratio: 0.5, capped: false })).toBe("50.0%");
    expect(formatRatio({})).toBe("");
    expect(changeWords(null)).toBe("");
    expect(changeWords(undefined)).toBe("");
    expect(changeWords("new")).toBe("new");
    expect(routeName("not_found")).toBe("Not found page");
    expect(routeName("/")).toBe("/");
  });
});
