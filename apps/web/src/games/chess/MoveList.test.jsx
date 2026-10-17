import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoveList } from "./MoveList.jsx";

/** `count` moves, with the longest kinds of move notation at the given positions (0 based). */
function movesWith(count, long = {}) {
  return Array.from({ length: count }, (_, index) => long[index] ?? (index % 2 === 0 ? "Nf3" : "Nf6"));
}

const rows = () => within(screen.getByRole("list", { name: "Move list" })).getAllByRole("listitem");
/** A row's parts in order: its number, then White's and Black's move. */
const parts = (row) => [...row.children].map((part) => part.textContent);

describe("MoveList", () => {
  it("numbers every row in full, with one, two and three digits", () => {
    render(<MoveList moves={movesWith(201)} ply={201} latest={201} onGoTo={vi.fn()} />);

    const all = rows();
    expect(all).toHaveLength(101);
    expect(parts(all[0])[0]).toBe("1.");
    expect(parts(all[9])[0]).toBe("10.");
    expect(parts(all[99])[0]).toBe("100.");
    expect(parts(all[100])).toEqual(["101.", "Nf3"]);
  });

  it("shows long moves whole, next to their number", () => {
    const long = { 18: "exd8=Q+", 19: "Nbxd7#", 198: "Qa1xb2+", 199: "O-O-O" };
    render(<MoveList moves={movesWith(200, long)} ply={200} latest={200} onGoTo={vi.fn()} />);

    const all = rows();
    expect(parts(all[9])).toEqual(["10.", "exd8=Q+", "Nbxd7#"]);
    expect(parts(all[99])).toEqual(["100.", "Qa1xb2+", "O-O-O"]);
    expect(screen.getByRole("button", { name: "exd8=Q+" })).toBeInTheDocument();
  });
});
