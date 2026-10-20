import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_MESSAGE_MAX, FEEDBACK_TYPES } from "@classicade/shared";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { FEEDBACK_TYPE_LABELS } from "./feedbackText.js";

// CC-290: the Feedback dialog, opened from the footer of every page or the header menu.

const SENT = { feedbackId: "f1", status: "new", createdAt: 1 };

async function openFromFooter({ api = fakeApi(), path = "/" } = {}) {
  const user = userEvent.setup();
  const app = renderApp({ api, path });
  await within(screen.getByRole("banner")).findByRole("link", { name: "Log in" });
  await user.click(within(screen.getByRole("contentinfo")).getByRole("button", { name: "Feedback" }));
  const dialog = await screen.findByRole("dialog", { name: /Send us feedback/ });
  return { user, dialog, ...app };
}

const message = () => screen.getByRole("textbox", { name: "Message" });
const send = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Send" });

describe("the Feedback dialog (CC-290)", () => {
  it("opens from the footer with Bug chosen, an empty message and the Hinglish line first", async () => {
    const { dialog } = await openFromFooter();

    expect(within(dialog).getByRole("heading")).toHaveTextContent("Apni raay batao" + "Send us feedback");
    expect(within(dialog).getByRole("radio", { name: "Bug" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Bug" })).toHaveFocus();
    expect(message()).toHaveValue("");
    expect(message()).toHaveAttribute("maxlength", String(FEEDBACK_MESSAGE_MAX));
    expect(within(dialog).getByText(`0 / ${FEEDBACK_MESSAGE_MAX}`)).toBeInTheDocument();
  });

  it("opens from the header menu too, where a phone finds it", async () => {
    const user = userEvent.setup();
    renderApp();
    const banner = screen.getByRole("banner");
    await within(banner).findByRole("link", { name: "Log in" });

    await user.click(within(banner).getByRole("button", { name: "Menu" }));
    await user.click(within(banner).getByRole("button", { name: "Feedback" }));

    expect(await screen.findByRole("dialog", { name: /Send us feedback/ })).toBeVisible();
    // The menu closed under it, so Escape and the focus belong to the dialog alone.
    expect(within(banner).getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(banner).getByRole("button", { name: "Menu" })).toHaveFocus();
  });

  it("opens from the header row on a wide screen, where there is no menu to close, and gives the focus back", async () => {
    const user = userEvent.setup();
    renderApp();
    const banner = screen.getByRole("banner");
    await within(banner).findByRole("link", { name: "Log in" });

    await user.click(within(banner).getByRole("button", { name: "Feedback" }));
    await screen.findByRole("dialog", { name: /Send us feedback/ });
    await user.keyboard("{Escape}");

    expect(within(banner).getByRole("button", { name: "Feedback" })).toHaveFocus();
  });

  it("offers every type there is, each with a name", async () => {
    const { dialog } = await openFromFooter();

    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((radio) => radio.value),
    ).toEqual([...FEEDBACK_TYPES]);
    for (const type of FEEDBACK_TYPES) {
      expect(within(dialog).getByRole("radio", { name: FEEDBACK_TYPE_LABELS[type] })).toBeInTheDocument();
    }
  });

  it("counts the characters as they are typed", async () => {
    const { user, dialog } = await openFromFooter();

    await user.type(message(), "Hello");

    expect(within(dialog).getByText(`5 / ${FEEDBACK_MESSAGE_MAX}`)).toBeInTheDocument();
  });

  it("asks for a message instead of sending an empty one, or one of only spaces", async () => {
    const api = fakeApi();
    const { user, dialog } = await openFromFooter({ api });

    await user.type(message(), "   ");
    await user.click(send());

    expect(message()).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByText("Write a message first.")).toBeInTheDocument();
    expect(api.sendFeedback).not.toHaveBeenCalled();
  });

  it("sends the type, the message and the context, without a query, a room code or an email field", async () => {
    const api = fakeApi({ sendFeedback: vi.fn().mockResolvedValue(SENT) });
    const { user, dialog } = await openFromFooter({ api, path: "/profile?tab=matches#history" });

    await user.click(within(dialog).getByRole("radio", { name: "Idea" }));
    await user.type(message(), "Add Ludo please");
    await user.click(send());

    await screen.findByRole("dialog", { name: /Thank you!/ });
    expect(api.sendFeedback).toHaveBeenCalledWith({
      type: "idea",
      message: "Add Ludo please",
      page: "/profile",
      build: "dev",
      device: "desktop",
    });
  });

  it("names a room by its pattern only", async () => {
    const api = fakeApi({ getSession: async () => GUEST, sendFeedback: vi.fn().mockResolvedValue(SENT) });
    const user = userEvent.setup();
    renderApp({ api, path: "/games/chess/rooms/AB2CD3" });
    await user.click(
      await within(screen.getByRole("contentinfo")).findByRole("button", { name: "Feedback" }),
    );
    await screen.findByRole("dialog", { name: /Send us feedback/ });

    await user.type(message(), "Clock is wrong");
    await user.click(send());

    await screen.findByRole("dialog", { name: /Thank you!/ });
    expect(api.sendFeedback.mock.calls[0][0].page).toBe("/games/chess/rooms/:code");
    expect(JSON.stringify(api.sendFeedback.mock.calls[0][0])).not.toContain("AB2CD3");
  });

  it("thanks the player, and Send another starts again with an empty form", async () => {
    const api = fakeApi({ sendFeedback: vi.fn().mockResolvedValue(SENT) });
    const { user } = await openFromFooter({ api });
    await user.type(message(), "Nice site");

    await user.click(send());
    const thanks = await screen.findByRole("dialog", { name: /Thank you!/ });

    expect(within(thanks).getByText("Shukriya!")).toBeInTheDocument();
    expect(within(thanks).getByText("We read every message.")).toBeInTheDocument();
    await user.click(within(thanks).getByRole("button", { name: "Send another" }));
    expect(message()).toHaveValue("");
  });

  it("keeps an unsent message when the dialog is closed and opened again", async () => {
    const { user } = await openFromFooter();
    await user.type(message(), "Half a thought");

    await user.keyboard("{Escape}");
    await user.click(within(screen.getByRole("contentinfo")).getByRole("button", { name: "Feedback" }));

    expect(message()).toHaveValue("Half a thought");
  });

  it("shows the server's reason when sending fails, and keeps the message", async () => {
    const refused = new AppRequestError({
      code: "RATE_LIMITED",
      message: "You have sent a lot of feedback, thank you! Try again in an hour",
      status: 429,
    });
    const api = fakeApi({ sendFeedback: vi.fn().mockRejectedValue(refused) });
    const { user, dialog } = await openFromFooter({ api });
    await user.type(message(), "Again");

    await user.click(send());

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Try again in an hour");
    expect(message()).toHaveValue("Again");
  });

  it("offers Email me back only when the server says this player may leave one, and sends it only when filled", async () => {
    const api = fakeApi({
      getFeedbackForm: vi.fn().mockResolvedValue({ replyEmail: true }),
      sendFeedback: vi.fn().mockResolvedValue(SENT),
    });
    const { user, dialog } = await openFromFooter({ api });
    await within(dialog).findByRole("textbox", { name: "Email me back (optional)" });

    await user.type(message(), "First");
    await user.click(send());
    await user.click(await screen.findByRole("button", { name: "Send another" }));
    await user.type(screen.getByRole("textbox", { name: "Email me back (optional)" }), " riya@example.com ");
    await user.type(message(), "Second");
    await user.click(send());

    await screen.findByRole("button", { name: "Send another" });
    expect(api.sendFeedback.mock.calls[0][0]).not.toHaveProperty("replyEmail");
    expect(api.sendFeedback.mock.calls[1][0].replyEmail).toBe("riya@example.com");
  });

  it("forgets the draft and the email when the player logs out, so the next person on the phone sees neither", async () => {
    const ADULT = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
    const getFeedbackForm = vi
      .fn()
      .mockResolvedValueOnce({ replyEmail: true })
      .mockResolvedValue({ replyEmail: false });
    const api = fakeApi({ getSession: async () => ADULT, getFeedbackForm });
    const user = userEvent.setup();
    renderApp({ api });
    const banner = screen.getByRole("banner");
    const footer = screen.getByRole("contentinfo");
    await user.click(await within(footer).findByRole("button", { name: "Feedback" }));
    await user.type(message(), "My private thought");
    await user.type(
      await screen.findByRole("textbox", { name: "Email me back (optional)" }),
      "riya@example.com",
    );
    await user.keyboard("{Escape}");

    await user.click(await within(banner).findByRole("button", { name: "Log out" }));
    await within(banner).findByRole("link", { name: "Log in" });
    await user.click(within(footer).getByRole("button", { name: "Feedback" }));

    expect(message()).toHaveValue("");
    await vi.waitFor(() => expect(getFeedbackForm).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("textbox", { name: /Email me back/ })).toBeNull();
    expect(document.body).not.toHaveTextContent("riya@example.com");
  });

  it("hides the email field again on every opening until the server answers", async () => {
    const getFeedbackForm = vi
      .fn()
      .mockResolvedValueOnce({ replyEmail: true })
      .mockReturnValue(new Promise(() => {}));
    const { user } = await openFromFooter({ api: fakeApi({ getFeedbackForm }) });
    await screen.findByRole("textbox", { name: "Email me back (optional)" });

    await user.keyboard("{Escape}");
    await user.click(within(screen.getByRole("contentinfo")).getByRole("button", { name: "Feedback" }));

    expect(screen.queryByRole("textbox", { name: /Email me back/ })).toBeNull();
  });

  it.each([
    ["the server says no", vi.fn().mockResolvedValue({ replyEmail: false })],
    ["the question failed", vi.fn().mockRejectedValue(new Error("down"))],
  ])("has no email field when %s", async (_, getFeedbackForm) => {
    const api = fakeApi({ getFeedbackForm });
    const { dialog } = await openFromFooter({ api });
    await vi.waitFor(() => expect(getFeedbackForm).toHaveBeenCalled());

    expect(within(dialog).queryByRole("textbox", { name: /Email me back/ })).toBeNull();
  });

  it("closes with Cancel and gives the focus back to the button that opened it", async () => {
    const { user, dialog } = await openFromFooter();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(screen.getByRole("contentinfo")).getByRole("button", { name: "Feedback" })).toHaveFocus();
  });
});
