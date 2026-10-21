import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../../testing/render.jsx";

// CC-324: the Feedback dialog's code loads on its own, after the first page or on the first press.
describe("the Feedback dialog, loaded on its own", () => {
  afterEach(() => vi.useRealTimers());

  it("draws nothing until it is first opened, then opens from the footer", async () => {
    const user = userEvent.setup();
    renderApp();
    const footer = await screen.findByRole("contentinfo");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(within(footer).getByRole("button", { name: "Feedback" }));

    expect(await screen.findByRole("dialog", { name: /Send us feedback/ })).toBeVisible();
  });

  it("fetches its code once the page has been idle a moment, and still draws nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderApp();

    await act(() => vi.advanceTimersByTimeAsync(300));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
