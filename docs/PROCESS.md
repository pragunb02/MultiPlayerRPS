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

New player-facing features ship behind a flag (CC-312, coming), off by default, with a ramp, a rollback trigger
and a removal date in the ticket's Rollout section. The flag is removed by its removal date, as its own small
ticket if needed.

## 8. After launch

About two weeks after full rollout, the coordinator writes the ticket's Post-launch review: the success metric
against its target, the guardrail, and the call (keep, iterate or remove). Then the Status becomes Reviewed.
