import { render, screen } from "@testing-library/react";
import { Component, Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { lazyBoard, lazyEngine } from "./lazyBoard.js";

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>Something went wrong</p> : this.props.children;
  }
}

function show(Board) {
  render(
    <Boundary>
      <Suspense fallback={<p>Loading the board</p>}>
        <Board label="Test board" />
      </Suspense>
    </Boundary>,
  );
}

describe("lazyBoard", () => {
  it("shows the named export of the module once it has downloaded", async () => {
    const Board = lazyBoard(async () => ({ TestBoard: ({ label }) => <p>{label}</p> }), "TestBoard");

    show(Board);

    expect(await screen.findByText("Test board")).toBeInTheDocument();
  });

  it("keeps waiting instead of failing while the page reloads for a newer version", async () => {
    const load = vi.fn(async () => undefined);
    const Board = lazyBoard(load, "TestBoard");

    show(Board);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByText("Loading the board")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("lets any other failure reach the error page", async () => {
    const Board = lazyBoard(async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    }, "TestBoard");
    // React reports the error it caught. That report is expected here.
    const report = vi.spyOn(console, "error").mockImplementation(() => {});

    show(Board);

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    report.mockRestore();
  });
});

describe("lazyEngine (CC-223)", () => {
  it("gives the named export of the module once it has downloaded", async () => {
    const engine = { id: "fake" };
    const load = lazyEngine(async () => ({ fakeEngine: engine }), "fakeEngine");

    await expect(load()).resolves.toBe(engine);
  });

  it("keeps waiting instead of failing while the page reloads for a newer version", async () => {
    const load = lazyEngine(async () => undefined, "fakeEngine");
    const tooLate = new Promise((resolve) => setTimeout(() => resolve("still waiting"), 20));

    await expect(Promise.race([load(), tooLate])).resolves.toBe("still waiting");
  });

  it("passes any other failure on, for the page to show", async () => {
    const load = lazyEngine(async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    }, "fakeEngine");

    await expect(load()).rejects.toThrow(TypeError);
  });
});
