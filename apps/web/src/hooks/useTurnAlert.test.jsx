import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMatchMedia } from "../testing/matchMedia.js";
import { installVisibility } from "../testing/visibility.js";
import { FAVICON, FAVICON_ALERT, TURN_TITLE, useDocumentHidden, useTurnAlert } from "./useTurnAlert.js";

function Page({ yourTurn, title = "Chess · Room AB2CD3" }) {
  useTurnAlert(yourTurn);
  const hidden = useDocumentHidden();
  return <p data-hidden={String(hidden)}>{title}</p>;
}

const icon = () => document.querySelector("link[rel='icon']").getAttribute("href");

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = `<link rel="icon" href="${FAVICON}" />`;
  document.title = "Chess · Room AB2CD3";
});
afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = "";
});

describe("useTurnAlert (CC-104)", () => {
  it("leaves a visible tab alone", () => {
    installVisibility({ hidden: false });

    render(<Page yourTurn />);
    act(() => vi.advanceTimersByTime(3_000));

    expect(document.title).toBe("Chess · Room AB2CD3");
    expect(icon()).toBe(FAVICON);
  });

  it("flashes the title and badges the icon while it is your move in a background tab", () => {
    installVisibility({ hidden: true });

    render(<Page yourTurn />);

    expect(document.title).toBe(TURN_TITLE);
    expect(TURN_TITLE).toBe("Your turn! · ClassiCade");
    expect(icon()).toBe(FAVICON_ALERT);
    act(() => vi.advanceTimersByTime(1_000));
    expect(document.title).toBe("Chess · Room AB2CD3");
    act(() => vi.advanceTimersByTime(1_000));
    expect(document.title).toBe(TURN_TITLE);
  });

  it("changes the title once without flashing for a player who asked for less motion (CC-207)", () => {
    installMatchMedia({ reducedMotion: true });
    installVisibility({ hidden: true });

    render(<Page yourTurn />);
    act(() => vi.advanceTimersByTime(3_000));

    expect(document.title).toBe(TURN_TITLE);
    expect(icon()).toBe(FAVICON_ALERT);
    installMatchMedia();
  });

  it("puts everything back the moment the tab is visible again", () => {
    const tab = installVisibility({ hidden: true });
    render(<Page yourTurn />);

    act(() => tab.setHidden(false));

    expect(document.title).toBe("Chess · Room AB2CD3");
    expect(icon()).toBe(FAVICON);
    act(() => vi.advanceTimersByTime(5_000));
    expect(document.title).toBe("Chess · Room AB2CD3");
  });

  it("starts when the player switches away on their move, and stops once the move is no longer theirs", () => {
    const tab = installVisibility({ hidden: false });
    const view = render(<Page yourTurn />);

    act(() => tab.setHidden(true));
    expect(document.title).toBe(TURN_TITLE);

    view.rerender(<Page yourTurn={false} />);
    expect(document.title).toBe("Chess · Room AB2CD3");
    expect(icon()).toBe(FAVICON);
  });

  it("restores the page's newer title if the page changed it during the alert", () => {
    installVisibility({ hidden: true });
    render(<Page yourTurn />);
    act(() => vi.advanceTimersByTime(1_000));

    document.title = "Chess · Room AB2CD3 (game 2)";
    act(() => vi.advanceTimersByTime(1_000));
    expect(document.title).toBe(TURN_TITLE);
    act(() => vi.advanceTimersByTime(1_000));

    expect(document.title).toBe("Chess · Room AB2CD3 (game 2)");
  });

  it("does not overwrite a title the page set while the turn title was off", () => {
    const tab = installVisibility({ hidden: true });
    render(<Page yourTurn />);
    act(() => vi.advanceTimersByTime(1_000));
    document.title = "Something else";

    act(() => tab.setHidden(false));

    expect(document.title).toBe("Something else");
  });

  it("copes with a page that has no icon link", () => {
    document.head.innerHTML = "";
    installVisibility({ hidden: true });

    expect(() => render(<Page yourTurn />)).not.toThrow();
  });

  it("follows the tab's visibility", () => {
    const tab = installVisibility({ hidden: false });
    const view = render(<Page yourTurn={false} />);
    expect(view.container.querySelector("p").dataset.hidden).toBe("false");

    act(() => tab.setHidden(true));

    expect(view.container.querySelector("p").dataset.hidden).toBe("true");
  });
});
