import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import indexSource from "../../../index.html?raw";
import { WakingUpCabinet } from "./WakingUp.jsx";

const TITLE = "Waking up the arcade…";

/** A session check whose answer the test gives when it wants to. */
function heldSession() {
  const held = {};
  const api = fakeApi({
    getSession: () =>
      new Promise((resolve, reject) => {
        held.answer = resolve;
        held.fail = reject;
      }),
  });
  return { api, held };
}

/** The shape of a drawing: each element's tag, classes and own text, nested. Spacing in the markup is ignored. */
function shape(element) {
  return {
    tag: element.tagName.toLowerCase(),
    classes: element.className,
    hidden: element.getAttribute("aria-hidden"),
    text: [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .join(""),
    children: [...element.children].map(shape),
  };
}

function indexHtml() {
  return new DOMParser().parseFromString(indexSource, "text/html");
}

describe("WakingUp", () => {
  it("tells the player the free server is waking up while the session check waits", () => {
    const { api } = heldSession();

    renderApp({ api });

    expect(screen.getByText(TITLE).closest("[role='status']")).not.toBeNull();
    expect(screen.getByText("Free servers take a moment to wake up.")).toBeInTheDocument();
    expect(screen.getByText(/can take up to a minute/)).toBeInTheDocument();
  });

  it("goes as soon as the server says who the player is", async () => {
    const { api, held } = heldSession();
    renderApp({ api });

    await act(async () => held.answer({ kind: "guest", id: "g1", displayName: "Guest 1" }));

    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("goes when the session check fails, so it never claims to be waking up a server that answered", async () => {
    const { api, held } = heldSession();
    renderApp({ api });

    await act(async () => held.fail(new Error("Network down")));

    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("is not there once the session is known", async () => {
    renderApp();

    await act(async () => {});

    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

describe("the waking up screen in index.html", () => {
  it("draws the same cabinet as the app, so both screens look the same", () => {
    const page = indexHtml().querySelector("[data-wake='page'] .wake-cabinet");
    const { container } = render(<WakingUpCabinet />);

    expect(shape(page)).toEqual(shape(container.firstElementChild));
  });

  it("sits inside the app's root, which React empties on its first render", () => {
    const wake = indexHtml().querySelector("[data-wake='page']");

    expect(wake.parentElement.id).toBe("root");
    expect(wake.getAttribute("role")).toBe("status");
    expect(wake.querySelector(".wake-title").textContent).toBe(TITLE);
  });

  it("needs no inline style or script, which the content security policy would block", () => {
    const document = indexHtml();

    expect(document.querySelectorAll("[style], style")).toHaveLength(0);
    expect([...document.querySelectorAll("script")].every((script) => script.hasAttribute("src"))).toBe(true);
  });
});
