import { act, render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "../app/App.jsx";
import { fakeApi, fakeDownload, fakeSessionBroadcast, fakeSocket, fakeSound } from "./fakes.js";
import { LocationProbe } from "./LocationProbe.jsx";

/**
 * Renders the real app at a URL with fake clients. `url()` is the address bar: path and query. `history` lists
 * pages visited before `path` (oldest first), so `back()` and `forward()` behave like the browser's buttons.
 *
 * @param {{
 *   path?: string,
 *   history?: string[],
 *   api?: object,
 *   socket?: object,
 *   sound?: object,
 *   sessionBroadcast?: object,
 *   download?: object,
 * }} [options]
 */
export function renderApp({
  path = "/",
  history = [],
  api = fakeApi(),
  socket = fakeSocket(),
  sound = fakeSound(),
  sessionBroadcast = fakeSessionBroadcast(),
  download = fakeDownload(),
} = {}) {
  let current = path;
  let navigate;
  const record = (url) => {
    current = url;
  };
  const keepNavigator = (fn) => {
    navigate = fn;
  };
  const view = render(
    <MemoryRouter initialEntries={[...history, path]} initialIndex={history.length}>
      <App services={{ api, socket, sound, sessionBroadcast, download }} />
      <LocationProbe onChange={record} onNavigator={keepNavigator} />
    </MemoryRouter>,
  );
  return {
    ...view,
    api,
    socket,
    sound,
    sessionBroadcast,
    download,
    url: () => current,
    back: () => act(() => navigate(-1)),
    forward: () => act(() => navigate(1)),
  };
}

/**
 * Finds a button by its name once it can act. Some buttons are on the page before they can act, such as Play as a
 * guest while the session is still being checked, and a press then only says why. The check finishes in an effect,
 * which can run a moment after the button shows, later still on a busy machine (CC-288).
 *
 * @param {string | RegExp} name
 */
export async function findUsableButton(name) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  return button;
}
