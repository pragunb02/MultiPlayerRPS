import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { ADULT_SAFETY, fakeApi, MINOR_SAFETY } from "../../testing/fakes.js";
import { ToastProvider } from "../Toast/ToastProvider.jsx";
import { ShareResult } from "./ShareResult.jsx";

const ORIGIN = "https://classicade.example";
const ME = { playerId: "guest_me12345", displayName: "Guest-ME12", connected: true };
const ROCKY = {
  playerId: "bot_rocky_easy",
  displayName: "Rocky",
  connected: true,
  bot: { character: "rocky", level: "easy" },
};
const room = (overrides = {}) => ({
  code: "AB2CD3",
  gameId: "rps",
  status: "finished",
  seats: [ME, ROCKY],
  you: ME.playerId,
  series: { games: 3, wins: { [ME.playerId]: 2, [ROCKY.playerId]: 1 } },
  game: { outcome: { status: "finished", result: "win", winners: [ME.playerId], reason: "" }, number: 3 },
  ...overrides,
});
const TEXT =
  "🏆 Maine Rocky ko 2-1 se haraya! Tum try karo:\nI beat Rocky 2-1 at Rock Paper Scissors on ClassiCade. Can you beat Rocky?";
const FREE = "Free hai, login nahi chahiye.\nFree, no login needed.";
const URL_ = `${ORIGIN}/games/rock-paper-scissors`;
const messageVia = (via) => `${TEXT}\n${FREE}\n${URL_}?via=${via}`;

const show = (props = {}, api = fakeApi()) =>
  render(
    <ServicesProvider services={{ api }}>
      <ToastProvider>
        <ShareResult room={room()} origin={ORIGIN} {...props} />
      </ToastProvider>
    </ServicesProvider>,
  );

describe("ShareResult", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers WhatsApp with the result and the game page's link, in a new tab", () => {
    show();

    const link = screen.getByRole("link", { name: /WhatsApp/ });

    expect(link).toHaveAttribute("href", `https://wa.me/?text=${encodeURIComponent(messageVia("wa"))}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("data-cc-control", "result.whatsapp");
  });

  it("opens the device's share sheet with the text and the link apart, where there is one", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { ...navigator, share });
    show();

    await user.click(screen.getByRole("button", { name: "Share result" }));

    expect(share).toHaveBeenCalledWith({
      title: "ClassiCade",
      text: `${TEXT}\n${FREE}`,
      url: `${URL_}?via=share`,
    });
  });

  it("closing the share sheet without sharing is not an error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn().mockRejectedValue(new DOMException("x", "AbortError")),
    });
    show();

    await user.click(screen.getByRole("button", { name: "Share result" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("copies the whole message when the browser refuses the share sheet for another reason", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn().mockRejectedValue(new DOMException("not allowed", "NotAllowedError")),
      clipboard: { writeText },
    });
    show();

    await user.click(screen.getByRole("button", { name: "Share result" }));

    expect(writeText).toHaveBeenCalledWith(messageVia("copy"));
    // The toast area is on the page from the start, and the words arrive a moment after the copy (CC-288).
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Result copied"));
  });

  it("copies the whole message where the device has no share sheet", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    show();

    await user.click(screen.getByRole("button", { name: "Share result" }));

    expect(writeText).toHaveBeenCalledWith(messageVia("copy"));
    // The toast area is on the page from the start, and the words arrive a moment after the copy (CC-288).
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Result copied"));
  });

  it("says so when copying fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    show();

    await user.click(screen.getByRole("button", { name: "Share result" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't copy. Use the WhatsApp button instead",
    );
  });

  it("shows the message it will send, without any name or the room code", () => {
    show();

    const preview = screen.getByText(
      (content, element) => element?.textContent === TEXT && element.tagName === "P",
    );
    expect(preview).toBeVisible();
    expect(document.body.textContent).not.toContain("Guest-ME12");
    expect(document.body.textContent).not.toContain("AB2CD3");
  });

  it("reads the player's own safety flags from the age policy, and names nobody with any of them (CC-152)", async () => {
    for (const safety of [MINOR_SAFETY, ADULT_SAFETY]) {
      const api = fakeApi({ getSafety: vi.fn().mockResolvedValue(safety) });
      const { unmount } = show({}, api);

      await waitFor(() => expect(api.getSafety).toHaveBeenCalledTimes(1));
      const text = new URL(screen.getByRole("link", { name: /WhatsApp/ }).href).searchParams.get("text");
      expect(text).toBe(messageVia("wa"));
      expect(text).not.toContain(ME.displayName);
      unmount();
    }
  });

  it("is not offered to a spectator, who played nothing", () => {
    show({ room: room({ you: "" }) });

    expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it("builds the link on the site's own address by default", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "classicade:site-origin");
    meta.setAttribute("content", "https://canonical.example");
    document.head.append(meta);
    render(
      <ServicesProvider services={{ api: fakeApi() }}>
        <ToastProvider>
          <ShareResult room={room()} />
        </ToastProvider>
      </ServicesProvider>,
    );
    meta.remove();

    const text = new URL(screen.getByRole("link", { name: /WhatsApp/ }).href).searchParams.get("text");
    expect(text.endsWith("\nhttps://canonical.example/games/rock-paper-scissors?via=wa")).toBe(true);
  });
});
