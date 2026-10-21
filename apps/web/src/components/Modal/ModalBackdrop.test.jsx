import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal.jsx";

const backdrop = () => document.querySelector("[data-cc-modal-backdrop]");

describe("Modal backdrop (CC-323)", () => {
  it("a destructive confirm does not close on a backdrop click, only on its buttons or Escape (AC-12)", () => {
    const onClose = vi.fn();
    render(
      <Modal
        surface="dialog.confirm_leave"
        open
        destructive
        title="Resign?"
        onClose={onClose}
        actions={<button type="button">Resign</button>}
      >
        <p>You lose this game.</p>
      </Modal>,
    );

    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Resign?" })).toBeInTheDocument();
    expect(backdrop()).toHaveAttribute("data-cc-modal-backdrop", "destructive");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("any other dialog still closes on a backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Modal
        surface="dialog.sound"
        open
        title="Sound"
        onClose={onClose}
        actions={<button type="button">Done</button>}
      >
        <p>Volume</p>
      </Modal>,
    );

    fireEvent.click(screen.getByRole("dialog", { name: "Sound" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
