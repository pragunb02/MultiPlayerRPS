import { useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/** The signed-in player's progress. status: "loading" | "ready" | "error" */
export function useProgress() {
  const { api } = useServices();
  const [state, setState] = useState({ status: "loading", progress: undefined, error: undefined });

  useEffect(() => {
    let cancelled = false;
    api.getProgress().then(
      (progress) => !cancelled && setState({ status: "ready", progress, error: undefined }),
      (error) => !cancelled && setState({ status: "error", progress: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  return state;
}
