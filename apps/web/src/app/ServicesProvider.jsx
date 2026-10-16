import { ServicesContext } from "./servicesContext.js";

/** @param {{ services: { api: object, socket: object }, children: import("react").ReactNode }} props */
export function ServicesProvider({ services, children }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}
