// The decision gate in CI (CC-311, ADR-072): every ticket at Ready or later has its open decisions answered, or
// past their default day, and at least one acceptance criterion with an id.
//
//   node scripts/bin/check-tickets.mjs
//
// This file only reads files and the date. The behaviour lives in scripts/tickets/checkTickets.mjs, where it is
// tested. Today is the day in UTC, so a default day counts as come from its start in UTC.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkTicket, isTemplateName } from "../tickets/checkTickets.mjs";

const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../docs/tickets");
const today = new Date().toISOString().slice(0, 10);
const names = readdirSync(folder).filter((name) => name.endsWith(".md") && !isTemplateName(name));
const problems = names.flatMap((name) =>
  checkTicket({ name, text: readFileSync(path.join(folder, name), "utf8"), today }),
);
for (const problem of problems) process.stderr.write(`${problem}\n`);
if (problems.length > 0) {
  process.stderr.write(
    "Answer each open decision or wait for its default day, and give each criterion an id (docs/PROCESS.md).\n",
  );
  process.exit(1);
}
process.stdout.write(`${names.length} ticket file(s) pass the decision gate.\n`);
