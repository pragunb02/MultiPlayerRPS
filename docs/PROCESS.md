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

A ticket says which in its Template row. When in doubt, use the full one.

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
note in the ticket.

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
8. **Remove the flag** by its `removeBy` day, in its own small pull request: delete the old path, the
   `isOn` or `useFlag` call, the `flagPaths` wrapper and the registry entry, then clear the override in the console.
   A flag past its day fails CI, so this is never forgotten. Moving the day is a reviewed change with a reason.

## 8. After launch

About two weeks after full rollout, the coordinator writes the ticket's Post-launch review: the success metric
against its target, the guardrail, and the call (keep, iterate or remove). Then the Status becomes Reviewed.
