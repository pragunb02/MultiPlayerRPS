import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../Toast/ToastProvider.jsx";
import { DailyShare } from "./DailyShare.jsx";

const ORIGIN = "https://classicade.example";
const PUZZLE = Object.freeze({
  kind: "chess",
  number: 2,
  status: "solved",
  grid: ["firstTry", "afterMistakes"],
  hintsTaken: 0,
  streak: { current: 3 },
});
const TEXT =
  "🧩 ClassiCade Daily chess puzzle #2\n🟩🟨 🔥3\nAaj ka chess puzzle solve kar liya! Tum karke dikhao:\nI solved today's chess puzzle on ClassiCade. Can you?";
const FREE = "Free hai, login nahi chahiye.\nFree, no login needed.";
const URL_ = `${ORIGIN}/daily/chess`;
const MESSAGE = `${TEXT}\n${FREE}\n${URL_}`;

const show = () =>
  render(
    <ToastProvider>
      <DailyShare puzzle={PUZZLE} origin={ORIGIN} />
    </ToastProvider>,
  );

describe("DailyShare (CC-144)", () => {
  afterEach(() => vi.unstubAllGlobals());
  // userEvent.setup() puts its own clipboard on navigator, so each test sets it up before stubbing navigator.

  it("shows the grid it will send and offers it on WhatsApp with the puzzle's link", () => {
    show();

    expect(
      screen.getByText((_, element) => element?.tagName === "P" && element.textContent === TEXT),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(MESSAGE)}`,
    );
  });

  it("opens the device's share sheet with the text and the link apart", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { ...navigator, share });
    show();

    await user.click(screen.getByRole("button", { name: "Share result" }));

    expect(share).toHaveBeenCalledWith({ title: "ClassiCade", text: `${TEXT}\n${FREE}`, url: URL_ });
  });

  it("does nothing more when the player closes the share sheet", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn().mockRejectedValue(new DOMException("x", "AbortError")),
      clipboard: { writeText },
    });
    show();

    await user.click(screen.getByRole("button", { name: "Share result" }));

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("copies the whole message when there is no share sheet, or it is refused", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")),
      clipboard: { writeText },
    });
    show();

    await user.click(screen.getByRole("button", { name: "Share result" }));

    expect(writeText).toHaveBeenCalledWith(MESSAGE);
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
});
