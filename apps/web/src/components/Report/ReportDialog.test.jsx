import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { REPORT_REASONS } from "@classicade/shared";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSound } from "../../testing/fakes.js";
import { ToastContext } from "../Toast/toastContext.js";
import { ReportDialog } from "./ReportDialog.jsx";
import { REPORT_REASON_LABELS } from "./reportText.js";

// CC-044, ADR-071: the report dialog. A closed reason and no free text, a neutral thank-you, and Block in one tap.
const TARGET = Object.freeze({ matchId: "m1", seat: 1 });

function mount({ api = fakeApi(), onClose = vi.fn(), onBlocked = vi.fn(), canBlock = true } = {}) {
  const toast = { show: vi.fn(), dismiss: vi.fn(), hold: vi.fn(() => () => undefined) };
  render(
    <ServicesProvider services={{ sound: fakeSound(), api }}>
      <ToastContext.Provider value={toast}>
        <ReportDialog
          name="Bob"
          target={TARGET}
          onClose={onClose}
          onBlocked={onBlocked}
          canBlock={canBlock}
        />
      </ToastContext.Provider>
    </ServicesProvider>,
  );
  return { api, onClose, onBlocked, toast, user: userEvent.setup() };
}

const dialog = () => screen.getByRole("dialog");
const reason = (id) =>
  within(dialog()).getByRole("radio", { name: new RegExp(REPORT_REASON_LABELS[id].english) });

describe("ReportDialog (CC-044)", () => {
  it("asks for one of the four reasons and offers no box to type in (owner, 2026-10-21), in Hinglish first", () => {
    mount();

    expect(within(dialog()).getByRole("heading")).toHaveTextContent("Bob ko report karo" + "Report Bob");
    expect(within(dialog()).getAllByRole("radio")).toHaveLength(REPORT_REASONS.length);
    for (const id of REPORT_REASONS) expect(reason(id)).not.toBeChecked();
    expect(within(dialog()).queryByRole("textbox")).toBeNull();
  });

  it("sends nothing until a reason is picked", async () => {
    const { api, user } = mount();

    await user.click(within(dialog()).getByRole("button", { name: "Send report" }));

    expect(api.reportPlayer).not.toHaveBeenCalled();
    expect(within(dialog()).getByText("Pick a reason first.")).toBeVisible();
  });

  it("sends where the two met and the reason, nothing else, then thanks the player without saying what happens", async () => {
    const api = fakeApi({ reportPlayer: vi.fn().mockResolvedValue({ reportId: "r1", createdAt: 1 }) });
    const { user } = mount({ api });

    await user.click(reason("cheating"));
    await user.click(within(dialog()).getByRole("button", { name: "Send report" }));

    expect(api.reportPlayer).toHaveBeenCalledWith({ ...TARGET, reason: "cheating" });
    const thanks = await screen.findByRole("dialog", { name: /Thanks, we got it/ });
    expect(thanks).toHaveTextContent("Bob is not told that you reported them.");
    expect(thanks).toHaveTextContent("Childline: 1098");
  });

  it("blocks the reported player in one tap from the thank-you, by the report's id only", async () => {
    const api = fakeApi({
      reportPlayer: vi.fn().mockResolvedValue({ reportId: "r1", createdAt: 1 }),
      blockPlayer: vi.fn().mockResolvedValue({ blockId: "b1", displayName: "Bob", blockedAt: 2 }),
    });
    const { user, onBlocked, toast } = mount({ api });
    await user.click(reason("harassment"));
    await user.click(within(dialog()).getByRole("button", { name: "Send report" }));
    await screen.findByRole("dialog", { name: /Thanks, we got it/ });

    await user.click(within(dialog()).getByRole("button", { name: "Block Bob too" }));

    expect(api.blockPlayer).toHaveBeenCalledWith({ reportId: "r1" });
    expect(onBlocked).toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith("You blocked Bob.", { surface: "toast.blocked", tone: "info" });
    expect(within(dialog()).queryByRole("button", { name: "Block Bob too" })).toBeNull();
    expect(dialog()).toHaveTextContent("You blocked Bob.");
  });

  it("offers no block when the player is blocked already, and closes", async () => {
    const api = fakeApi({ reportPlayer: vi.fn().mockResolvedValue({ reportId: "r1", createdAt: 1 }) });
    const { user, onClose } = mount({ api, canBlock: false });
    await user.click(reason("other"));
    await user.click(within(dialog()).getByRole("button", { name: "Send report" }));
    await screen.findByRole("dialog", { name: /Thanks, we got it/ });

    expect(within(dialog()).queryByRole("button", { name: /^Block/ })).toBeNull();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's refusal and keeps the form", async () => {
    const api = fakeApi({
      reportPlayer: vi
        .fn()
        .mockRejectedValue(
          new AppRequestError({ code: "NOT_FOUND", message: "We couldn't find that player", status: 404 }),
        ),
    });
    const { user } = mount({ api });

    await user.click(reason("name"));
    await user.click(within(dialog()).getByRole("button", { name: "Send report" }));

    expect(await within(dialog()).findByText("We couldn't find that player")).toBeVisible();
    expect(reason("name")).toBeChecked();
  });
});
