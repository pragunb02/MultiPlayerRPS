import { useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/** What the app knows about the owner console for the person using it (CC-233). */
export const ADMIN_ACCESS = Object.freeze({ CHECKING: "checking", ADMIN: "admin", NONE: "none" });

/**
 * Whether the person using the app may open the owner console. Only an account can be an admin, so guests and
 * visitors are answered without asking the server. The answer is asked again whenever the person changes, and
 * a failed question means no access: the console stays hidden rather than guessing.
 *
 * @returns {"checking" | "admin" | "none"}
 */
export function useAdminAccess() {
  const { api } = useServices();
  const session = useSession();
  const accountId = session.identity?.kind === "user" ? session.identity.id : "";
  const [answer, setAnswer] = useState({ accountId: "", access: ADMIN_ACCESS.NONE });

  useEffect(() => {
    if (accountId === "") {
      return undefined;
    }
    let cancelled = false;
    const settle = (access) => !cancelled && setAnswer({ accountId, access });
    api.getAdminStatus().then(
      (admin) => settle(admin ? ADMIN_ACCESS.ADMIN : ADMIN_ACCESS.NONE),
      () => settle(ADMIN_ACCESS.NONE),
    );
    return () => {
      cancelled = true;
    };
  }, [api, accountId]);

  if (session.status === "loading") {
    return ADMIN_ACCESS.CHECKING;
  }
  if (accountId === "") {
    return ADMIN_ACCESS.NONE;
  }
  return answer.accountId === accountId ? answer.access : ADMIN_ACCESS.CHECKING;
}
