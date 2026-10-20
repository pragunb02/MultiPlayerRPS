import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal/Modal.jsx";
import { RequestCountdown } from "./RequestBanner/RequestBanner.jsx";
import { ShareRoom } from "./ShareRoom/ShareRoom.jsx";
import { ToastProvider } from "./Toast/ToastProvider.jsx";
import { TurnBanner } from "./TurnBanner/TurnBanner.jsx";
import { useHold, useToast } from "./Toast/toastContext.js";

const withToasts = (ui) => render(<ToastProvider>{ui}</ToastProvider>);

describe("ToastProvider", () => {
  afterEach(() => vi.useRealTimers());

  function Trigger() {
    const toast = useToast();
    return <button onClick={() => toast.show("+30 XP", { surface: "toast.xp" })}>notify</button>;
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

  describe("notification categories (CC-208)", () => {
    /** Hands the toast functions to the test. */
    function capture() {
      const api = {};
      function Grab() {
        Object.assign(api, useToast());
        return null;
      }
      render(
        <ToastProvider displayMs={1_000}>
          <Grab />
        </ToastProvider>,
      );
      return api;
    }
    const shown = () => screen.getByRole("status").textContent;

    it("shows the same message of a category only once within its rate limit", () => {
      vi.useFakeTimers({ now: 0 });
      const toast = capture();

      let first;
      let second;
      act(() => {
        first = toast.show("Link copied", { surface: "toast.xp" });
        second = toast.show("Link copied", { surface: "toast.xp" });
      });
      expect(second).toBe(first);
      expect(screen.getAllByText("Link copied")).toHaveLength(1);
      act(() => vi.advanceTimersByTime(5_000));
      act(() => toast.show("Link copied", { surface: "toast.xp" }));
      expect(screen.getAllByText("Link copied")).toHaveLength(1);
    });

    it("keeps rewards waiting while a request holds the screen, and shows them once it is gone", () => {
      vi.useFakeTimers({ now: 0 });
      const toast = capture();
      let release;
      act(() => {
        release = toast.hold("request");
      });

      act(() => toast.show("+30 XP", { surface: "toast.xp", category: "reward" }));
      act(() => toast.show("Bob is back", { surface: "toast.xp", category: "social" }));
      act(() => toast.show("Connection lost", { surface: "toast.xp", category: "system" }));
      expect(shown()).toBe("Connection lost");

      act(() => release());
      expect(shown()).toBe("Connection lost+30 XPBob is back");
      act(() => release());
      expect(shown()).toBe("Connection lost+30 XPBob is back");
    });

    it("tells a toast when it really shows, so what belongs to it waits with it (CC-163)", () => {
      vi.useFakeTimers({ now: 0 });
      const toast = capture();
      const shownNow = vi.fn();
      const shownLater = vi.fn();
      let release;

      act(() => toast.show("Link copied", { surface: "toast.xp", onShow: shownNow }));
      expect(shownNow).toHaveBeenCalledOnce();

      act(() => {
        release = toast.hold("result");
      });
      act(() => toast.show("Level up!", { surface: "toast.xp", category: "reward", onShow: shownLater }));
      expect(shownLater).not.toHaveBeenCalled();

      act(() => release());
      expect(shownLater).toHaveBeenCalledOnce();
    });

    it("keeps holding while another hold of the same kind is still on", () => {
      vi.useFakeTimers({ now: 0 });
      const toast = capture();
      let first;
      act(() => {
        first = toast.hold("request");
        toast.hold("request");
      });

      act(() => toast.show("+30 XP", { surface: "toast.xp", category: "reward" }));
      act(() => first());

      expect(shown()).toBe("");
    });

    it("forgets a waiting toast that is dismissed before its turn", () => {
      vi.useFakeTimers({ now: 0 });
      const toast = capture();
      let release;
      let id;
      act(() => {
        release = toast.hold("request");
        id = toast.show("+30 XP", { surface: "toast.xp", category: "reward" });
      });

      act(() => toast.dismiss(id));
      act(() => release());

      expect(shown()).toBe("");
    });

    it("holds rewards from the very step that draws the question (CC-288)", () => {
      // A reward that comes in the same step as the question, before any plain effect has run. A hold started in
      // a plain effect let it through and covered the question.
      function Question({ open }) {
        const toast = useToast();
        useHold("request", open);
        useLayoutEffect(() => {
          if (open) toast.show("+30 XP", { surface: "toast.xp", category: "reward" });
        }, [open, toast]);
        return open ? <p>Rematch?</p> : null;
      }
      const view = render(
        <ToastProvider displayMs={1_000}>
          <Question open={false} />
        </ToastProvider>,
      );

      view.rerender(
        <ToastProvider displayMs={1_000}>
          <Question open />
        </ToastProvider>,
      );

      expect(screen.getByText("Rematch?")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("");
    });

    it("refuses a category that does not exist", () => {
      const toast = capture();

      expect(() => toast.show("x", { surface: "toast.xp", category: "ads" })).toThrow(
        /Unknown notification category/,
      );
      expect(() => toast.hold("ads")).toThrow(/Unknown notification category/);
    });
  });
});

describe("Modal", () => {
  it("renders an accessible dialog, focuses it, and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal
        surface="dialog.feedback"
        open
        title="Leave the game?"
        onClose={onClose}
        actions={<button>Stay</button>}
      >
        <p>You will forfeit.</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Leave the game?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Stay" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("draws itself on the page's body, so no style of where it is opened can trap or grey it (CC-163)", () => {
    // A filter (the softened board after a loss) makes an element the frame of any fixed child inside it.
    render(
      <div data-testid="softened" className="dimmed">
        <Modal
          surface="dialog.feedback"
          open
          title="How we keep it fair"
          onClose={() => {}}
          actions={<button>Got it</button>}
        >
          <p>Sealed first.</p>
        </Modal>
      </div>,
    );

    const dialog = screen.getByRole("dialog", { name: "How we keep it fair" });
    expect(screen.getByTestId("softened")).not.toContainElement(dialog);
    expect(dialog.parentElement.parentElement).toBe(document.body);
  });

  it("renders nothing when closed", () => {
    render(
      <Modal surface="dialog.feedback" open={false} title="x" onClose={() => {}} actions={null}>
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
      "https://classicade.app/games/chess/rooms/AB2CD3?via=copy",
    );
    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith("https://classicade.app/games/chess/rooms/AB2CD3?via=copy");
    // The toast area is on the page from the start, and the words arrive a moment after the copy (CC-288).
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Link copied"));
  });

  it("offers WhatsApp with the invite and the room's link, in a new tab (CC-217)", () => {
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" origin="https://classicade.app" />);

    const link = screen.getByRole("link", { name: /WhatsApp/ });

    const message =
      "Ek game ho jaaye? ClassiCade pe Chess khelo, link kholo aur seedha khelo:\nPlay Chess with me on ClassiCade — room AB2CD3\nFree hai, login nahi chahiye.\nFree, no login needed.\nhttps://classicade.app/games/chess/rooms/AB2CD3?via=wa";
    expect(link).toHaveAttribute("href", `https://wa.me/?text=${encodeURIComponent(message)}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("data-cc-control", "invite.whatsapp");
  });

  it("builds the invite on the site's own address, not the one this page was opened at (CC-217)", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "classicade:site-origin");
    meta.setAttribute("content", "https://canonical.example");
    document.head.append(meta);
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" />);
    meta.remove();

    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      "https://canonical.example/games/chess/rooms/AB2CD3?via=copy",
    );
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

  it("hands the share sheet the room's link marked as a share sheet link (CC-279)", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { ...navigator, share });
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" origin="https://classicade.app" />);

    await user.click(screen.getByRole("button", { name: "Share…" }));

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://classicade.app/games/chess/rooms/AB2CD3?via=share" }),
    );
  });

  it("invites to 'a game' when this build doesn't know the game", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { ...navigator, share });
    withToasts(<ShareRoom code="AB2CD3" gameId="ludo" origin="https://classicade.app" />);

    await user.click(screen.getByRole("button", { name: "Share…" }));

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Ek game ho jaaye? ClassiCade pe khelo, link kholo aur seedha khelo:\nPlay a game with me on ClassiCade — room AB2CD3",
      }),
    );
  });

  it("says so when copying fails, so the player can copy by hand", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" origin="https://classicade.app" />);

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy. Select the link and copy it");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("selects the whole link when the field is focused, ready to copy", async () => {
    const user = userEvent.setup();
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" origin="https://classicade.app" />);
    const field = screen.getByRole("textbox", { name: "Invite link" });

    await user.click(field);

    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
  });

  it("copies the link when the browser refuses the share sheet for another reason", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn().mockRejectedValue(new DOMException("not allowed", "NotAllowedError")),
      clipboard: { writeText },
    });
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" origin="https://classicade.app" />);

    await user.click(screen.getByRole("button", { name: "Share…" }));

    expect(writeText).toHaveBeenCalledWith("https://classicade.app/games/chess/rooms/AB2CD3?via=copy");
    // The toast area is on the page from the start, and the words arrive a moment after the copy (CC-288).
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Link copied"));
  });

  it("closing the share sheet without sharing is not an error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")),
    });
    withToasts(<ShareRoom code="AB2CD3" gameId="chess" origin="https://classicade.app" />);

    await user.click(screen.getByRole("button", { name: "Share…" }));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("hides the share button where the browser has no share sheet", () => {
    vi.stubGlobal("navigator", { ...navigator, share: undefined });
    withToasts(<ShareRoom code="AB2CD3" gameId="rps" origin="https://x" />);

    expect(screen.queryByRole("button", { name: "Share…" })).toBeNull();
  });
});

describe("RequestCountdown (CC-160)", () => {
  it("shows an empty bar and 0:00 for a request whose time is already up", () => {
    render(<RequestCountdown request={{ createdAt: 1_000, expiresAt: 31_000 }} serverTime={40_000} />);

    expect(screen.getByRole("progressbar", { name: "Time left to answer" })).toHaveAttribute("value", "0");
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });
});

describe("TurnBanner", () => {
  const seats = [
    { playerId: "a", displayName: "Alice" },
    { playerId: "b", displayName: "Bob" },
  ];
  const playing = (you, activePlayers) => ({ you, status: "playing", seats, game: { activePlayers } });

  it.each([
    ["your turn", playing("a", ["a"]), "Your turn"],
    ["the opponent's turn", playing("a", ["b"]), "Waiting for Bob"],
    ["a spectator, both choosing", playing("", ["a", "b"]), "Waiting for Alice and Bob"],
    ["nobody named is active", playing("a", []), "Waiting for the other player"],
  ])("announces %s", (_case, room, text) => {
    render(<TurnBanner room={room} />);

    expect(screen.getByText(text)).toHaveAttribute("aria-live", "polite");
  });

  it.each([
    ["waiting", { you: "a", status: "waiting", seats }],
    ["finished", { ...playing("a", []), status: "finished" }],
    ["playing, before the game view arrives", { you: "a", status: "playing", seats }],
  ])("shows nothing while %s", (_case, room) => {
    const { container } = render(<TurnBanner room={room} />);

    expect(container).toBeEmptyDOMElement();
  });
});
