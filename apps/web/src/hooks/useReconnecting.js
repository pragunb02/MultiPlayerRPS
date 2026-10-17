import { useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/**
 * Whether the realtime connection dropped and is being restored (CC-164). It turns true when the connection is
 * lost after this hook started, and false again the moment it is back. While it is true, controls that need the
 * server say "Reconnecting" instead of sending something that cannot arrive.
 *
 * @returns {boolean}
 */
export function useReconnecting() {
  const { socket } = useServices();
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const offs = [
      socket.on("disconnect", () => setReconnecting(true)),
      socket.on("connect", () => setReconnecting(false)),
    ];
    return () => offs.forEach((off) => off());
  }, [socket]);

  return reconnecting;
}
