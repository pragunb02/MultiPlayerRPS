## Ticket

CC-### — <title> · `docs/tickets/CC-###.md`

## What & why

-

## Verification

- [ ] CI green (all required checks, branch up to date with `main`)
- [ ] Ran it for real (what was checked):

## Evidence (required: show it working, not just that tests pass)

<!-- Images live on the `pr-evidence` branch (docs/pr-evidence/README.md), never on main. No real player's name,
email, id or session in any image or response: use test accounts only. -->

- **UI change:** before and after screenshots, desktop 1280×720 and phone 390×844 (and 360×800 for layout work),
  light and dark when themes apply. Link: `https://raw.githubusercontent.com/pragunb02/MultiPlayerRPS/pr-evidence/<PR>/<name>.png`
- **API or socket change:** the request and the response (status, headers that matter, body), for the success case
  and each refusal (401/403/404/409/429…), from a local or test run.
- **Tests:** which tests were added and that each failed before the fix; the browser specs run and their results;
  coverage of the changed files.
- **Not testable here:** say what, why, and how it will be checked after deploy.

## Deployment impact (merging to `main` deploys to production — see docs/DEPLOYMENT.md)

- [ ] None — no change to start/build, dependencies, env vars, data or sessions
- [ ] Start/build or dependencies changed → verified `NODE_ENV=production npm ci && npm start` from a fresh clone
- [ ] Env vars added/renamed/removed → set in Render **before** merge:
- [ ] Data/schema change → migration/compatibility notes:
- [ ] Sessions/cookies change → users may be logged out
