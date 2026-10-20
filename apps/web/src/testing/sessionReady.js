import { screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/** Waits until a mounted `SessionStatus` (SessionStatus.jsx) shows a ready session (CC-288). */
export function sessionReady() {
  return waitFor(() => expect(screen.getByTestId("session-status")).toHaveTextContent("ready"));
}
