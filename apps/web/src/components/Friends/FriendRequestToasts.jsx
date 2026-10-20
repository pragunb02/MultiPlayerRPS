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
 * the toasts do.
 */
export function FriendRequestToasts() {
  const { socket } = useServices();
  const toast = useToast();
  const sound = useSound();

  useEffect(
    () =>
      socket.on(SOCKET_EVENTS.FRIEND_REQUESTED, ({ displayName }) => {
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
      }),
    [socket, toast, sound],
  );

  return null;
}
