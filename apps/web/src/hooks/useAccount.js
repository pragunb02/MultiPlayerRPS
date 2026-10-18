import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/**
 * The signed-in player's own account (CC-152): username, birth year if stated, and the age group it gives.
 * status: "loading" | "ready" | "error"
 */
export function useAccount() {
  const { api } = useServices();
  const [state, setState] = useState({ status: "loading", account: undefined, error: undefined });

  useEffect(() => {
    let cancelled = false;
    api.getAccount().then(
      (account) => !cancelled && setState({ status: "ready", account, error: undefined }),
      (error) => !cancelled && setState({ status: "error", account: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  /** Sets the birth year, which can be done once, and shows the account as the server answers it. */
  const setBirthYear = useCallback(
    async (birthYear) => {
      const account = await api.setBirthYear(birthYear);
      setState({ status: "ready", account, error: undefined });
    },
    [api],
  );

  return { ...state, setBirthYear };
}
