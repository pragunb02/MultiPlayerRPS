import { useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/** The public game catalog. status: "loading" | "ready" | "error" */
export function useGames() {
  const { api } = useServices();
  const [state, setState] = useState({ status: "loading", games: [], error: undefined });

  useEffect(() => {
    let cancelled = false;
    api.getGames().then(
      (games) => !cancelled && setState({ status: "ready", games, error: undefined }),
      (error) => !cancelled && setState({ status: "error", games: [], error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  return state;
}
