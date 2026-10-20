# CC-### — <title>

<!-- The full template (CC-311, ADR-072). Work you can describe in one sentence uses TEMPLATE-lite.md instead.
The process around it is in docs/PROCESS.md. CI's decision gate checks every ticket from Ready on: each Open
decisions row answered by the owner or past its default day, and at least one acceptance criterion with an id. -->

|          |                                                                          |
| -------- | ------------------------------------------------------------------------ |
| Template | full                                                                     |
| Status   | Shaping · Spec review · Ready · Building · Rolling out · Done · Reviewed |
| Type     | feature · bug · security · debt · infra · test · docs · chore            |
| Priority | P0 · P1 · P2 · P3                                                        |
| Stage    | S0 · S1 · S2 · S3 · S4                                                   |
| Links    | FR-… · SEC-/BUG-/DEBT-… · ADR-…                                          |
| Branch   | `cc-###-short-name`                                                      |
| Started  | YYYY-MM-DD                                                               |
| Done     | —                                                                        |

Status, one word from the list: **Shaping** (the coordinator is asking the owner), **Spec review** (the lenses read
this file), **Ready** (every decision answered or defaulted, a builder may start), **Building**, **Rolling out**
(merged, behind its flag, ramping), **Done** (fully rolled out), **Reviewed** (the post-launch review is written).

## Problem

One concrete story: who, where, what went wrong or is missing. One paragraph.

## Job to be done

When \_\_\_, players want to \_\_\_, so they can \_\_\_.

## Appetite

S (up to 2 agent-hours) · M (up to 6) · L (up to 2 days of agent time). **Cut line:** what is dropped first if the
build runs over. Going over the appetite means cutting scope, not extending the build.

## Proposed solution

A sketch: the flow, the screens or the API, the parts it changes. Enough for a builder to start, not every detail.

## Non-goals

- What this ticket will not do, even though someone might expect it.

## Rabbit holes

- Parts that could swallow the appetite, and how we avoid them.

## Open decisions

The coordinator batches these into [DECISIONS-PENDING.md](../DECISIONS-PENDING.md). No builder starts until every
row has an owner answer or its default day has passed. With no decisions, write None.

| Question | Options | Recommended default | Owner answer | Default applies on |
| -------- | ------- | ------------------- | ------------ | ------------------ |
| …        | …       | …                   |              | YYYY-MM-DD         |

## Acceptance criteria

Each criterion has an id and names the test that proves it.

- **AC-1** Given …, when …, then …. Test: `file.test.js` › "the test's name"
- **AC-2** Given …, when …, then …. Test: …

## Definition of done

- [ ] Every acceptance criterion passes its named test, and the PR shows the evidence for each
- [ ] `npm run lint`, `npm run format:check` and the tests of the changed files pass (CI runs the rest)
- [ ] Changelog fragment `docs/changes/CC-###.md` added. PROGRESS.md, the board rows and the next free lines are
      not edited (CLAUDE.md workflow rule 5)
- [ ] Docs updated: KNOWN_ISSUES, ADRs with the numbers the coordinator assigned
- [ ] The flag and its removal date are written in Rollout (player-facing features)

## Success metric

| Kind               | Metric | Target | Window |
| ------------------ | ------ | ------ | ------ |
| Primary            | …      | …      | …      |
| Guardrail          | …      | …      | …      |
| Friction guardrail | …      | …      | …      |

A `feature` ticket names at least one **Friction guardrail** row (CC-313 section 6, checked from Ready by the decision
gate for tickets started on or after 2026-10-21). Pick one: optional interruptions per visit, its own surface's
dismissed share, time to first move p75, the drop-off at its own step, rage and dead clicks on its route, or the text
budget of the screen it changes, with a threshold and its CC-312 flag compared on against off. A feature that adds a
toast, banner, dialog, card, request or step registers it in `packages/shared/src/telemetry/surfaces.js` or
`funnels.js` in the same pull request.

## Instrumentation

The events this adds or reads, as anonymous counts only (ADR-034): no ids, no free text, no URLs. Name each event
and its fields, or write None.

## Threat model

About five lines, the four questions: what are we building, what can go wrong, what are we doing about it, did we
do a good enough job.

## Privacy checklist

- **Data:** what is collected or shown, and about whom.
- **Retention:** how long it is kept, and how it is deleted.
- **Who sees it:** the player, other players, the owner's console, logs.
- **Minors (ADR-028):** what changes for a player under 18.
- **Defaults:** the safe default, and who can change it.

## Alternatives considered

- The other ways, and why not.

## Interfaces and contracts touched

| Interface (route, socket event, engine contract, DAO) | Change | Contract test |
| ----------------------------------------------------- | ------ | ------------- |
| …                                                     | …      | …             |

## Files and areas touched

The folders and files this ticket changes, so the coordinator never runs two builders on overlapping areas.

## Test plan

Unit, integration and browser tests, which acceptance criterion each covers, and what is checked by hand.

## Rollout

- **Flag:** `name` (CC-312), off by default.
- **Ramp:** who gets it first, then everyone.
- **Rollback trigger:** what number or report turns it off.
- **Rollback steps:** turn the flag off, then …
- **Flag removal date:** YYYY-MM-DD.

## Pre-mortem

It is a month from now and this failed. Why?

| Risk | Mitigation |
| ---- | ---------- |
| …    | …          |
| …    | …          |
| …    | …          |

## Research (written before any code)

1. How our code does it today (files, behaviour, gaps).
2. How other products do it, with sources and dates.
3. What is best for ClassiCade, and why (our players, our rules, our constraints).

## Tasks

- [ ] …

## Post-launch review

About two weeks after full rollout (date: YYYY-MM-DD). The result against the success metric, what we learned, and
the call: **keep**, **iterate** (a new ticket) or **remove**. Then set Status to Reviewed.
