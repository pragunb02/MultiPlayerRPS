import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal.jsx";

// The dialog contract (docs/design/CONTRACT.md, CC-314): focus stays inside an open dialog, the page behind is inert,
// and only one dialog is open at a time.

function Page({ dialogs }) {
  const [open, setOpen] = useState(() => dialogs.map(() => false));
  const toggle = (index, value) =>
    setOpen((current) => current.map((was, at) => (at === index ? value : was)));
  return (
    <>
      <a href="/before">Before</a>
      {dialogs.map((title, index) => (
        <button key={title} type="button" onClick={() => toggle(index, true)}>
          Open {title}
        </button>
      ))}
      {dialogs.map((title, index) => (
        <Modal
          surface="dialog.feedback"
          key={title}
          open={open[index]}
          title={title}
          onClose={() => toggle(index, false)}
          actions={
            <>
              <button type="button" onClick={() => toggle(index, false)}>
                Cancel {title}
              </button>
              <button type="button">Confirm {title}</button>
            </>
          }
        >
          <label>
            Reason <input />
          </label>
        </Modal>
      ))}
    </>
  );
}

describe("Modal", () => {
  it("Tab stays inside the dialog and the page behind is inert", async () => {
    const user = userEvent.setup();
    render(<Page dialogs={["Block Riya?"]} />);
    const opener = screen.getByRole("button", { name: "Open Block Riya?" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Block Riya?" });
    const backdrop = dialog.parentElement;
    const behind = [...document.body.children].filter((element) => element !== backdrop);
    expect(behind.length).toBeGreaterThan(0);
    for (const element of behind) {
      expect(element).toHaveAttribute("inert");
    }

    const visited = [];
    for (let press = 0; press < 7; press += 1) {
      await user.tab();
      visited.push(document.activeElement);
    }
    for (let press = 0; press < 7; press += 1) {
      await user.tab({ shift: true });
      visited.push(document.activeElement);
    }
    for (const element of visited) {
      expect(dialog).toContainElement(element);
    }
    expect(new Set(visited)).toEqual(
      new Set([
        screen.getByRole("textbox", { name: "Reason" }),
        screen.getByRole("button", { name: "Cancel Block Riya?" }),
        screen.getByRole("button", { name: "Confirm Block Riya?" }),
      ]),
    );

    await user.click(screen.getByRole("button", { name: "Cancel Block Riya?" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    for (const element of behind) {
      expect(element).not.toHaveAttribute("inert");
    }
    expect(opener).toHaveFocus();
  });

  it("keeps a part of the page that was already inert as it was", async () => {
    const user = userEvent.setup();
    const kept = document.createElement("div");
    kept.setAttribute("inert", "");
    document.body.append(kept);
    render(<Page dialogs={["Leave?"]} />);
    await user.click(screen.getByRole("button", { name: "Open Leave?" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(kept).toHaveAttribute("inert");
    kept.remove();
  });

  it("moves Tab from the dialog itself to its first control, and Shift+Tab to its last", async () => {
    const user = userEvent.setup();
    render(<Page dialogs={["Leave?"]} />);
    await user.click(screen.getByRole("button", { name: "Open Leave?" }));
    const dialog = screen.getByRole("dialog", { name: "Leave?" });
    dialog.focus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Reason" })).toHaveFocus();
    dialog.focus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Confirm Leave?" })).toHaveFocus();
  });

  it("holds Tab on the dialog itself when it has nothing to focus", async () => {
    const user = userEvent.setup();
    render(
      <Modal surface="dialog.feedback" open title="Saving" onClose={vi.fn()} actions={null}>
        <p>One moment.</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Saving" });
    await user.tab();
    expect(dialog).toContainElement(document.activeElement);
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement);
  });

  it("never two dialogs at once", async () => {
    const user = userEvent.setup();
    function Both() {
      const [second, setSecond] = useState(false);
      const [first, setFirst] = useState(true);
      return (
        <>
          <Modal
            surface="dialog.feedback"
            open={first}
            title="First"
            onClose={() => setFirst(false)}
            actions={
              <>
                <button type="button" onClick={() => setSecond(true)}>
                  Ask the second
                </button>
                <button type="button" onClick={() => setFirst(false)}>
                  Close first
                </button>
              </>
            }
          >
            <p>One</p>
          </Modal>
          <Modal
            surface="dialog.feedback"
            open={second}
            title="Second"
            onClose={() => setSecond(false)}
            actions={
              <button type="button" onClick={() => setSecond(false)}>
                Close second
              </button>
            }
          >
            <p>Two</p>
          </Modal>
        </>
      );
    }
    render(<Both />);
    await user.click(screen.getByRole("button", { name: "Ask the second" }));
    // The second waits while the first is open.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "First" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close first" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const second = screen.getByRole("dialog", { name: "Second" });
    expect(second).toContainElement(document.activeElement);

    await user.click(screen.getByRole("button", { name: "Close second" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
