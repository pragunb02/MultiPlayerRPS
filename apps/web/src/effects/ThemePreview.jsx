import { useSyncExternalStore } from "react";
import { Button } from "../components/Button/Button.jsx";
import { currentPreview, previewTheme, subscribe } from "./channel.js";
import { EFFECTS } from "./registry.js";

/**
 * "Preview in this tab" beside a theme's flag in the console's Flags tab (CC-328, AC-7): the owner sees a theme
 * before its window opens. It ignores the flag and the window, shows in this tab only and is stored nowhere, so a
 * reload ends it. Nothing for a flag that is not a theme's. Only admins reach the console (ADR-036).
 *
 * @param {{ flag: string }} props  the flag's name
 */
export function ThemePreview({ flag }) {
  const preview = useSyncExternalStore(subscribe, currentPreview);
  const theme = EFFECTS.find((entry) => entry.kind === "theme" && entry.flag === flag);
  if (theme === undefined) return null;
  const on = preview === theme.name;
  return (
    <Button
      control="admin.flags.preview"
      variant="secondary"
      onClick={() => previewTheme(on ? undefined : theme.name)}
    >
      {on ? "Stop the preview" : "Preview in this tab"}
    </Button>
  );
}
