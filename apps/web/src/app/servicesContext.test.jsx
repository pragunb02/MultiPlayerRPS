import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useServices } from "./servicesContext.js";

describe("useServices", () => {
  it("fails loudly when a component is rendered without the services provider", () => {
    // React logs the thrown render error; keep the test output readable.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useServices())).toThrow(
        "useServices must be used inside <ServicesProvider>",
      );
    } finally {
      quiet.mockRestore();
    }
  });
});
