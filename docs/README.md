# Reading guide

Every document in `docs/`, in the order to read them. One line each says what it is for. The working agreement and
the commands are in [CLAUDE.md](../CLAUDE.md) at the root of the repository.

## 1. Start here

1. [PROGRESS.md](PROGRESS.md) — where we are today: current phase, work in flight, stage counters and the dated
   changelog.
2. [BACKLOG.md](BACKLOG.md) — the ticket board. Every unit of work is a `CC-###` with type, priority, phase and status.
3. [PRODUCT_VISION.md](PRODUCT_VISION.md) — the accepted vision: personas, loops, phases and the order of work,
   metrics.
4. [DECISIONS.md](DECISIONS.md) — every decision (ADR) with its reasons, newest first, open decisions at the top.

## 2. Why and what

5. [BRD.md](BRD.md) — business requirements: vision, users, business model, KPIs.
6. [PRD.md](PRD.md) — product requirements per stage, with requirement IDs (`FR-*`, `NFR-*`).
7. [ROADMAP.md](ROADMAP.md) — the 2026-10-16 audit and the feature catalogue (bots, matchmaking, social, coins, AI).
   The vision sets the order now.
8. [GROWTH.md](GROWTH.md) — the growth plan: being found, sharing, day 2, notification caps, launch sequence.
9. [IDEAS.md](IDEAS.md) — the parking lot for new ideas during the feature freeze. Not tickets, not started.
10. [domains/SOCIAL_AND_SHARING.md](domains/SOCIAL_AND_SHARING.md) — the Social and sharing domain (proposed,
    ADR-051): scope, boundaries, principles, research, its tickets in build order and the owner's decisions.

## 3. How it is built

11. [ARCHITECTURE.md](ARCHITECTURE.md) — the structure of the code: layers, bots, sessions, limits, console, data
    model.
12. [ENGINEERING.md](ENGINEERING.md) — how to write code here: layers, principles, patterns, coding and testing
    standards, dependency policy. Binding for `apps/` and `packages/`.
13. [DATA.md](DATA.md) — every place data lives, who can read it, how long it is kept and how it goes.
14. [games/BOTS.md](games/BOTS.md) — the computer players Rocky, Pip and Queen Vee in plain words: levels, how they
    choose, fair-play limits, the sealed throw, what is planned.
15. [ux/MATCH_EXPERIENCE.md](ux/MATCH_EXPERIENCE.md) — the match experience audit, the game shell, journeys, the
    button feedback standard and UX telemetry.
16. [story/STORY_MODE.md](story/STORY_MODE.md) — the story mode design "ClassiCade Quest": world, cast, levels,
    dialogue, systems and build plan.
17. [analytics/EVENTS.md](analytics/EVENTS.md) — the analytics event catalogue (proposed; owner answers in ADR-034).
18. [CREDITS.md](CREDITS.md) — every asset and art component with its author and licence; a test fails when an
    asset has no row (CC-230).
19. [art/README.md](art/README.md) — the art pipeline: adding an asset, licence rules, size limits, naming, and how
    the artist's Bit is swapped in.

## 4. Running production

20. [DEPLOYMENT.md](DEPLOYMENT.md) — production on Render: settings, environment variables, checks before and after a
    merge, rollback, incidents, the owner console.
21. [runbooks/backup-restore.md](runbooks/backup-restore.md) — nightly encrypted backups and how to restore them.
22. [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — every finding (`SEC-*`, `BUG-*`, `DEBT-*`) with its status and ticket.

## 5. Research and tickets

23. [investigations/2026-10-17-cross-browser-a11y-load.md](investigations/2026-10-17-cross-browser-a11y-load.md) —
    cross-browser, accessibility, load and bundle investigation of 2026-10-17.
24. [tickets/TEMPLATE.md](tickets/TEMPLATE.md) — the template for a ticket file. Every ticket has a file with its
    research, scope, plan and verification (a small one: root cause and a short research note):

[CC-011](tickets/CC-011.md) · [CC-012](tickets/CC-012.md) · [CC-013](tickets/CC-013.md) · [CC-014](tickets/CC-014.md) · [CC-015](tickets/CC-015.md) · [CC-016](tickets/CC-016.md) · [CC-017](tickets/CC-017.md) · [CC-018](tickets/CC-018.md) · [CC-019](tickets/CC-019.md) · [CC-020](tickets/CC-020.md) · [CC-022](tickets/CC-022.md) · [CC-023](tickets/CC-023.md) · [CC-024](tickets/CC-024.md) · [CC-025](tickets/CC-025.md) · [CC-026](tickets/CC-026.md) · [CC-027](tickets/CC-027.md) · [CC-029](tickets/CC-029.md) · [CC-030](tickets/CC-030.md) · [CC-031](tickets/CC-031.md) · [CC-032](tickets/CC-032.md) · [CC-033](tickets/CC-033.md) · [CC-036](tickets/CC-036.md) · [CC-037](tickets/CC-037.md) · [CC-038](tickets/CC-038.md) · [CC-039](tickets/CC-039.md) · [CC-040](tickets/CC-040.md) · [CC-044](tickets/CC-044.md) · [CC-046](tickets/CC-046.md) · [CC-047](tickets/CC-047.md) · [CC-049](tickets/CC-049.md) · [CC-051](tickets/CC-051.md) · [CC-053](tickets/CC-053.md) · [CC-054](tickets/CC-054.md) · [CC-073](tickets/CC-073.md) · [CC-076](tickets/CC-076.md) · [CC-078](tickets/CC-078.md) · [CC-080](tickets/CC-080.md) · [CC-081](tickets/CC-081.md) · [CC-084](tickets/CC-084.md) · [CC-086](tickets/CC-086.md) · [CC-087](tickets/CC-087.md) · [CC-089](tickets/CC-089.md) · [CC-095](tickets/CC-095.md) · [CC-096](tickets/CC-096.md) · [CC-097](tickets/CC-097.md) · [CC-099](tickets/CC-099.md) · [CC-101](tickets/CC-101.md) · [CC-102](tickets/CC-102.md) · [CC-103](tickets/CC-103.md) · [CC-104](tickets/CC-104.md) · [CC-106](tickets/CC-106.md) · [CC-107](tickets/CC-107.md) · [CC-108](tickets/CC-108.md) · [CC-110](tickets/CC-110.md) · [CC-111](tickets/CC-111.md) · [CC-112](tickets/CC-112.md) · [CC-115](tickets/CC-115.md) · [CC-116](tickets/CC-116.md) · [CC-117](tickets/CC-117.md) · [CC-118](tickets/CC-118.md) · [CC-119](tickets/CC-119.md) · [CC-125](tickets/CC-125.md) · [CC-138](tickets/CC-138.md) · [CC-153](tickets/CC-153.md) · [CC-157](tickets/CC-157.md) · [CC-158](tickets/CC-158.md) · [CC-159](tickets/CC-159.md) · [CC-160](tickets/CC-160.md) · [CC-161](tickets/CC-161.md) · [CC-162](tickets/CC-162.md) · [CC-163](tickets/CC-163.md) · [CC-164](tickets/CC-164.md) · [CC-170](tickets/CC-170.md) · [CC-172](tickets/CC-172.md) · [CC-180](tickets/CC-180.md) · [CC-181](tickets/CC-181.md) · [CC-182](tickets/CC-182.md) · [CC-183](tickets/CC-183.md) · [CC-184](tickets/CC-184.md) · [CC-203](tickets/CC-203.md) · [CC-207](tickets/CC-207.md) · [CC-208](tickets/CC-208.md) · [CC-217](tickets/CC-217.md) · [CC-221](tickets/CC-221.md) · [CC-225](tickets/CC-225.md) · [CC-230](tickets/CC-230.md) · [CC-231](tickets/CC-231.md) · [CC-232](tickets/CC-232.md) · [CC-233](tickets/CC-233.md) · [CC-234](tickets/CC-234.md) · [CC-235](tickets/CC-235.md) · [CC-236](tickets/CC-236.md) · [CC-237](tickets/CC-237.md) · [CC-239](tickets/CC-239.md) · [CC-240](tickets/CC-240.md) · [CC-241](tickets/CC-241.md) · [CC-242](tickets/CC-242.md) · [CC-244](tickets/CC-244.md) · [CC-245](tickets/CC-245.md) · [CC-246](tickets/CC-246.md) · [CC-247](tickets/CC-247.md) · [CC-248](tickets/CC-248.md) · [CC-249](tickets/CC-249.md) · [CC-250](tickets/CC-250.md) · [CC-254](tickets/CC-254.md) · [CC-255](tickets/CC-255.md) · [CC-257](tickets/CC-257.md) · [CC-259](tickets/CC-259.md) · [CC-277](tickets/CC-277.md) · [CC-278](tickets/CC-278.md) · [CC-279](tickets/CC-279.md)
