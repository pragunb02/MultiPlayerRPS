import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../app/App.jsx";
import { fakeApi, fakeSocket } from "./fakes.js";
import { LocationProbe } from "./LocationProbe.jsx";

/**
 * Renders the real app at a URL with fake clients. `url()` is the address bar: path and query. `history` lists
 * pages visited before `path` (oldest first), so `back()` and `forward()` behave like the browser's buttons.
 *
 * @param {{ path?: string, history?: string[], api?: object, socket?: object }} [options]
 */
export function renderApp({ path = "/", history = [], api = fakeApi(), socket = fakeSocket() } = {}) {
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
      <App services={{ api, socket }} />
      <LocationProbe onChange={record} onNavigator={keepNavigator} />
    </MemoryRouter>,
  );
  return {
    ...view,
    api,
    socket,
    url: () => current,
    back: () => act(() => navigate(-1)),
    forward: () => act(() => navigate(1)),
  };
}
