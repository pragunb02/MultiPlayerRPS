import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../../testing/render.jsx";
import { LazyFeedbackDialog } from "./LazyFeedbackDialog.jsx";

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

  // CC-324 review: a chunk that failed while the dialog was wanted left Feedback open and invisible for good.
  it("undoes a press whose chunk fails, so the next press loads it again and opens the dialog", async () => {
    const user = userEvent.setup();
    const Stub = ({ open }) => (open ? <div role="dialog" aria-label="Send us feedback" /> : null);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValue(Stub);
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Feedback
          </button>
          <LazyFeedbackDialog open={open} onClose={() => setOpen(false)} load={load} />
        </>
      );
    }
    render(<Harness />);
    // The prefetch fails too: nothing changes.
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Feedback" }));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Feedback" }));

    expect(await screen.findByRole("dialog", { name: "Send us feedback" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("fetches its code once the page has been idle a moment, and still draws nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderApp();

    await act(() => vi.advanceTimersByTimeAsync(300));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
