import { createContext, useContext } from "react";

/**
 * Dependency injection for the UI: the API and socket clients, the sound player and the message between tabs
 * (`sessionBroadcast`) are provided once at the root, so components and hooks never construct them, and tests
 * provide fakes. The provider lives in ServicesProvider.jsx.
 */
export const ServicesContext = createContext(null);

export function useServices() {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error("useServices must be used inside <ServicesProvider>");
  }
  return services;
}
