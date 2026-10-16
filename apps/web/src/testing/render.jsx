import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../app/App.jsx";
import { fakeApi, fakeSocket } from "./fakes.js";
import { LocationProbe } from "./LocationProbe.jsx";

/**
 * Renders the real app at a URL with fake clients. `url()` is the address bar: path and query.
 *
 * @param {{ path?: string, api?: object, socket?: object }} [options]
 */
export function renderApp({ path = "/", api = fakeApi(), socket = fakeSocket() } = {}) {
  let current = path;
  const record = (url) => {
    current = url;
  };
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={{ api, socket }} />
      <LocationProbe onChange={record} />
    </MemoryRouter>,
  );
  return { ...view, api, socket, url: () => current };
}
