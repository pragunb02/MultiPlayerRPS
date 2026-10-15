# ClassiCade

Real-time multiplayer classic games — Rock Paper Scissors, Tic-Tac-Toe and Chess — in the browser.

> The codebase is mid-restructure (Stage 0). See [docs/PROGRESS.md](docs/PROGRESS.md) for status and
> [docs/](docs/) for business/product requirements, architecture and the backlog.

## Requirements

- Node.js 22+ (`.nvmrc` pins 24)
- MongoDB (local, Docker, or Atlas — use a **non-production** database for development)

## Setup

```bash
nvm use
npm install
cp .env.example .env   # then fill in MONGO_URI and SESSION_SECRET
npm run dev            # http://localhost:8080
```

## Scripts

| Command                | What it does                        |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Legacy app with auto-reload (:8080) |
| `npm run dev:server`   | New server with auto-reload (:4000) |
| `npm start`            | Start (production)                  |
| `npm run lint`         | ESLint                              |
| `npm run format`       | Prettier (write)                    |
| `npm run format:check` | Prettier (check only)               |
| `npm test`             | Vitest                              |

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
