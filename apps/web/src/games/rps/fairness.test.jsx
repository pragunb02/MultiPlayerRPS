import { webcrypto } from "node:crypto";
import { act, render as renderPlain, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { useSealChecks } from "../../hooks/useSealChecks.js";
import { fakeSound } from "../../testing/fakes.js";
import { RpsBoard } from "./RpsBoard.jsx";

// The computer's lock in Rock Paper Scissors (CC-225): shown before the person chooses, checked in the browser
// after the round, and said in plain words with the proof folded away (CC-254).
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

/** Everything on the main screen, outside the dialog. */
const mainText = (container) => container.textContent;
const HEX_64 = /[0-9a-f]{64}/;
const FAIR = "✓ Fair: Rocky's choice didn't change";
const WARNING =
  "Warning: Rocky's choice doesn't match what was locked in. This round may not have been fair.";
const PROOF = "Show the proof (for the curious)";

/** Opens "How we keep it fair" and answers the dialog. */
async function openExplanation(user) {
  await user.click(screen.getByRole("button", { name: "How we keep it fair" }));
  return screen.getByRole("dialog", { name: "How we keep it fair" });
}

describe("RpsBoard against a computer character", () => {
  it("says in plain words that Rocky has chosen and cannot change it, with no code on the screen", () => {
    const { container } = render(
      <RpsBoard room={room({ locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] })} onMove={vi.fn()} />,
    );

    expect(
      screen
        .getByText(/Rocky has chosen\. It's locked/)
        .textContent.replace(/\s+/g, " ")
        .trim(),
    ).toBe("🔒 Rocky has chosen. It's locked, so Rocky can't change it after you pick.");
    expect(screen.getByText("Rocky has chosen")).toBeInTheDocument();
    expect(mainText(container)).not.toContain("7f3a");
    expect(mainText(container)).not.toMatch(/lock id|key|…c21/i);
  });

  it("says Rocky's choice didn't change when the reveal matches the lock it showed before the round", async () => {
    const check = await revealed("rock");

    const { container } = playRound(
      { locked: [lockOf(check)] },
      { checks: [check], rounds: roundWon("rock") },
    );

    expect(screen.getByText("Checking that Rocky's choice didn't change…")).toHaveClass("quiet");
    expect(await screen.findByText(FAIR)).toHaveClass("good");
    expect(screen.getByText("Rocky is choosing…")).toBeInTheDocument();
    expect(mainText(container)).not.toMatch(HEX_64);
    expect(mainText(container)).not.toContain(check.salt);
    expect(mainText(container)).not.toContain('{"choice"');
  });

  it("warns in plain words when the reveal brings a different lock, even one its throw hashes to", async () => {
    const check = await revealed("rock");

    playRound(
      { locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] },
      { checks: [check], rounds: roundWon("rock") },
    );

    const warning = await screen.findByText(WARNING);
    expect(warning).toHaveClass("bad");
    expect(within(warning).getByText("⚠")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText(FAIR)).not.toBeInTheDocument();
  });

  it("warns when the revealed throw is not the one that decided the round", async () => {
    const check = await revealed("rock");

    playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("paper") });

    expect(await screen.findByText(WARNING)).toHaveClass("bad");
  });

  it("warns when the throw and key do not hash to the lock", async () => {
    const check = await revealed("rock", { lie: true });

    playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("rock") });

    expect(await screen.findByText(WARNING)).toHaveClass("bad");
  });

  it("keeps the first lock it showed for a turn, so one sent again later cannot replace it", async () => {
    const check = await revealed("rock");
    const view = render(
      <RpsBoard room={room({ locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] })} onMove={vi.fn()} />,
    );
    view.rerender(<RpsBoard room={room({ locked: [lockOf(check)] })} onMove={vi.fn()} />);

    view.rerender(<RpsBoard room={room({ checks: [check], rounds: roundWon("rock") })} onMove={vi.fn()} />);

    expect(await screen.findByText(WARNING)).toBeInTheDocument();
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

    expect(await screen.findByText(FAIR)).toBeInTheDocument();
  });

  it("checks a throw that no round used, when the game ended before it was played", async () => {
    const check = await revealed("paper");

    playRound({ locked: [lockOf(check)] }, { checks: [check] });

    expect(await screen.findByText(FAIR)).toBeInTheDocument();
  });

  it("does not claim a round was fair for a lock it never showed, as after opening the page mid game", async () => {
    render(
      <RpsBoard
        room={room({ checks: [await revealed("rock")], rounds: roundWon("rock") })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText("This page opened after Rocky chose, so it can't check this round.")).toHaveClass(
      "quiet",
    );
    expect(screen.queryByText(FAIR)).not.toBeInTheDocument();
  });

  it("says so in plain words when the browser cannot check", async () => {
    const check = await revealed("rock");
    vi.stubGlobal("crypto", {});
    try {
      playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("rock") });

      expect(
        await screen.findByText(
          "This browser can't check Rocky's choice, so we can't show that this round was fair.",
        ),
      ).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("explains the lock in three everyday steps, with the proof folded away", async () => {
    const user = userEvent.setup();
    const check = await revealed("scissors");
    playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("scissors") });

    const dialog = await openExplanation(user);

    const steps = within(dialog).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("Rocky is a computer player and picks first, in secret");
    expect(steps[0]).toHaveTextContent("sealing it in an envelope");
    expect(steps[1]).toHaveTextContent("nobody can change what is inside: not Rocky, and not us");
    expect(steps[2]).toHaveTextContent(
      "Your own browser checks that the choice inside is the one that was sealed",
    );
    expect(await within(dialog).findByText(FAIR)).toBeInTheDocument();
    const proof = within(dialog).getByText(PROOF).closest("details");
    expect(proof).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Got it" })).toHaveFocus();
  });

  it("reaches the proof by keyboard and opens it, with each part named in words and the SHA-256 line", async () => {
    const user = userEvent.setup();
    const check = await revealed("scissors");
    playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("scissors") });
    const dialog = await openExplanation(user);

    await user.tab({ shift: true });
    expect(within(dialog).getByText(PROOF)).toHaveFocus();
    // The test browser does not open a summary with Enter, a real one does (the browser test presses it).
    await user.click(within(dialog).getByText(PROOF));

    const proof = within(dialog).getByText(PROOF).closest("details");
    expect(proof).toHaveAttribute("open");
    const part = (label) => within(proof).getByText(label).nextElementSibling;
    expect(part("Lock shown before you picked")).toHaveTextContent(check.commitment);
    expect(part("Rocky's choice, shown after the round")).toHaveTextContent("Scissors");
    expect(part("Secret key, shown after the round")).toHaveTextContent(check.salt);
    expect(part("Text to check (the choice, a colon and the key)")).toHaveTextContent(
      `${check.text}:${check.salt}`,
    );
    expect(part("Lock sent with the choice and the key")).toHaveTextContent(check.commitment);
    expect(proof).toHaveTextContent("Anyone can check it with any SHA-256 tool");
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the keyboard focus where it is when the room updates behind the open explanation", async () => {
    const user = userEvent.setup();
    const check = await revealed("rock");
    const view = playRound({ locked: [lockOf(check)] }, { checks: [check], rounds: roundWon("rock") });
    const dialog = await openExplanation(user);
    await user.tab({ shift: true });

    view.rerender(
      <RpsBoard
        room={room({
          locked: [{ playerId: ROCKY, turn: 1, commitment: LOCK }],
          checks: [check],
          rounds: roundWon("rock"),
        })}
        onMove={vi.fn()}
      />,
    );

    expect(within(dialog).getByText(PROOF)).toHaveFocus();
  });

  it("prints the lock it remembered, not the one the reveal brings", async () => {
    const user = userEvent.setup();
    const check = await revealed("rock");
    playRound(
      { locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] },
      { checks: [check], rounds: roundWon("rock") },
    );

    const dialog = await openExplanation(user);

    expect(within(dialog).getByText("Lock shown before you picked").nextElementSibling).toHaveTextContent(
      LOCK,
    );
    expect(
      within(dialog).getByText("Lock sent with the choice and the key").nextElementSibling,
    ).toHaveTextContent(check.commitment);
    expect(await within(dialog).findByText(WARNING)).toBeInTheDocument();
  });

  it("says in the proof when it never saw the lock", async () => {
    const user = userEvent.setup();
    render(<RpsBoard room={room({ checks: [await revealed("rock")] })} onMove={vi.fn()} />);

    const dialog = await openExplanation(user);

    expect(within(dialog).getByText("Lock shown before you picked").nextElementSibling).toHaveTextContent(
      "This page opened after Rocky chose",
    );
  });

  it("shows this round's lock in the proof before any round is over, and closes with Escape", async () => {
    const user = userEvent.setup();
    render(
      <RpsBoard room={room({ locked: [{ playerId: ROCKY, turn: 0, commitment: LOCK }] })} onMove={vi.fn()} />,
    );

    const dialog = await openExplanation(user);

    expect(within(dialog).getByText("Lock for this round").nextElementSibling).toHaveTextContent(LOCK);
    expect(dialog).toHaveTextContent("Rocky's choice and the secret key are shown after the round.");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says the proof comes once Rocky has chosen, when there is no lock yet", async () => {
    const user = userEvent.setup();
    render(<RpsBoard room={room()} onMove={vi.fn()} />);

    const dialog = await openExplanation(user);

    expect(dialog).toHaveTextContent("The proof shows here once Rocky has chosen.");
  });

  it("shows a revealed move it does not know as it is, only inside the proof", async () => {
    const user = userEvent.setup();
    const odd = { playerId: ROCKY, turn: 0, text: '{"choice":"lizard"}', salt: "s", commitment: "c" };
    const broken = { playerId: ROCKY, turn: 0, text: "not json", salt: "s", commitment: "d" };
    const choice = () => screen.getByText("Rocky's choice, shown after the round").nextElementSibling;

    const { rerender } = render(<RpsBoard room={room({ checks: [odd] })} onMove={vi.fn()} />);
    await openExplanation(user);
    expect(choice()).toHaveTextContent('{"choice":"lizard"}');
    rerender(<RpsBoard room={room({ checks: [broken] })} onMove={vi.fn()} />);
    expect(choice()).toHaveTextContent("not json");
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
