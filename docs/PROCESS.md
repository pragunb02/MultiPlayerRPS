# How a ticket goes from idea to done

The decision-first process (owner, 2026-10-20, [CC-311](tickets/CC-311.md), ADR-072). CLAUDE.md has the short
rules. This file has the detail. Where they differ, CLAUDE.md wins.

## Why

Builders used to start with questions still open, guess the answers, and the owner changed them in review. Each
guess cost a second build. Asking first, all at once, and writing the answers down costs one message.

## The stages

A ticket file's Status row says where it is, one word from this list.

| Status      | What happens                                                                                  | Who               |
| ----------- | --------------------------------------------------------------------------------------------- | ----------------- |
| Shaping     | Problem, job, appetite, a sketch, and the open decisions with a recommended default for each. | Coordinator       |
| Spec review | The review lenses read the filled ticket (below).                                             | Reviewer agents   |
| Ready       | Every open decision is answered or its default day has passed. A builder may start.           | Coordinator       |
| Building    | One builder, from fresh `main`, on the files the ticket lists.                                | Builder           |
| Rolling out | Merged behind its flag, ramping (CC-312).                                                     | Coordinator       |
| Done        | Fully rolled out.                                                                             | Coordinator       |
| Reviewed    | The post-launch review, about two weeks after full rollout, says keep, iterate or remove.     | Coordinator/owner |

Tickets written before CC-311 keep their old emoji statuses and are not checked.

## Two templates

- **Full**, [tickets/TEMPLATE.md](tickets/TEMPLATE.md): anything with a choice for the owner, a new screen, new
  data, a new interface or a flag.
- **Lite**, [tickets/TEMPLATE-lite.md](tickets/TEMPLATE-lite.md): work you can describe in one sentence (a bug fix,
  a test fix, a small docs change). Problem, fix, acceptance criteria, test, files.

A ticket says which in its Template row. When in doubt, use the full one. Every ticket gets a file, small ones
included. A small one (under about an hour) gets Root cause and a short Research note (working agreement rule 4).
The board's 🟦 comes from the PR's fragment ([changes/README.md](changes/README.md)), or from the coordinator at
dispatch.

## 1. The shaping interview

Before writing the spec, the coordinator asks the owner **all** of a ticket's questions in one message: the words
players will read, the defaults, privacy and minors, what is out of scope. Not one question at a time across a
day. What the owner does not answer becomes an Open decisions row with a recommended default.

## 2. Open decisions and the owner decision list

Each ticket's Open decisions table has five columns: question, options, recommended default, owner answer, and the
day the default applies (usually two days after the question is asked).

The coordinator gathers the open rows of every ticket into one list, [DECISIONS-PENDING.md](DECISIONS-PENDING.md),
each with its options and recommended default, and sends it to the owner as one batch. The owner answers once. The
coordinator then:

1. writes each answer in the ticket's Owner answer cell,
2. records it in the ticket's ADR (or a new ADR, with a number the coordinator assigns),
3. removes the row from DECISIONS-PENDING.md.

A row with no answer on its default day takes the recommended default. The coordinator notes "default applied" in
the Owner answer cell and the ADR says "Accepted by default (owner may change)".

## 3. The decision gate

**No builder starts until every open decision is answered by the owner or its default day has passed.** CI checks
it: the `Changelog fragments` job runs `node scripts/bin/check-tickets.mjs`, which fails when a ticket at Ready or
later has an Open decisions row with an empty question, options or default, or with no owner answer before its
default day, or has no acceptance criterion with an id (`AC-1`). The logic is in `scripts/tickets/checkTickets.mjs`.

## 4. Spec review, then code review

The same lenses review twice:

1. **The filled ticket, before build:** code (is it buildable, are the interfaces and tests right), security (the
   threat model and privacy checklist), design (for anything players see), then a skeptic who tries to refute each
   finding.
2. **The code, after build, against the ticket's acceptance criteria.** The PR template lists each AC with its
   evidence.

Both block only on correctness, security or a missing requirement. Anything else becomes a follow-up ticket or a
note in the ticket: design findings below high severity become follow-up tickets (owner, 2026-10-20, CLAUDE.md
workflow rule 9).

## 5. Appetite and the cut line

The appetite (S, M or L in agent-hours) is a budget, not an estimate. A build that runs over cuts scope at the cut
line. It is not extended. What was cut is written in the ticket and, if still wanted, becomes a new ticket.

## 6. Files touched

Every full ticket lists the files and areas it changes. The coordinator never runs two builders on overlapping
areas at once (CLAUDE.md workflow rule 9).

## 7. Flags

New player-facing features ship behind a flag (CC-312, how below), off by default, with a ramp, a rollback trigger
and a removal date in the ticket's Rollout section. The flag is removed by its removal date, as its own small
ticket if needed.

## How a feature ships behind a flag

The flags are our own (CC-312, ADR-073). The registry is `packages/shared/src/flags.js`, and the owner changes a
rollout in the console's Flags tab, `/admin/flags`, without a deploy.

1. **Add the flag** in the feature's pull request: a snake case `name`, a `description` in plain words, the owning
   `ticket`, `default: false`, `rollout: "off"`, the `audience` (everyone, signed-in, adults or admins), `client`
   (true only if the web app reads it), the one `success` event, and `removeBy`, at most about 90 days ahead.
2. **Read it by name, written out in full.** On the server `await flags.isOn("name", player)`, in the web app
   `useFlag("name")`. A name not in the registry throws, and a test that reads the source fails.
3. **Test both paths.** Wrap the feature's tests in `flagPaths("name", (on) => …)` (server or web
   `testing/flagPaths.js`), so the tests run once on and once off. A flag without such a suite fails CI.
4. **Count its success.** The web app sends `api.sendFlagSuccess("name")` once when the feature did its job; server
   code calls `flags.recordSuccess("name", player)`. Counts are anonymous (ADR-034).
5. **Merge with the flag off.** Production does not change. The ticket's Status becomes Rolling out.
6. **Ramp.** In the console: admins only first (or On for an admins audience), then 5 %, 25 %, 50 % and On, a day
   or more apart. Compare successes per time shown on the on and off sides at each step. A ramp only adds players:
   everyone who had it at 5 % still has it at 25 %.
7. **Roll back** by setting Off in the console. It applies at once on that server and within 30 seconds anywhere
   else. If the database is unreachable, each server keeps the last overrides for 5 minutes, then uses the code's
   rollout, which is off.
8. **Remove the flag** by its `removeBy` day. First, in the console, press "Use the rollout in code" so no override
   is left. Then, in its own small pull request, delete the old path, the `isOn` or `useFlag` call, the `flagPaths`
   wrapper and the registry entry. An override left behind is listed in the Flags tab under "Overrides of removed
   flags", with a Clear button. A flag past its day fails CI, so this is never forgotten. Moving the day is a
   reviewed change with a reason.

## 8. After launch

About two weeks after full rollout, the coordinator writes the ticket's Post-launch review: the success metric
against its target, the guardrail, and the call (keep, iterate or remove). Then the Status becomes Reviewed.

## The working agreement in full (owner, 17 October 2026)

Moved here from CLAUDE.md in CC-302, word for word apart from the note in brackets after rule 6. CLAUDE.md keeps one line per rule with the same numbers. These
rules come first: where they differ from anything else in CLAUDE.md or the docs, they win.

1. **Feature freeze.** No new feature or idea tickets until every ticket already on the board is closed, across all
   phases, in the order set by `docs/PRODUCT_VISION.md`. New ideas are written down in `docs/IDEAS.md` only, not as
   tickets, and are not started.
2. **Allowed new tickets:** security (always), testing (unit, integration, browser), and bugs in things that already
   exist. These are fixes, not new ideas.
3. **Security is P0 by default.** It drops to P1 only when a higher priority P0 is already in progress. A security
   issue is never cut or deferred without the owner.
4. **Research before code.** Every ticket starts with a Research section in its ticket file before any code: how our
   code does it today, how other products do it (with sources), and what is best for ClassiCade. Coding starts after
   that section is written. A small fix under an hour (one-line hotfix, test fix) still gets a ticket file with Root
   cause and a short Research note, written before the PR is merged.
5. **Document everything.** Decisions go in `docs/DECISIONS.md`, research in the ticket or `docs/investigations/`,
   changes in `docs/PROGRESS.md` (through a fragment in `docs/changes/`, workflow rule 5). Nothing decided only in chat.
6. **Steady, not frantic.** At most six builders run at once, and only on independent work (no shared files).
   Builders run lint, format, coverage and only their own browser tests locally; CI runs the full browser suite.
   `main` stays green: a red `main` is fixed before anything else merges. **Fast mode ended 2026-10-18 (owner):**
   every check is required again, branches must be up to date, and builders run their own gates in full. (Workflow
   rule 9, 2026-10-20, later lowered the limit to 5 builders on one machine. Running at most 5 meets both.)
7. **Launch is by word of mouth among friends**, when the owner decides. Sharing (the growth plan, `docs/GROWTH.md`,
   added by PR #60) and the owner's admin console are in scope.
8. **Reviews before every merge.** Every pull request is reviewed before merge by reviewer agents in parallel: a
   code reviewer (correctness, tests, the working agreement and comment style, regressions), a security reviewer
   (auth, sessions, sockets, input, data exposure, secrets) and, for any change players can see, a design reviewer
   (phone and desktop layouts, plain words, accessibility, the look and feel domain). Each finding is checked by a
   second agent that tries to refute it. Confirmed findings are fixed, or written down with a reason, before the
   merge.

## Ticket and ADR numbers

Moved here from CLAUDE.md in CC-302.

1. `CC-###` are **tickets** (units of work). Sequential, permanent, never reused. The next free ID is at the top of
   `BACKLOG.md`.
2. `FR-*` and `NFR-*` are requirements (PRD). `SEC-*`, `BUG-*` and `DEBT-*` are audit findings (KNOWN_ISSUES.md).
   `ADR-*` are decisions.
3. Tickets link to requirements, findings and ADRs. Every finding is linked from at least one ticket.
4. **Who assigns numbers (CC-299, ADR-068).** The coordinator assigns ticket and ADR numbers when it dispatches a
   builder, writes them in the builder's brief, and bumps the "next free" lines itself (top of `BACKLOG.md`, top of
   `DECISIONS.md`, the Process row of `PROGRESS.md`). **Builders never edit the next free lines.** A builder who needs
   a new ticket or ADR asks the coordinator for a number, so two builders never take the same one.
5. **Stages.** Don't start a stage until the previous stage's exit criteria in `BACKLOG.md` are met, unless the owner
   explicitly agreed (CLAUDE.md workflow rule 8).

## Which file to update, and when

Moved here from CLAUDE.md's "Where things are tracked" table in CC-302. CLAUDE.md keeps the map of what each file
holds. Builders change `BACKLOG.md` and `PROGRESS.md` only through a fragment ([changes/README.md](changes/README.md)).

| File                     | Update when                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `docs/BRD.md`            | Business direction changes                                   |
| `docs/PRD.md`            | The scope of a feature changes                               |
| `docs/PRODUCT_VISION.md` | Direction changes                                            |
| `docs/ARCHITECTURE.md`   | Structure changes                                            |
| `docs/BACKLOG.md`        | Tickets are added, started or completed (through a fragment) |
| `docs/tickets/CC-###.md` | A ticket is started or progresses                            |
| `docs/PROGRESS.md`       | Every working session (through a fragment)                   |
| `docs/changes/CC-###.md` | Every PR that changes a ticket                               |
| `docs/DECISIONS.md`      | A decision is made or reversed                               |
| `docs/PROCESS.md`        | The process changes                                          |
| `docs/DEPLOYMENT.md`     | The deploy setup changes                                     |
| `docs/ENGINEERING.md`    | Standards change                                             |
| `docs/KNOWN_ISSUES.md`   | An issue is found or fixed                                   |
