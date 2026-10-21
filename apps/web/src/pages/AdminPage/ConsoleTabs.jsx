import { Tabs } from "../../components/Tabs/Tabs.jsx";
import { useFlag } from "../../hooks/useFlag.js";
import { useUxReport } from "../../hooks/useUxReport.js";
import { CONSOLE_PAGES, consoleHref } from "./consolePages.js";
import { ColourBadge } from "./UxBadge.jsx";

/**
 * The UX tab's name, with a red or amber badge when a line of last week's interruption budget is red or amber
 * (CC-313 section 8.9). The badge is a word and a colour, never the colour alone.
 */
function UxLabel({ name, week }) {
  const badge = useUxReport({ section: "badge", enabled: week });
  const colour = badge.report?.badge;
  if (colour !== "red" && colour !== "amber") return name;
  return (
    <>
      {name} <ColourBadge colour={colour} context="last week's interruption budget" />
    </>
  );
}

/**
 * The owner console's tab bar, the same on every console page (CC-290). It is the app's one Tabs (CC-323). A tab
 * behind a flag (the UX page, CC-177) shows only while its flag is on.
 *
 * @param {{ current: string, range?: { from?: string, to?: string, bucket?: string } }} props  `current` is the
 *   shown page's id in CONSOLE_PAGES, and `range` the totals' range to keep in their links
 */
export function ConsoleTabs({ current, range = {} }) {
  const ux = useFlag("console_ux");
  const week = useFlag("console_ux_week");
  const shown = (page) => page.flag === undefined || (page.flag === "console_ux" && ux);
  return (
    <Tabs
      label="Console sections"
      control="admin.tab"
      current={current}
      items={CONSOLE_PAGES.filter(shown).map((page) => ({
        id: page.id,
        label: page.id === "ux" ? <UxLabel name={page.name} week={week} /> : page.name,
        to: consoleHref(page, range),
      }))}
    />
  );
}
