import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal/Modal.jsx";
import { Seats } from "./Seats/Seats.jsx";
import { ShareRoom } from "./ShareRoom/ShareRoom.jsx";
import { ToastProvider } from "./Toast/ToastProvider.jsx";
import { useToast } from "./Toast/toastContext.js";

const withToasts = (ui) => render(<ToastProvider>{ui}</ToastProvider>);

describe("ToastProvider", () => {
  afterEach(() => vi.useRealTimers());

  function Trigger() {
    const toast = useToast();
    return <button onClick={() => toast.show("+30 XP")}>notify</button>;
  }

  it("announces toasts politely and removes them after a while", async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider displayMs={1_000}>
        <Trigger />
      </ToastProvider>,
    );

    act(() => screen.getByText("notify").click());
    expect(screen.getByRole("status")).toHaveTextContent("+30 XP");

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("requires a provider", () => {
    expect(() => render(<Trigger />)).toThrow(/inside <ToastProvider>/);
  });
});

describe("Modal", () => {
  it("renders an accessible dialog, focuses it, and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="Leave the game?" onClose={onClose} actions={<button>Stay</button>}>
        <p>You will forfeit.</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Leave the game?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Stay" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders nothing when closed", () => {
    render(
      <Modal open={false} title="x" onClose={() => {}} actions={null}>
        hidden
      </Modal>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ShareRoom", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the code and link, and copies the link", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" origin="https://classicade.app" />);

    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      "https://classicade.app/games/chess/rooms/AB2CD3",
    );
    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith("https://classicade.app/games/chess/rooms/AB2CD3");
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
  });

  it("names the actual game in the share text (regression: BUG-12)", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { ...navigator, share });
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" origin="https://classicade.app" />);

    await user.click(screen.getByRole("button", { name: "Share…" }));

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Play Chess with me") }),
    );
  });

  it("hides the share button where the browser has no share sheet", () => {
    vi.stubGlobal("navigator", { ...navigator, share: undefined });
    withToasts(<ShareRoom code="AB2CD3" gameId="rps" origin="https://x" />);

    expect(screen.queryByRole("button", { name: "Share…" })).toBeNull();
  });
});

describe("Seats", () => {
  it("lists players with you/host tags, connection state and open seats", () => {
    render(
      <Seats
        room={{
          hostId: "guest_a",
          you: "guest_b",
          players: { min: 2, max: 3 },
          seats: [
            { playerId: "guest_a", displayName: "Alice", connected: false },
            { playerId: "guest_b", displayName: "Bob", connected: true },
          ],
        }}
      />,
    );

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Alicehostdisconnected", "Bobyou", "Waiting for a player…"]);
  });
});
