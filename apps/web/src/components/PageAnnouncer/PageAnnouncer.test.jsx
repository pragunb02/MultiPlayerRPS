import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { Link, MemoryRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router";
import { describe, expect, it } from "vitest";
import { LocationProbe } from "../../testing/LocationProbe.jsx";
import { PageAnnouncer } from "./PageAnnouncer.jsx";

const WAIT_MS = 200;
// So long that the wait never runs out first, however busy the machine running the tests is.
const LONG_WAIT_MS = 60_000;

function Shell({ waitMs }) {
  return (
    <>
      <nav>
        <Link to="/about">About</Link>
      </nav>
      <main id="main">
        <Outlet />
      </main>
      <PageAnnouncer waitMs={waitMs} />
    </>
  );
}

function Page({ name, children }) {
  return (
    <>
      <title>{name}</title>
      <h1>{name}</h1>
      {children}
    </>
  );
}

function Tabs() {
  const { tab } = useParams();
  return (
    <Page name={`Tab ${tab}`}>
      <Link to="/tabs/one">One</Link>
      <Link to="/tabs/two">Two</Link>
    </Page>
  );
}

/** Takes the late page one step further. The test says when, so the heading never races the wait. */
let loadMore = () => {};

/**
 * A page whose heading arrives later, like a room that loads over the socket: first "Loading", then "Nearly
 * there", then the heading.
 */
function Late() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    loadMore = () => setStep((now) => now + 1);
  }, []);
  return (
    <>
      <title>Late</title>
      <input aria-label="Name" />
      {step === 0 && <p>Loading</p>}
      {step === 1 && <p>Nearly there</p>}
      {step >= 2 && <h1>Late</h1>}
    </>
  );
}

/** Shows the late page's heading at once. */
function finishLoading() {
  loadMore();
  loadMore();
}

/** A page whose heading can already take focus, so it has a tabindex of its own to keep. */
function OwnTabindex() {
  return (
    <>
      <title>Own</title>
      <h1 tabIndex={-1}>Own</h1>
    </>
  );
}

function renderAt(path, { history = [], waitMs = WAIT_MS } = {}) {
  let navigate;
  const view = render(
    <MemoryRouter initialEntries={[...history, path]} initialIndex={history.length}>
      <Routes>
        <Route element={<Shell waitMs={waitMs} />}>
          <Route
            index
            element={
              <Page name="Home">
                <Link to="/about">Read about us</Link>
                <Link to="/late">Late page</Link>
                <Link to="/empty">Empty page</Link>
              </Page>
            }
          />
          <Route path="about" element={<Page name="About" />} />
          <Route path="tabs/:tab" element={<Tabs />} />
          <Route path="late" element={<Late />} />
          <Route path="empty" element={<title>Empty</title>} />
          <Route path="focused" element={<Focused />} />
          <Route path="own" element={<OwnTabindex />} />
          <Route path="old" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <LocationProbe
        onChange={() => {}}
        onNavigator={(fn) => {
          navigate = fn;
        }}
      />
    </MemoryRouter>,
  );
  return { ...view, navigate: (to) => act(() => navigate(to)) };
}

/** A page that puts focus on its own heading, as the invite chooser does. */
function Focused() {
  return (
    <>
      <title>Focused</title>
      <h1 tabIndex={-1} ref={(node) => node?.focus()}>
        Focused
      </h1>
    </>
  );
}

const announced = () => document.querySelector("[aria-live='polite']").textContent;
const heading = () => screen.getByRole("heading", { level: 1 });

describe("PageAnnouncer", () => {
  it("leaves focus and the announcement alone on the first page", () => {
    renderAt("/");

    expect(document.body).toHaveFocus();
    expect(announced()).toBe("");
  });

  it("leaves focus alone when the first page redirects before anything was pressed", () => {
    renderAt("/old");

    expect(heading()).toHaveTextContent("Home");
    expect(document.body).toHaveFocus();
    expect(announced()).toBe("");
  });

  it("moves focus to the new heading and reads the title after a link in the header", async () => {
    const user = userEvent.setup();
    renderAt("/");

    await user.click(screen.getByRole("link", { name: "About" }));

    expect(heading()).toHaveTextContent("About");
    expect(heading()).toHaveFocus();
    expect(announced()).toBe("About");
  });

  it("moves focus to the new heading after a link on the page that goes away", async () => {
    const user = userEvent.setup();
    renderAt("/");

    await user.click(screen.getByRole("link", { name: "Read about us" }));

    expect(heading()).toHaveFocus();
    expect(announced()).toBe("About");
  });

  it("takes away the tabindex it added once focus leaves the heading", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(screen.getByRole("link", { name: "About" }));
    expect(heading()).toHaveAttribute("tabindex", "-1");

    await user.tab();

    expect(heading()).not.toHaveAttribute("tabindex");
  });

  it("keeps focus on a control that is still on the page, such as a tab, and only announces", async () => {
    const user = userEvent.setup();
    renderAt("/tabs/one");

    await user.click(screen.getByRole("link", { name: "Two" }));

    expect(screen.getByRole("link", { name: "Two" })).toHaveFocus();
    expect(announced()).toBe("Tab two");
  });

  it("counts Back and Forward even when nothing on the page was pressed", () => {
    const view = renderAt("/about", { history: ["/"] });

    view.navigate(-1);

    expect(heading()).toHaveTextContent("Home");
    expect(heading()).toHaveFocus();
    expect(announced()).toBe("Home");
  });

  it("does nothing for a change that keeps the path", async () => {
    const user = userEvent.setup();
    const view = renderAt("/about");
    await user.click(heading());

    view.navigate("/about?tab=2");

    expect(document.body).toHaveFocus();
    expect(announced()).toBe("");
  });

  it("waits for a heading that comes later", async () => {
    const user = userEvent.setup();
    renderAt("/", { waitMs: LONG_WAIT_MS });

    await user.click(screen.getByRole("link", { name: "Late page" }));
    act(() => loadMore());
    await screen.findByText("Nearly there");
    expect(document.body).toHaveFocus();
    expect(announced()).toBe("");
    act(() => loadMore());

    await waitFor(() => expect(heading()).toHaveFocus());
    expect(announced()).toBe("Late");
  });

  it("never takes focus from a player who moved it while the heading was on its way", async () => {
    const user = userEvent.setup();
    renderAt("/", { waitMs: LONG_WAIT_MS });
    await user.click(screen.getByRole("link", { name: "Late page" }));

    await user.click(screen.getByRole("textbox", { name: "Name" }));
    act(() => finishLoading());
    await waitFor(() => expect(announced()).toBe("Late"));

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  it("falls back to main when the page shows no heading in time", async () => {
    const user = userEvent.setup();
    renderAt("/");

    await user.click(screen.getByRole("link", { name: "Empty page" }));

    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus(), { timeout: WAIT_MS * 10 });
    expect(announced()).toBe("Empty");
  });

  it("stops waiting for the last page once the player has gone on to another", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(screen.getByRole("link", { name: "Empty page" }));

    await user.click(screen.getByRole("link", { name: "About" }));
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS + 50));

    expect(heading()).toHaveFocus();
    expect(announced()).toBe("About");
  });

  it("leaves a page that focuses its own heading as it is, and keeps that heading focusable", async () => {
    const user = userEvent.setup();
    const view = renderAt("/");
    await user.click(heading());

    view.navigate("/focused");
    await user.tab();

    expect(announced()).toBe("Focused");
    expect(heading()).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus to a heading that has its own tabindex and leaves that tabindex in place", async () => {
    const user = userEvent.setup();
    const view = renderAt("/");
    await user.click(heading());

    view.navigate("/own");
    expect(heading()).toHaveFocus();
    await user.tab();

    expect(announced()).toBe("Own");
    expect(heading()).toHaveAttribute("tabindex", "-1");
  });
});
