# ClassiCade

Real-time multiplayer classic games — Rock Paper Scissors, Tic-Tac-Toe and Chess — in the browser.

Live at https://nocapgaming.onrender.com. Status: [docs/PROGRESS.md](docs/PROGRESS.md); business/product requirements,
architecture and the backlog are in [docs/](docs/).

## Requirements

- Node.js 22+ (`.nvmrc` pins 24)
- MongoDB (local, Docker, or Atlas — use a **non-production** database for development)

## Setup

```bash
nvm use
npm install
cp apps/server/.env.example apps/server/.env   # then fill in MONGO_URI and SESSION_SECRET
npm run dev:server     # API + realtime on http://localhost:4000
npm run dev:web        # web app on http://localhost:5173 (proxies to the server)
```

### With Docker (no local Node or MongoDB needed)

```bash
docker compose up --build   # the whole app on http://localhost:4000, with its own MongoDB
docker compose up mongo     # only MongoDB on localhost:27017, for npm run dev:server / dev:web
docker compose down         # stop (add -v to delete the local database)
```

## Scripts

| Command                 | What it does                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev:server`    | New server with auto-reload (:4000); JSON logs — pipe to `npx pino-pretty` for readable output |
| `npm run dev:web`       | Web app on :5173 (run the server too)                                                          |
| `npm run build:web`     | Production build of the web app → `apps/web/dist`                                              |
| `npm start`             | Start (production): the server, serving the built web app (`WEB_DIST_DIR`)                     |
| `npm run lint`          | ESLint                                                                                         |
| `npm run format`        | Prettier (write)                                                                               |
| `npm run format:check`  | Prettier (check only)                                                                          |
| `npm test`              | Vitest                                                                                         |
| `npm run test:e2e`      | Browser persona tests (Playwright; first time: `npx playwright install chromium`)              |
| `npm run test:coverage` | Vitest with coverage gates                                                                     |

## Project docs

| Doc                                  | Contents                              |
| ------------------------------------ | ------------------------------------- |
| [BRD](docs/BRD.md)                   | Vision, users, business model, KPIs   |
| [PRD](docs/PRD.md)                   | Product requirements by stage         |
| [Architecture](docs/ARCHITECTURE.md) | Current and target architecture       |
| [Backlog](docs/BACKLOG.md)           | Stage-by-stage tasks                  |
| [Progress](docs/PROGRESS.md)         | Current status and changelog          |
| [Engineering](docs/ENGINEERING.md)   | Architecture rules and code standards |
| [Decisions](docs/DECISIONS.md)       | Architecture decision records         |
| [Known issues](docs/KNOWN_ISSUES.md) | Audit findings and their status       |
