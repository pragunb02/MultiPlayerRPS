import { Tabs } from "../../components/Tabs/Tabs.jsx";
import { CONSOLE_PAGES, consoleHref } from "./consolePages.js";

/**
 * The owner console's tab bar, the same on every console page (CC-290). It is the app's one Tabs (CC-323).
 *
 * @param {{ current: string, range?: { from?: string, to?: string, bucket?: string } }} props  `current` is the
 *   shown page's id in CONSOLE_PAGES, and `range` the totals' range to keep in their links
 */
export function ConsoleTabs({ current, range = {} }) {
  return (
    <Tabs
      label="Console sections"
      control="admin.tab"
      current={current}
      items={CONSOLE_PAGES.map((page) => ({ id: page.id, label: page.name, to: consoleHref(page, range) }))}
    />
  );
}
