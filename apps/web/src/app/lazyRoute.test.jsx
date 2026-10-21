import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { lazyRoute } from "./lazyRoute.jsx";

/** A download the test finishes by hand, to see the page before and after its code arrives. */
function heldDownload(module) {
  let finish;
  const load = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(module);
      }),
  );
  return { load, finish: () => act(async () => finish()) };
}

/** A page with state of its own, to tell whether it was drawn again from scratch. */
function CounterPage({ label }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {label} {count}
    </button>
  );
}

describe("lazyRoute: a page that downloads on demand (CC-322)", () => {
  it("holds the page's place with a skeleton while it downloads, then shows the page", async () => {
    const { load, finish } = heldDownload({ TestPage: ({ label }) => <h1>{label}</h1> });
    const Page = lazyRoute(load, "TestPage");

    const { container } = render(<Page label="Lobby" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading the page");
    expect(container.querySelector("[data-route-skeleton]")).toHaveAttribute("aria-busy", "true");
    await finish();
    expect(screen.getByRole("heading", { name: "Lobby" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a page fetched early at once, with no skeleton in between", async () => {
    const Page = lazyRoute(async () => ({ TestPage: () => <h1>Lobby</h1> }), "TestPage");

    await Page.preload();
    render(<Page />);

    expect(screen.getByRole("heading", { name: "Lobby" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("downloads the code once, however often it is asked for", async () => {
    const load = vi.fn(async () => ({ TestPage: () => <h1>Lobby</h1> }));
    const Page = lazyRoute(load, "TestPage");

    await Promise.all([Page.preload(), Page.preload()]);
    render(<Page />);

    expect(load).toHaveBeenCalledOnce();
  });

  it("keeps the page and its state when it is drawn again after its code arrived", async () => {
    const user = userEvent.setup();
    const { load, finish } = heldDownload({ CounterPage });
    const Page = lazyRoute(load, "CounterPage");

    const view = render(<Page label="Presses" />);
    await finish();
    await user.click(screen.getByRole("button", { name: "Presses 0" }));
    view.rerender(<Page label="Taps" />);

    expect(screen.getByRole("button", { name: "Taps 1" })).toBeInTheDocument();
  });

  it("forgets a failed early download, so the next attempt tries again", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValue({ TestPage: () => <h1>Lobby</h1> });
    const Page = lazyRoute(load, "TestPage");

    await expect(Page.preload()).rejects.toThrow("Failed to fetch");
    await Page.preload();
    render(<Page />);

    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Lobby" })).toBeInTheDocument();
  });

  it("keeps the skeleton instead of failing while the page reloads for a newer version", async () => {
    const load = vi.fn(async () => undefined);
    const Page = lazyRoute(load, "TestPage");

    render(<Page />);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.getByRole("status")).toHaveTextContent("Loading the page");
  });

  it("is named after its page in React's developer tools", () => {
    expect(lazyRoute(async () => ({}), "TestPage").displayName).toBe("LazyRoute(TestPage)");
  });
});
