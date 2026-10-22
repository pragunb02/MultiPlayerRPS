import { useSyncExternalStore } from "react";
import { currentTheme, subscribe } from "./channel.js";

/**
 * The event theme on now, as `{ name, greeting }`, or undefined. Only `EventGreeting` reads it: no component
 * knows a theme by name (CC-328).
 */
export const useEventTheme = () => useSyncExternalStore(subscribe, currentTheme);
