import { webcrypto } from "node:crypto";
import { act, render as renderPlain, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { useSealChecks } from "../../hooks/useSealChecks.js";
import { fakeSound } from "../../testing/fakes.js";
import { RpsBoard } from "./RpsBoard.jsx";

// The computer's lock in Rock Paper Scissors (CC-225): shown before the person chooses, checked in the browser
// after the round.
const Services = ({ children }) => (
  <ServicesProvider services={{ sound: fakeSound() }}>{children}</ServicesProvider>
);
const render = (ui) => renderPlain(ui, { wrapper: Services });

const ME = "guest_me";
const ROCKY = "bot_rocky_easy";
const sha256 = async (text) =>
  Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const LOCK = "7f3a".padEnd(61, "0") + "c21";

async function revealed(choice, { lie = false } = {}) {
  const text = JSON.stringify({ choice });
  const salt = "5a1t".repeat(16);
  const commitment = await sha256(`${lie ? '{"choice":"paper"}' : text}:${salt}`);
  return { playerId: ROCKY, text, salt, commitment };
}

const room = ({ locked = [], checks = [], rounds = [] } = {}) => {
  const view = {
    bestOf: 3,
    score: { [ME]: 0, [ROCKY]: rounds.length },
    round: rounds.length + 1,
    rounds,
    hasChosen: { [ME]: false, [ROCKY]: false },
    yourChoice: "",
  };
  return {
    code: "AB2CD3",
    status: "playing",
    you: ME,
    hostId: ME,
    seats: [
      { playerId: ME, displayName: "Me", connected: true },
      { playerId: ROCKY, displayName: "Rocky", connected: true, bot: { character: "rocky", level: "easy" } },
    ],
    players: { min: 2, max: 2 },
    serverTime: 1_000,
    fairness: { locked, checks },
    game: { view, activePlayers: [ME, ROCKY], outcome: { status: "ongoing" } },
  };
};

describe("RpsBoard against a computer character", () => {
  it("shows Rocky's lock before you choose, and that he has locked in", () => {
    render(<RpsBoard room={room({ locked: [{ playerId: ROCKY, commitment: LOCK }] })} onMove={vi.fn()} />);

    expect(screen.getByText(/Rocky has locked in a throw/)).toHaveTextContent("Lock 7f3a…c21");
    expect(screen.getByText("Rocky has locked in")).toBeInTheDocument();
  });

  it("checks the last round's lock in the browser and says it matched", async () => {
    const check = await revealed("rock");
    const rounds = [{ choices: { [ME]: "scissors", [ROCKY]: "rock" }, winner: ROCKY }];

    render(<RpsBoard room={room({ checks: [check], rounds })} onMove={vi.fn()} />);

    expect(screen.getByText(/Rocky threw/)).toHaveTextContent("Rocky threw Rock. Checking the lock…");
    expect(await screen.findByText("Lock checked ✓")).toBeInTheDocument();
    expect(screen.getByText("Rocky is choosing…")).toBeInTheDocument();
  });

  it("says so when a lock does not match the throw", async () => {
    render(<RpsBoard room={room({ checks: [await revealed("rock", { lie: true })] })} onMove={vi.fn()} />);

    expect(await screen.findByText("The lock does not match this throw.")).toHaveClass("bad");
  });

  it("explains how the lock works, shows the whole check, and closes", async () => {
    const user = userEvent.setup();
    const check = await revealed("scissors");
    render(<RpsBoard room={room({ checks: [check] })} onMove={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "How we keep it fair" }));

    const dialog = screen.getByRole("dialog", { name: "How we keep it fair" });
    expect(dialog).toHaveTextContent("Rocky is a computer player and chooses before you do");
    expect(dialog).toHaveTextContent(check.commitment);
    expect(dialog).toHaveTextContent(`${check.text}:${check.salt}`);
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains the lock before any round is over too, and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<RpsBoard room={room({ locked: [{ playerId: ROCKY, commitment: LOCK }] })} onMove={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "How we keep it fair" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a revealed move it does not know as it is", async () => {
    const odd = { playerId: ROCKY, text: '{"choice":"lizard"}', salt: "s", commitment: "c" };
    const broken = { playerId: ROCKY, text: "not json", salt: "s", commitment: "d" };

    const { rerender } = render(<RpsBoard room={room({ checks: [odd] })} onMove={vi.fn()} />);
    expect(screen.getByText(/Rocky threw/)).toHaveTextContent('Rocky threw {"choice":"lizard"}.');
    rerender(<RpsBoard room={room({ checks: [broken] })} onMove={vi.fn()} />);
    expect(screen.getByText(/Rocky threw/)).toHaveTextContent("Rocky threw not json.");
  });
});

describe("useSealChecks", () => {
  const entry = (commitment) => ({ text: "t", salt: "s", commitment });

  it("answers checking first, then each result once the hash is done", async () => {
    const check = vi.fn(async ({ commitment }) => commitment === "good");

    const { result } = renderHook(() => useSealChecks([entry("good"), entry("bad")], check));

    expect(result.current).toEqual({ good: "checking", bad: "checking" });
    await waitFor(() => expect(result.current).toEqual({ good: "matched", bad: "mismatched" }));
  });

  it("says unchecked when the browser cannot hash", async () => {
    const check = vi.fn(async () => {
      throw new Error("This browser cannot check the lock");
    });

    const { result } = renderHook(() => useSealChecks([entry("a")], check));

    await waitFor(() => expect(result.current).toEqual({ a: "unchecked" }));
  });

  it("checks again only when the list of locks changes", async () => {
    const check = vi.fn(async () => true);
    const { rerender } = renderHook(({ list }) => useSealChecks(list, check), {
      initialProps: { list: [entry("a")] },
    });
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));

    rerender({ list: [entry("a")] });
    rerender({ list: [entry("a"), entry("b")] });

    await waitFor(() => expect(check).toHaveBeenCalledTimes(3));
  });

  it("ignores a result that arrives after the screen moved on", async () => {
    let finish;
    const check = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const { result, unmount } = renderHook(() => useSealChecks([entry("a")], check));

    unmount();
    await act(async () => finish(true));

    expect(result.current).toEqual({ a: "checking" });
  });
});
