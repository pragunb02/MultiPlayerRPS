## Ticket

CC-### — <title> · `docs/tickets/CC-###.md`

## What & why

-

## Verification

- [ ] `npm run lint` · `npm run format:check` · `npm run test:coverage` · `npm audit --audit-level=high`
- [ ] Ran it for real (what was checked):

## Deployment impact (merging to `main` deploys to production — see docs/DEPLOYMENT.md)

- [ ] None — no change to start/build, dependencies, env vars, data or sessions
- [ ] Start/build or dependencies changed → verified `NODE_ENV=production npm ci && npm start` from a fresh clone
- [ ] Env vars added/renamed/removed → set in Render **before** merge:
- [ ] Data/schema change → migration/compatibility notes:
- [ ] Sessions/cookies change → users may be logged out
