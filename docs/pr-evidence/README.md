# PR evidence

Every pull request shows its change working (CLAUDE.md, working agreement rule 4; the PR template's Evidence
section).

- **Screenshots** are pushed to the orphan branch `pr-evidence`, in a folder named after the PR number, and linked
  from the PR body as `https://raw.githubusercontent.com/pragunb02/MultiPlayerRPS/pr-evidence/<PR>/<name>.png`. They
  never go on `main`, so the code history stays small.
- Take them with Playwright from the local e2e server (`E2E_PORT=…`), at 1280×720 and 390×844 (360×800 for layout
  work), before and after. Name them `<screen>-<viewport>-<before|after>.png`.
- **API and socket evidence** goes in the PR body as text: the request, the status and the body, for success and for
  each refusal.
- **Privacy:** the repository is public. Use test accounts and seeded data only; never a real player's name, email,
  id, cookie or session in an image or a response. Crop or blur anything else personal.

How a builder pushes images without touching `main`:

```sh
git worktree add --detach /tmp/evidence origin/pr-evidence   # first time: git worktree add --orphan -b pr-evidence /tmp/evidence
mkdir -p /tmp/evidence/<PR> && cp shots/*.png /tmp/evidence/<PR>/
git -C /tmp/evidence add <PR> && git -C /tmp/evidence commit -m "Evidence for #<PR>" && git -C /tmp/evidence push origin HEAD:pr-evidence
```
