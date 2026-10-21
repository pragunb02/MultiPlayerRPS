import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// CC-323: the Feedback form is its own file, asked for when the page is idle so a press opens it at once.

afterEach(() => {
  vi.doUnmock("./FeedbackForm.jsx");
  vi.unstubAllGlobals();
  vi.resetModules();
});

const fakeForm = () => ({
  FeedbackForm: ({ open }) => <p data-testid="form">{open ? "open" : "closed"}</p>,
});

describe("FeedbackDialog loading", () => {
  it("asks for the form when the browser is idle, before any press, and draws nothing until it opens", async () => {
    vi.doMock("./FeedbackForm.jsx", fakeForm);
    const idle = vi.fn((work) => {
      work();
      return 7;
    });
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const { FeedbackDialog } = await import("./FeedbackDialog.jsx");

    const { rerender, queryByTestId, unmount } = render(<FeedbackDialog open={false} onClose={() => {}} />);
    await act(async () => {});
    expect(idle).toHaveBeenCalledOnce();
    expect(queryByTestId("form")).toBeNull();

    rerender(<FeedbackDialog open onClose={() => {}} />);
    expect(queryByTestId("form")).toHaveTextContent("open");
    rerender(<FeedbackDialog open={false} onClose={() => {}} />);
    expect(queryByTestId("form")).toHaveTextContent("closed");
    unmount();

    // A dialog drawn later finds the form already here.
    const again = render(<FeedbackDialog open onClose={() => {}} />);
    expect(again.getByTestId("form")).toHaveTextContent("open");
  });

  it("cancels the idle request when the page goes before it runs", async () => {
    vi.doMock("./FeedbackForm.jsx", fakeForm);
    const cancel = vi.fn();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn(() => 3),
    );
    vi.stubGlobal("cancelIdleCallback", cancel);
    const { FeedbackDialog } = await import("./FeedbackDialog.jsx");

    render(<FeedbackDialog open={false} onClose={() => {}} />).unmount();
    expect(cancel).toHaveBeenCalledWith(3);
  });

  it("asks again on the next opening when the form could not be downloaded", async () => {
    let fail = true;
    vi.doMock("./FeedbackForm.jsx", () => {
      if (fail) throw new Error("offline");
      return fakeForm();
    });
    const { FeedbackDialog } = await import("./FeedbackDialog.jsx");

    const first = render(<FeedbackDialog open onClose={() => {}} />);
    await act(async () => {});
    expect(first.queryByTestId("form")).toBeNull();
    first.unmount();

    fail = false;
    vi.resetModules();
    const second = render(<FeedbackDialog open onClose={() => {}} />);
    await act(async () => {});
    expect(second.getByTestId("form")).toHaveTextContent("open");
  });
});
