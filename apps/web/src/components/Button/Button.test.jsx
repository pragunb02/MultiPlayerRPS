import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_TIMING, useAction } from "../../hooks/useAction.js";
import { EXPLAIN_FOR_MS } from "../../hooks/useExplanation.js";
import { AppRequestError } from "../../lib/errors.js";
import { Button } from "./Button.jsx";

/** A button with its own action, as a page would write it. */
function WithAction({ fn, ...props }) {
  const action = useAction(fn, { id: "test.go" });
  return (
    <Button control="test.go" action={action} {...props}>
      Go
    </Button>
  );
}

describe("Button (CC-164)", () => {
  afterEach(() => vi.useRealTimers());

  it("carries its stable control name and the click sound marker", () => {
    render(<Button control="room.leave">Leave room</Button>);

    const button = screen.getByRole("button", { name: "Leave room" });
    expect(button).toHaveAttribute("data-cc-control", "room.leave");
    expect(button).toHaveAttribute("data-sound", "click");
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toHaveAttribute("aria-disabled");
  });

  it("runs onClick when given", async () => {
    const onClick = vi.fn();
    render(
      <Button control="x" onClick={onClick}>
        Press
      </Button>,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Press" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does nothing on a press without onClick or action", async () => {
    render(<Button control="x">Press</Button>);

    await userEvent.setup().click(screen.getByRole("button", { name: "Press" }));

    expect(screen.getByRole("button", { name: "Press" })).toBeInTheDocument();
  });

  it("stays focusable when it cannot act, and says why on a press instead of doing nothing", async () => {
    const onClick = vi.fn();
    render(
      <Button control="x" reason="Not your turn" onClick={onClick}>
        Offer draw
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Offer draw" });

    await userEvent.setup().click(button);

    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription("Not your turn");
    expect(screen.getByRole("status")).toHaveTextContent("Not your turn");
    expect(screen.getAllByText("Not your turn")[0]).toHaveClass("tip", "shown");
  });

  it("puts the reason away again after a moment", () => {
    vi.useFakeTimers();
    render(
      <Button control="x" reason="Reconnecting">
        Rematch
      </Button>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rematch" }));
    act(() => vi.advanceTimersByTime(EXPLAIN_FOR_MS));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByText("Reconnecting")).not.toHaveClass("shown");
  });

  it("never sends its form while it cannot act", () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button control="lobby.join" type="submit" reason="Enter the room code">
          Join room
        </Button>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Join room" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves a submit press with an action to its form", () => {
    const fn = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <WithAction fn={fn} type="submit" />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(fn).not.toHaveBeenCalled();
  });

  it("shows a spinner and the waiting words after 400 ms, keeping the label in place for its width", () => {
    vi.useFakeTimers();
    render(<WithAction fn={() => new Promise(() => {})} pendingLabel="Creating…" />);
    const button = screen.getByRole("button", { name: "Go" });

    fireEvent.click(button);
    expect(button).not.toHaveAttribute("aria-busy");
    act(() => vi.advanceTimersByTime(399));
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toHaveAccessibleName("Go");
    act(() => vi.advanceTimersByTime(1));

    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAccessibleName("Creating…");
    expect(button.querySelector(".spinner")).not.toBeNull();
    expect(button).toHaveTextContent("Go");
  });

  it("keeps the waiting words at least 300 ms, so an answer at 410 ms does not make them flash (CC-239)", async () => {
    vi.useFakeTimers();
    let answer;
    render(<WithAction fn={() => new Promise((resolve) => (answer = resolve))} doneLabel="Copied" />);
    const button = screen.getByRole("button", { name: "Go" });

    fireEvent.click(button);
    act(() => vi.advanceTimersByTime(410));
    await act(async () => answer("ok"));

    expect(button).toHaveAccessibleName("Sending…");
    act(() => vi.advanceTimersByTime(ACTION_TIMING.PENDING_AT_LEAST_MS - 11));
    expect(button).toHaveAccessibleName("Sending…");
    act(() => vi.advanceTimersByTime(1));
    expect(button).toHaveAccessibleName("Copied");
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("shows a check with the done words where nothing else changes", async () => {
    vi.useFakeTimers();
    render(<WithAction fn={async () => "ok"} doneLabel="Copied" />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Go" })));

    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(ACTION_TIMING.DONE_FOR_MS));
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("explains a failure under the button, with Retry when trying again can help", async () => {
    const user = userEvent.setup();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new AppRequestError({ code: "NETWORK", message: "Can't reach ClassiCade" }))
      .mockResolvedValue("ok");
    render(<WithAction fn={fn} />);

    await user.click(screen.getByRole("button", { name: "Go" }));
    const retry = await screen.findByRole("button", { name: "Retry" });

    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach ClassiCade");
    expect(retry).toHaveAttribute("data-cc-control", "test.go.retry");
    await user.click(retry);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a refusal without a Retry that could only fail the same way", async () => {
    const user = userEvent.setup();
    render(<WithAction fn={vi.fn().mockRejectedValue(new Error("Nobody asked you for a rematch"))} />);

    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nobody asked you for a rematch");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("lets onClick decide while the action only shows the phases", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { result } = renderHook(() => useAction(() => new Promise(() => {}), { id: "x" }));
    const { rerender } = render(
      <Button control="x" action={result.current} onClick={onClick}>
        Resign
      </Button>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resign" }));
    act(() => {
      result.current.run();
    });
    act(() => vi.advanceTimersByTime(ACTION_TIMING.PENDING_AFTER_MS));
    rerender(
      <Button control="x" action={result.current} onClick={onClick}>
        Resign
      </Button>,
    );

    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Sending…" })).toHaveAttribute("aria-busy", "true");
  });
});
