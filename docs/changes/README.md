# Changelog fragments

Every pull request that finishes or moves a ticket adds one file here, named after its ticket, instead of editing
the changelog in [PROGRESS.md](../PROGRESS.md) or its row on the [board](../BACKLOG.md) (CC-299, ADR-068). Two pull
requests never add the same file, so they never conflict here.

## The format

`docs/changes/CC-310.md`:

```markdown
---
ticket: CC-310
date: 2026-10-21
type: bug
status: done
adrs: [ADR-055 (amended)]
---

The changelog text, in plain words: what changed and why it matters. One paragraph.
```

| Key      | Value                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| `ticket` | The ticket ID, the same as the file name. One fragment per ticket. A pull request with two tickets adds two. |
| `date`   | The day of the change, `YYYY-MM-DD`.                                                                         |
| `type`   | The board's type: `feature`, `bug`, `security`, `debt`, `infra`, `test`, `docs` or `chore`.                  |
| `status` | The ticket's board status once this pull request merges: `todo`, `in-progress`, `blocked` or `done`.         |
| `adrs`   | The decisions made or amended, `[]` for none. Each `ADR-###`, optionally followed by ` (amended)`.           |
| `pr`     | Optional. The pull request number. Leave it out: the collector reads it from the merge commit.               |

The text below the front matter becomes the line `- 2026-10-21 — CC-310, ADR-055 (amended) — (#140) The changelog
text…`, in the format PROGRESS.md has always used. Line breaks inside the paragraph are joined.

**A board row, optionally.** For a ticket that is not on the board yet, or whose title changed, add its whole row
below the text, with the same columns as the table it belongs in:

```markdown
| CC-310 | The title | bug | P1 | S1 | 1 | ⬜ Todo | CC-289 |
```

A known ticket's row is replaced by it. A new one is added to the end of the last table on the board. The Status
cell always comes from `status`.

## What the collector does

The coordinator runs it on a fresh `main` and opens the result as a docs pull request:

```bash
node scripts/bin/collect-changes.mjs           # fold, format, delete the fragments
node scripts/bin/collect-changes.mjs --check   # check the fragments, write nothing
```

1. Each fragment's line goes at the top of the changelog, newest first (by date, then pull request, then ticket).
2. Each ticket's row gets its status, its ADRs and, when done, `done in #PR` in Links, and its ID links to
   `tickets/CC-###.md` when that file exists.
3. Both files are formatted with Prettier and the folded fragments are deleted.
4. Running it again changes nothing. A line already in the changelog is not added twice.

## What CI checks

The `Changelog fragments` job runs `--check --base HEAD^1` on every pull request. It fails on a malformed fragment,
on a ticket that is not on the board and has no row, and on a pull request that adds, changes or removes a
changelog entry by hand. The collector's own pull request passes because every line it adds is made from a fragment
that the same pull request deletes, and it changes nothing else in the changelog.
