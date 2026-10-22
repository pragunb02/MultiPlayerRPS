import { expect, test } from "./fixtures.js";

// The shared components' rules that only a real browser can measure (CC-323): tap targets and focus rings.

test.describe("design system", () => {
  test("every footer link and the Feedback button is at least 24 px tall (WCAG 2.5.8)", async ({
    players,
  }) => {
    const { page } = await players.open("visitor");
    await page.goto("/privacy");
    const footer = page.getByRole("contentinfo");
    const targets = [
      ...(await footer.getByRole("link").all()),
      footer.getByRole("button", { name: "Feedback" }),
    ];
    expect(targets.length).toBeGreaterThanOrEqual(4);
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box.height, await target.textContent()).toBeGreaterThanOrEqual(24);
    }
  });

  test("a heading focused for screen readers when a page opens draws no ring for mouse and touch players", async ({
    players,
  }) => {
    const { page } = await players.open("visitor");
    await page.goto("/games/chess/rooms/ZZZZZZ");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeFocused();
    const outline = await heading.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).toBe("none");
  });
});
