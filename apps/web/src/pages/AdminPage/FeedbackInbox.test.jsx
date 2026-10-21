import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import REPORT from "../../testing/analyticsReport.json";
import { renderApp } from "../../testing/render.jsx";

// CC-290: the owner's feedback inbox in the console.

const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const PLAYER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const T0 = Date.UTC(2026, 9, 20, 6, 30);

let counter = 0;
const item = (fields = {}) => ({
  feedbackId: `00000000-0000-4000-a000-${String(++counter).padStart(12, "0")}`,
  type: "bug",
  message: "The board froze",
  page: "/games/chess/rooms/:code",
  build: "0.1.0+abc1234",
  device: "phone",
  kind: "guest",
  status: "new",
  createdAt: T0,
  updatedAt: T0,
  ...fields,
});

const ownerApi = (overrides = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getFeedbackInbox: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  });

async function openInbox({ path = "/admin/feedback", api = ownerApi() } = {}) {
  const view = renderApp({ path, api });
  await screen.findByRole("heading", { name: "Feedback" });
  return { user: userEvent.setup(), ...view };
}

const entries = () => screen.queryAllByRole("article");

afterEach(() => vi.restoreAllMocks());

describe("the feedback inbox (CC-290)", () => {
  it.each([
    ["a visitor", fakeApi()],
    ["a guest", fakeApi({ getSession: async () => GUEST })],
    ["an account that is not an admin", fakeApi({ getSession: async () => PLAYER })],
  ])("shows %s the ordinary not found page, without asking for any feedback", async (_, api) => {
    renderApp({ path: "/admin/feedback", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(api.getFeedbackInbox).not.toHaveBeenCalled();
  });

  it("shows the not found page when the server will not say it has an inbox", async () => {
    const api = ownerApi({
      getFeedbackInbox: vi
        .fn()
        .mockRejectedValue(new AppRequestError({ code: "NOT_FOUND", message: "Not found", status: 404 })),
    });
    renderApp({ path: "/admin/feedback", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  it("lists each item with its type, status, time, page, device, sender kind and build, in the server's order", async () => {
    const api = ownerApi({
      getFeedbackInbox: vi.fn().mockResolvedValue({
        items: [item({ message: "Newest", type: "idea" }), item({ message: "Older", status: "done" })],
      }),
    });
    await openInbox({ api });

    const [first, second] = await screen.findAllByRole("article");
    expect(within(first).getByText("Newest")).toBeInTheDocument();
    expect(within(first).getByText("Idea")).toBeInTheDocument();
    expect(within(first).getByText("New")).toBeInTheDocument();
    expect(first).toHaveTextContent("20 Oct 2026");
    expect(first).toHaveTextContent("/games/chess/rooms/:code");
    expect(first).toHaveTextContent("phone");
    expect(first).toHaveTextContent("guest");
    expect(first).toHaveTextContent("0.1.0+abc1234");
    expect(within(second).getByText("Done")).toBeInTheDocument();
    expect(api.getFeedbackInbox).toHaveBeenCalledWith({});
  });

  it("shows markup in a message and in a reply email as the characters typed, never as HTML", async () => {
    const message = '<img src=x onerror="alert(1)"><b>bold</b>';
    const listed = item({ message, hasReplyEmail: true });
    const api = ownerApi({
      getFeedbackInbox: vi.fn().mockResolvedValue({ items: [listed] }),
      getFeedbackItem: vi.fn().mockResolvedValue({ ...listed, replyEmail: "<i>x</i>@example.com" }),
    });
    const { user } = await openInbox({ api });
    const [entry] = await screen.findAllByRole("article");

    await user.click(within(entry).getByRole("button", { name: "Details" }));

    expect(within(entry).getByText(message)).toBeInTheDocument();
    expect(await within(entry).findByText("Reply to <i>x</i>@example.com")).toBeInTheDocument();
    expect(entry.querySelector("img, b, i, script")).toBeNull();
  });

  it("shows a reply email only in the item's own view, never in the list", async () => {
    const withEmail = item({ hasReplyEmail: true });
    const api = ownerApi({
      getFeedbackInbox: vi.fn().mockResolvedValue({ items: [withEmail, item({ kind: "visitor" })] }),
      getFeedbackItem: vi.fn().mockResolvedValue({ ...withEmail, replyEmail: "riya@example.com" }),
    });
    const { user } = await openInbox({ api });
    const [first, second] = await screen.findAllByRole("article");
    expect(first).toHaveTextContent("Has a reply email");
    expect(first).not.toHaveTextContent("riya@example.com");
    expect(second).not.toHaveTextContent("reply email");

    const details = within(first).getByRole("button", { name: "Details" });
    await user.click(details);

    expect(await within(first).findByText("Reply to riya@example.com")).toBeInTheDocument();
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(api.getFeedbackItem).toHaveBeenCalledWith(withEmail.feedbackId);
    await user.click(details);
    expect(first).not.toHaveTextContent("riya@example.com");
  });

  it("says so in the item's view when it has no reply email", async () => {
    const plain = item();
    const api = ownerApi({
      getFeedbackInbox: vi.fn().mockResolvedValue({ items: [plain] }),
      getFeedbackItem: vi.fn().mockResolvedValue(plain),
    });
    const { user } = await openInbox({ api });
    const [entry] = await screen.findAllByRole("article");

    await user.click(within(entry).getByRole("button", { name: "Details" }));

    expect(await within(entry).findByText("No reply email.")).toBeInTheDocument();
  });

  it("says why the item's view could not be opened", async () => {
    const api = ownerApi({
      getFeedbackInbox: vi.fn().mockResolvedValue({ items: [item()] }),
      getFeedbackItem: vi
        .fn()
        .mockRejectedValue(
          new AppRequestError({ code: "NOT_FOUND", message: "No such feedback", status: 404 }),
        ),
    });
    const { user } = await openInbox({ api });
    const [entry] = await screen.findAllByRole("article");

    await user.click(within(entry).getByRole("button", { name: "Details" }));

    expect(await within(entry).findByRole("alert")).toHaveTextContent("No such feedback");
  });

  it("deletes an item after a confirmation, and Cancel keeps it", async () => {
    const gone = item({ message: "My phone is in here somewhere" });
    const api = ownerApi({
      getFeedbackInbox: vi.fn().mockResolvedValue({ items: [gone, item({ message: "Kept" })] }),
    });
    const { user } = await openInbox({ api });
    const [entry] = await screen.findAllByRole("article");

    await user.click(within(entry).getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete this feedback?" })).getByRole("button", {
        name: "Cancel",
      }),
    );
    await user.click(within(entry).getByRole("button", { name: "Delete" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deleteFeedback).not.toHaveBeenCalled();
    await user.click(within(entry).getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete this feedback?" })).getByRole("button", {
        name: "Delete for good",
      }),
    );

    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(api.deleteFeedback).toHaveBeenCalledWith(gone.feedbackId);
    expect(screen.queryByText("My phone is in here somewhere")).toBeNull();
    expect(screen.getByText("Kept")).toBeInTheDocument();
  });

  it("filters by type and status from the address, and a new filter is a new address", async () => {
    const api = ownerApi();
    const { user, url } = await openInbox({ path: "/admin/feedback?type=bug", api });

    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("bug");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "new");

    expect(url()).toBe("/admin/feedback?type=bug&status=new");
    expect(api.getFeedbackInbox.mock.calls.map(([query]) => query)).toEqual([
      { type: "bug" },
      { type: "bug", status: "new" },
    ]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "");
    expect(url()).toBe("/admin/feedback?status=new");
  });

  it("says when there is nothing to show", async () => {
    await openInbox();

    expect(await screen.findByRole("heading", { name: "Nothing here yet." })).toBeInTheDocument();
  });

  it("marks an item read, then done, and shows its new status", async () => {
    const first = item();
    const api = ownerApi({
      getFeedbackInbox: vi.fn().mockResolvedValue({ items: [first, item({ message: "Untouched" })] }),
      setFeedbackStatus: vi.fn(async (feedbackId, status) => ({ ...first, status })),
    });
    const { user } = await openInbox({ api });
    const [entry] = await screen.findAllByRole("article");

    await user.click(within(entry).getByRole("button", { name: "Mark read" }));
    await within(entry).findByText("Read");
    await user.click(within(entry).getByRole("button", { name: "Mark done" }));

    await within(entry).findByText("Done");
    expect(within(entry).getByRole("button", { name: "Mark new" })).toBeInTheDocument();
    expect(within(screen.getAllByRole("article")[1]).getByText("New")).toBeInTheDocument();
    expect(api.setFeedbackStatus.mock.calls).toEqual([
      [first.feedbackId, "read"],
      [first.feedbackId, "done"],
    ]);
  });

  it("loads older items under the list", async () => {
    const api = ownerApi({
      getFeedbackInbox: vi
        .fn()
        .mockResolvedValueOnce({ items: [item({ message: "Page one" })], next: "1_x" })
        .mockResolvedValueOnce({ items: [item({ message: "Page two" })] }),
    });
    const { user } = await openInbox({ path: "/admin/feedback?status=new", api });
    await screen.findByText("Page one");

    await user.click(screen.getByRole("button", { name: "Older" }));

    await screen.findByText("Page two");
    expect(entries()).toHaveLength(2);
    expect(api.getFeedbackInbox).toHaveBeenLastCalledWith({ status: "new", before: "1_x" });
    expect(screen.queryByRole("button", { name: "Older" })).toBeNull();
  });

  it("drops an older page that arrives after the filters changed", async () => {
    let answerOlder;
    const api = ownerApi({
      getFeedbackInbox: vi.fn(async (query) => {
        if (query.before !== undefined) return new Promise((resolve) => (answerOlder = resolve));
        return query.type === "idea"
          ? { items: [item({ message: "An idea" })] }
          : { items: [item({ message: "Page one" })], next: "1_x" };
      }),
    });
    const { user } = await openInbox({ api });
    await screen.findByText("Page one");

    await user.click(screen.getByRole("button", { name: "Older" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "idea");
    await screen.findByText("An idea");
    await act(async () => answerOlder({ items: [item({ message: "Old page of all types" })] }));

    expect(screen.queryByText("Old page of all types")).toBeNull();
    expect(entries()).toHaveLength(1);
  });

  it("says what went wrong and tries again on request", async () => {
    const api = ownerApi({
      getFeedbackInbox: vi
        .fn()
        .mockRejectedValueOnce(
          new AppRequestError({ code: "INTERNAL", message: "Something broke", status: 500 }),
        )
        .mockResolvedValueOnce({ items: [item({ message: "Back again" })] }),
    });
    const { user } = await openInbox({ api });

    expect(await screen.findByRole("alert")).toHaveTextContent("Something broke");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Back again")).toBeInTheDocument();
  });

  it("offers no Retry for a failure that trying again cannot fix (CC-323)", async () => {
    const api = ownerApi({
      getFeedbackInbox: vi
        .fn()
        .mockRejectedValue(
          new AppRequestError({ code: "VALIDATION_FAILED", message: "Bad filter", status: 400 }),
        ),
    });
    await openInbox({ api });

    expect(await screen.findByRole("alert")).toHaveTextContent("Bad filter");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows the same console tabs as every other console page, with Feedback as the current one", async () => {
    const tabNames = () =>
      within(screen.getByRole("navigation", { name: "Console sections" }))
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("aria-current")]);
    const api = ownerApi({ getAnalytics: vi.fn().mockResolvedValue(REPORT) });
    const inbox = renderApp({ path: "/admin/feedback", api });
    await screen.findByRole("heading", { name: "Feedback" });
    const onInbox = tabNames();
    inbox.unmount();
    renderApp({ path: "/admin", api });
    await screen.findByRole("heading", { name: "Owner console" });

    expect(onInbox.map(([name]) => name)).toEqual(tabNames().map(([name]) => name));
    expect(onInbox.map(([name]) => name)).toEqual([
      "Overview",
      "Statuses",
      "Players",
      "Games",
      "Retention",
      "Conversion",
      "Engagement",
      "Feedback",
      "Ages",
      "Flags",
      "Design",
    ]);
    expect(onInbox.filter(([, current]) => current === "page")).toEqual([["Feedback", "page"]]);
    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "/admin/feedback");
    expect(screen.getByRole("link", { name: "Flags" })).toHaveAttribute("href", "/admin/flags");
    expect(screen.getByRole("link", { name: "Design" })).toHaveAttribute("href", "/admin/design");
  });
});
