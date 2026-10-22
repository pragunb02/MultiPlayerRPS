import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/**
 * The signed-in account's devices, this one first, a way to sign one of the others out, and a way to read the
 * list again (after "Sign out other devices", CC-262). Only the account's own devices are ever listed.
 *
 * @returns {{
 *   status: "loading" | "ready" | "error",
 *   devices: ReadonlyArray<{ id: string, browser: string, system: string, signedInDay: string, lastSeenDay: string, current: boolean }>,
 *   error: Error | undefined,
 *   signOut: (deviceId: string) => Promise<void>,
 *   reload: () => void,
 * }}
 */
export function useDevices() {
  const { api } = useServices();
  const [state, setState] = useState({ status: "loading", devices: [], error: undefined });
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.getDevices().then(
      (devices) => !cancelled && setState({ status: "ready", devices, error: undefined }),
      (error) => !cancelled && setState({ status: "error", devices: [], error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, reads]);

  /** Signs one device out, and takes it off the list once the server agrees. */
  const signOut = useCallback(
    async (deviceId) => {
      await api.signOutDevice(deviceId);
      setState((current) => ({
        ...current,
        devices: current.devices.filter((device) => device.id !== deviceId),
      }));
    },
    [api],
  );

  const reload = useCallback(() => setReads((count) => count + 1), []);

  return { ...state, signOut, reload };
}
