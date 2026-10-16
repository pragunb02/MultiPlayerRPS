import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../app/App.jsx";
import { fakeApi, fakeSocket } from "./fakes.js";

/**
 * Renders the real app at a URL with fake clients.
 *
 * @param {{ path?: string, api?: object, socket?: object }} [options]
 */
export function renderApp({ path = "/", api = fakeApi(), socket = fakeSocket() } = {}) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={{ api, socket }} />
    </MemoryRouter>,
  );
  return { ...view, api, socket };
}
