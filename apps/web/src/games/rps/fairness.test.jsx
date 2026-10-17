import { webcrypto } from "node:crypto";
import { act, render as renderPlain, renderHook, screen, waitFor, within } from "@testing-library/react";
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

async function revealed(choice, { lie = false, turn = 0 } = {}) {
  const text = JSON.stringify({ choice });
  const salt = "5a1t".repeat(16);
  const commitment = await sha256(`${lie ? '{"choice":"paper"}' : text}:${salt}`);
  return { playerId: ROCKY, turn, text, salt, commitment };
}
/** The lock the server showed before the round of `check`. */
const lockOf = ({ playerId, turn, commitment }) => ({ playerId, turn, commitment });

const room = ({ locked = [], checks = [], rounds = [], game = "g1" } = {}) => {
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
    fairness: { game, locked, checks },
    game: { view, activePlayers: [ME, ROCKY], outcome: { status: "ongoing" } },
  };
};
const roundWon = (rocky) => [{ choices: { [ME]: "scissors", [ROCKY]: rocky }, winner: ROCKY }];

/** The board as the room goes from `before` (the lock is shown) to `after` (the round is over). */
function playRound(before, after) {
  const view = render(<RpsBoard room={room(before)} onMove={vi.fn()} />);
  view.rerender(<RpsBoard room={room(after)} onMove={vi.fn()} />);
  return view;
}

describe("RpsBoard against a computer character", () => {
  it("shows Rocky's lock before you choose, and that he has locked in", () => {
    render(
      <RpsBoard room={room({ locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] })} onMove={vi.fn()} />,
    );

    expect(screen.getByText(/Rocky has locked in a throw/)).toHaveTextContent("Lock 7f3a…c21");
    expect(screen.getByText("Rocky has locked in")).toBeInTheDocument();
  });

  it("says the lock checked out when the reveal matches the lock it showed before the round", async () => {
    const check = await revealed("rock");

    playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("rock") });

    expect(screen.getByText(/Rocky threw/)).toHaveTextContent("Rocky threw Rock. Checking the lock…");
    expect(await screen.findByText("Lock checked ✓")).toBeInTheDocument();
    expect(screen.getByText("Rocky is choosing…")).toBeInTheDocument();
  });

  it("says the lock does not match when the reveal brings a different lock, even one its throw hashes to", async () => {
    const check = await revealed("rock");

    playRound(
      { locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] },
      { checks: [check], rounds: roundWon("rock") },
    );

    expect(await screen.findByText("The lock does not match this throw.")).toHaveClass("bad");
    expect(screen.queryByText("Lock checked ✓")).not.toBeInTheDocument();
  });

  it("says the lock does not match when the revealed throw is not the one that decided the round", async () => {
    const check = await revealed("rock");

    playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("paper") });

    expect(await screen.findByText("The lock does not match this throw.")).toHaveClass("bad");
  });

  it("says so when the throw and key do not hash to the lock", async () => {
    const check = await revealed("rock", { lie: true });

    playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("rock") });

    expect(await screen.findByText("The lock does not match this throw.")).toHaveClass("bad");
  });

  it("keeps the first lock it showed for a turn, so one sent again later cannot replace it", async () => {
    const check = await revealed("rock");
    const view = render(
      <RpsBoard room={room({ locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] })} onMove={vi.fn()} />,
    );
    view.rerender(<RpsBoard room={room({ locked: [lockOf(check)] })} onMove={vi.fn()} />);

    view.rerender(<RpsBoard room={room({ checks: [check], rounds: roundWon("rock") })} onMove={vi.fn()} />);

    expect(await screen.findByText("The lock does not match this throw.")).toBeInTheDocument();
  });

  it("follows a rematch: the same turn in the next game has its own lock", async () => {
    const check = await revealed("rock");
    const view = render(
      <RpsBoard room={room({ locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] })} onMove={vi.fn()} />,
    );
    view.rerender(<RpsBoard room={room({ game: "g2", locked: [lockOf(check)] })} onMove={vi.fn()} />);

    view.rerender(
      <RpsBoard room={room({ game: "g2", checks: [check], rounds: roundWon("rock") })} onMove={vi.fn()} />,
    );

    expect(await screen.findByText("Lock checked ✓")).toBeInTheDocument();
  });

  it("checks a throw that no round used, when the game ended before it was played", async () => {
    const check = await revealed("paper");

    playRound({ locked: [lockOf(check)] }, { checks: [check] });

    expect(await screen.findByText("Lock checked ✓")).toBeInTheDocument();
  });

  it("does not claim a check for a lock it never showed, as after opening the page mid game", async () => {
    render(
      <RpsBoard
        room={room({ checks: [await revealed("rock")], rounds: roundWon("rock") })}
        onMove={vi.fn()}
      />,
    );

    expect(
      screen.getByText("This browser did not see the lock before this round, so it cannot check it."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Lock checked ✓")).not.toBeInTheDocument();
  });

  it("explains how the lock works, shows the lock it showed before the round and the whole check, and closes", async () => {
    const user = userEvent.setup();
    const check = await revealed("scissors");
    playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("scissors") });

    await user.click(screen.getByRole("button", { name: "How we keep it fair" }));

    const dialog = screen.getByRole("dialog", { name: "How we keep it fair" });
    expect(dialog).toHaveTextContent("Rocky is a computer player and chooses before you do");
    expect(within(dialog).getByText("Lock shown before you chose").nextElementSibling).toHaveTextContent(
      check.commitment,
    );
    expect(dialog).toHaveTextContent(`${check.text}:${check.salt}`);
    expect(await within(dialog).findByText("Lock checked ✓")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prints the lock it remembered, not the one the reveal brings", async () => {
    const user = userEvent.setup();
    const check = await revealed("rock");
    playRound(
      { locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] },
      { checks: [check], rounds: roundWon("rock") },
    );

    await user.click(screen.getByRole("button", { name: "How we keep it fair" }));

    const dialog = screen.getByRole("dialog", { name: "How we keep it fair" });
    expect(within(dialog).getByText("Lock shown before you chose").nextElementSibling).toHaveTextContent(
      LOCK,
    );
    expect(within(dialog).getByText("Lock sent with the throw and key").nextElementSibling).toHaveTextContent(
      check.commitment,
    );
  });

  it("says in the explanation when it never saw the lock", async () => {
    const user = userEvent.setup();
    render(<RpsBoard room={room({ checks: [await revealed("rock")] })} onMove={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "How we keep it fair" }));

    const dialog = screen.getByRole("dialog", { name: "How we keep it fair" });
    expect(within(dialog).getByText("Lock shown before you chose").nextElementSibling).toHaveTextContent(
      "This browser did not see the lock before this round",
    );
  });

  it("explains the lock before any round is over too, and closes with Escape", async () => {
    const user = userEvent.setup();
    render(
      <RpsBoard room={room({ locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] })} onMove={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "How we keep it fair" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a revealed move it does not know as it is", async () => {
    const odd = { playerId: ROCKY, turn: 0, text: '{"choice":"lizard"}', salt: "s", commitment: "c" };
    const broken = { playerId: ROCKY, turn: 0, text: "not json", salt: "s", commitment: "d" };

    const { rerender } = render(<RpsBoard room={room({ checks: [odd] })} onMove={vi.fn()} />);
    expect(screen.getByText(/Rocky threw/)).toHaveTextContent('Rocky threw {"choice":"lizard"}.');
    rerender(<RpsBoard room={room({ checks: [broken] })} onMove={vi.fn()} />);
    expect(screen.getByText(/Rocky threw/)).toHaveTextContent("Rocky threw not json.");
  });
});

describe("useSealChecks", () => {
  const entry = (commitment, turn = 0) => ({ playerId: ROCKY, turn, text: "t", salt: "s", commitment });
  const fairness = (checks, locked = []) => ({ game: "g1", locked, checks });
  const states = (result) => result.current.map(({ commitment, hashed }) => [commitment, hashed]);

  it("answers checking first, then each result once the hash is done", async () => {
    const check = vi.fn(async ({ commitment }) => commitment === "good");

    const { result } = renderHook(() =>
      useSealChecks({ fairness: fairness([entry("good"), entry("bad", 1)]), playerId: ROCKY }, check),
    );

    expect(states(result)).toEqual([
      ["good", "checking"],
      ["bad", "checking"],
    ]);
    await waitFor(() =>
      expect(states(result)).toEqual([
        ["good", "matched"],
        ["bad", "mismatched"],
      ]),
    );
  });

  it("follows only the given computer player, and remembers the lock it was shown for each turn", async () => {
    const check = vi.fn(async () => true);
    const other = { ...entry("x"), playerId: "bot_other" };
    const { result, rerender } = renderHook(
      ({ value }) => useSealChecks({ fairness: value, playerId: ROCKY }, check),
      {
        initialProps: { value: fairness([], [{ playerId: ROCKY, turn: 0, commitment: "lock" }, other]) },
      },
    );

    rerender({ value: fairness([entry("good"), other]) });

    expect(result.current.map(({ commitment, lockShown }) => [commitment, lockShown])).toEqual([
      ["good", "lock"],
    ]);
  });

  it("says unchecked when the browser cannot hash", async () => {
    const check = vi.fn(async () => {
      throw new Error("This browser cannot check the lock");
    });

    const { result } = renderHook(() =>
      useSealChecks({ fairness: fairness([entry("a")]), playerId: ROCKY }, check),
    );

    await waitFor(() => expect(states(result)).toEqual([["a", "unchecked"]]));
  });

  it("checks again only when the list of locks changes", async () => {
    const check = vi.fn(async () => true);
    const { rerender } = renderHook(
      ({ list }) => useSealChecks({ fairness: fairness(list), playerId: ROCKY }, check),
      {
        initialProps: { list: [entry("a")] },
      },
    );
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));

    rerender({ list: [entry("a")] });
    rerender({ list: [entry("a"), entry("b", 1)] });

    await waitFor(() => expect(check).toHaveBeenCalledTimes(3));
  });

  it("ignores a result that arrives after the screen moved on", async () => {
    let finish;
    const check = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const { result, unmount } = renderHook(() =>
      useSealChecks({ fairness: fairness([entry("a")]), playerId: ROCKY }, check),
    );

    unmount();
    await act(async () => finish(true));

    expect(states(result)).toEqual([["a", "checking"]]);
  });
});
