import { useEffect } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { useSound } from "../../hooks/useSound.js";
import { CATEGORIES } from "../../lib/notify/categories.js";
import { SOUNDS } from "../../lib/sound/sounds.js";
import { useToast } from "../Toast/toastContext.js";

/**
 * Tells the player on any page that someone sent them a friend request (CC-052), with the way to see it on the
 * friends page, and a chime. The server sends nothing for a request into a block (ADR-053). It draws nothing itself:
 * the toasts do. It answers each push once its toast is up: only then does the server count the ring as heard by
 * this browser, and a ring no page of it heard comes again when a tab connects (CC-341).
 */
export function FriendRequestToasts() {
  const { socket } = useServices();
  const toast = useToast();
  const sound = useSound();

  useEffect(
    () =>
      socket.on(SOCKET_EVENTS.FRIEND_REQUESTED, ({ displayName }, answer) => {
        toast.show(`${displayName} wants to be your friend`, {
          tone: "info",
          category: CATEGORIES.SOCIAL,
          action: {
            label: "See request",
            to: paths.friends(),
            dismissLabel: "Close",
            onDismiss: () => undefined,
          },
          onShow: () => sound.play(SOUNDS.NOTIFY),
        });
        // The server asks for an answer, so a ring this page never got is sent again when it connects (CC-341).
        answer?.();
      }),
    [socket, toast, sound],
  );

  return null;
}
