# Engineering Guidelines

How we structure, write and test code in ClassiCade. These rules apply to all new code (`apps/`, `packages/`).
The legacy app they replaced was deleted in CC-029. Where a rule can be checked by a tool, it is
(ESLint, Prettier, Vitest coverage). Rules are a starting point, not a substitute for thinking — if a rule
gets in the way of a clearly better design, write an ADR.

---

## 1. Server architecture: five layers

The server (`apps/server/src`) is split into layers by responsibility. Each layer has one job, talks only to
the layer directly below it, and never knows who is above it.

```
                 ┌──────────────────────────────────────────────┐
  clients ──────►│ 1. service/       Service layer              │  HTTP routes, socket handlers
                 ├──────────────────────────────────────────────┤
                 │ 2. domain/        Domain logic layer         │  business rules, orchestration
                 ├──────────────────────────────────────────────┤
                 │ 3. data/          Domain data layer          │  provides domain models
                 ├───────────────────────┬──────────────────────┤
                 │ 4a. persistence/      │ 4b. dependency/      │  our database │ other services
                 └───────────────────────┴──────────────────────┘
  shared by all:  models/ (immutable domain models)   utils/ (logger, errors, assertions)
  wiring:         server.js = composition root (the only file that knows every layer)
```

| Layer           | Folder         | Does                                                                                                                                                                                                              | Never                                                                                                          | Naming                                                        |
| --------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Service      | `service/`     | Exposes HTTP endpoints and socket events. Authenticates. Validates request shape (`*Validator`). Converts requests to domain models and results to responses (`*Transformer`). Translates errors to status codes. | Business decisions. Database or external calls. Passing request objects (`req`, socket payloads) downward.     | `*Controller`, `*SocketHandler`, `*Validator`, `*Transformer` |
| 2. Domain logic | `domain/`      | Business rules and orchestration: "can this player join?", "who won?", "how much XP?". Business validation. Uses pure game engines from `@classicade/games`.                                                      | Knowing about HTTP, sockets, Mongo or external APIs. Importing from `service/`, `persistence/`, `dependency/`. | `*Component`                                                  |
| 3. Domain data  | `data/`        | Gives the domain layer the domain models it asks for, regardless of where they come from. Aggregates sources, maps persistence/external objects ↔ domain models, caches.                                          | Business rules. Talking to the database driver directly.                                                       | `*Accessor` (or `*Reader` / `*Writer` when split)             |
| 4a. Persistence | `persistence/` | CRUD for data **we own** (MongoDB). Schemas, indexes, queries. Accepts and returns persistence objects only.                                                                                                      | Business rules. Returning Mongoose documents upward (return plain objects).                                    | `*Dao`                                                        |
| 4b. Dependency  | `dependency/`  | Calls **other** services (email, payments, chess engine). Builds their requests, unwraps their responses.                                                                                                         | Interpreting response values for business purposes.                                                            | `*Client`                                                     |
| Models          | `models/`      | Immutable domain models and value objects (`RoomCode`, `UserId`, `Match`). Validation of their own invariants only.                                                                                               | Behaviour beyond construction/validation. I/O.                                                                 | Noun, e.g. `roomCode.js`                                      |
| Utils           | `utils/`       | Layer-independent helpers: logger, typed errors, assertions, id generation.                                                                                                                                       | Importing anything outside `utils/`.                                                                           | `*` by purpose                                                |

### Interaction rules

1. **Adjacent layers only.** Service → Domain → Data → Persistence/Dependency. No skipping (a controller never calls a DAO).
2. **Top-down only.** A lower layer never imports an upper layer. Results flow back as return values (or events the upper layer subscribed to), never as calls upward.
3. **Request/response.** A layer asks the layer below for something and gets an answer (sync or async). Policy lives above, mechanism below.
4. Enforced by ESLint (`no-restricted-imports` per folder) — a violation fails `npm run lint`.

### Data crossing layers

| Kind               | Defined in     | Used in               | Example                                  |
| ------------------ | -------------- | --------------------- | ---------------------------------------- |
| Request / response | `service/`     | `service/` only       | `{ roomCode: "AB12CD" }` JSON payload    |
| Domain model       | `models/`      | service, domain, data | `Room`, `RoomCode`, `MatchResult`        |
| Persistence object | `persistence/` | persistence, data     | `{ _id, game, players: [...] }` document |
| External object    | `dependency/`  | dependency, data      | Payment provider's charge response       |

Data objects are **plain and frozen** — no methods that do work, so logic can't sneak into the wrong layer.

### Behaviour objects

- Built with **factory functions** that receive their dependencies: `createRoomComponent({ roomAccessor, clock, logger })`.
  They are **stateless** apart from those dependencies (state lives in the database or in explicit room state).
- The **composition root** (`server.js`) creates everything bottom-up and hands each layer its dependencies.
  Nothing else instantiates layer objects; nothing reaches for a global.
- Check required dependencies at construction (`assertDefined`) so a wiring mistake fails at boot, not at first request.

### Frontend (`apps/web`) and engines (`packages/games`)

- `packages/games`: **pure** functions — `(state, input) → newState`. No I/O, no timers, no `Math.random` (RNG is injected), no imports from apps. Enforced by lint.
- `apps/web` (ADR-009): pages → components → hooks → `lib/` (API + socket clients). Only `lib/` talks to the server; clients are injected via the services context; components never call `fetch` or import `socket.io-client` (lint-enforced). Styles are CSS Modules over design tokens (`styles/tokens.css`) — no raw colours/sizes in components, and **no inline `style=` or inline scripts** (the CSP forbids them, CC-030). The server is the source of truth for game state.
- Every press gets a visible answer within 100 ms (CC-164). Buttons are the app's `Button`: work that waits for the server goes through `useAction` (spinner after 400 ms and kept at least 300 ms, CC-239, failure under the button with Retry when it can help), and a button that cannot act gets a `reason` instead of `disabled`, so it stays focusable and says why. Every control has a stable `data-cc-control` name, and the press tests (`e2e/matchShellPresses.js`, one `match-shell-presses-<game>.spec.js` per game) press each one in every state of every game (CC-170).

---

## 2. Design principles and patterns

### Principles

| Principle                              | What it means here                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single responsibility**              | One module = one reason to change. A controller parses and responds; a component decides; an accessor fetches.                                                        |
| **Open/closed**                        | Add capability by adding code, not editing existing code. A new game is a new engine registered in one place — no `if (game === "chess")` anywhere else.              |
| **Liskov / contracts**                 | Anything implementing a contract (`GameEngine`, `Bot`, a DAO) is interchangeable. Contracts are written down as JSDoc typedefs and pinned by shared contract tests.   |
| **Interface segregation**              | Depend on the smallest thing you need: pass `{ findById }`, not the whole DAO; `Pick<Console, "log">`, not the logger factory.                                        |
| **Dependency inversion**               | High-level code receives its dependencies (factory parameters); it never imports concrete infrastructure. The composition root decides what is real and what is fake. |
| **Separation of concerns / layering**  | §1. Transport, business rules and storage evolve independently.                                                                                                       |
| **Pure core, imperative shell**        | Rules (game engines, XP maths, rating maths) are pure functions. Time, randomness, I/O and sockets live at the edges and are injected.                                |
| **Fail fast**                          | Invalid config stops boot; invalid input is rejected at the edge; broken invariants throw immediately.                                                                |
| **YAGNI / KISS**                       | Build the simplest thing that meets the current ticket and leaves the extension points open. No speculative abstractions (§3 rule 10).                                |
| **DRY — for knowledge, not for lines** | One source of truth for rules and constants. Two similar-looking lines that change for different reasons may stay separate.                                           |

### Patterns we use (and where)

| Pattern                                     | Where                                                                                                     | Why                                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Layered architecture**                    | Server (§1)                                                                                               | Independent evolution of API, rules and storage; enforced by lint.                                              |
| **Composition root + dependency injection** | `apps/server/src/server.js`                                                                               | One place wires real implementations; tests wire fakes. No globals or service locators.                         |
| **Factory functions**                       | Every behaviour object: `createRoomComponent(deps)`                                                       | Encapsulation via closures, explicit dependencies, no `this` pitfalls.                                          |
| **Strategy + Registry (plugin)**            | `GameEngine` per game in `packages/games`, looked up by game id (CC-014); `Bot` per difficulty (CC-038)   | Open/closed: adding a game or bot never touches room, match or socket code.                                     |
| **State machine**                           | Room lifecycle `waiting → playing → finished → closed` (CC-015); game phases                              | Illegal transitions become impossible, not just unlikely.                                                       |
| **Command**                                 | Player moves are data (`{ type, payload }`) applied by the engine                                         | Validation in one place; enables replays, undo-free audit logs, bots.                                           |
| **Reducer / immutable state**               | `applyMove(state, move) → newState`                                                                       | Deterministic, testable, safe to broadcast snapshots.                                                           |
| **Repository / DAO + Data Mapper**          | `persistence/*Dao` returns plain persistence objects; `data/*Accessor` maps to domain models              | Swap MongoDB (ADR-003) without touching domain logic.                                                           |
| **Adapter**                                 | `dependency/*Client` wraps each external API                                                              | Their models never leak into ours; easy to fake.                                                                |
| **Observer / domain events**                | Domain emits `MatchFinished`, `LevelUp`; service layer subscribes and pushes to sockets (CC-017)          | Domain stays transport-agnostic; new reactions (achievements, analytics) subscribe without editing the emitter. |
| **Value object**                            | `RoomCode`, `UserId`, `Username` in `models/`                                                             | Validation once, at creation; self-describing types.                                                            |
| **Result at boundaries, exceptions inside** | Engines' `validateMove` returns `{ ok, error }`; layers throw typed errors; service layer translates once | Expected rule violations aren't exceptional; unexpected failures still surface.                                 |

### Extension points (how the system grows)

| To add…                                       | You create                                                                                                                                                                                                                                                | You register it in                        | You do **not** touch                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| A new game                                    | `packages/games/src/<game>/` engine via `defineEngine()` + a test file calling `describeEngineContract()` with a scenario, and a web board component                                                                                                      | engine registry, `GAMES` catalog          | rooms, matches, sockets, progression                       |
| A new daily puzzle kind (ADR-061)             | a pure referee in `packages/games/src/puzzles/`, its curated set, a kind in `apps/server/src/domain/dailyPuzzles/`, a move parser in `dailyPuzzleRoutes.js`, a board and an entry in `apps/web/src/games/daily/dailyKinds.js`                             | `DAILY_PUZZLES` catalog, composition root | attempts, streaks, routes, sign-up moves, export, deletion |
| A new avatar (ADR-065)                        | an entry in `AVATARS` (`packages/shared/src/avatars.js`) with its unlock rule, a drawing in `apps/web/src/art/avatars/AvatarGlyphs.jsx`, a row in `docs/CREDITS.md`; a new unlock kind adds its check in `apps/server/src/domain/profiles/avatarRules.js` | `avatarArt.js`                            | rooms, boards, history, the picker, profile routes         |
| A new bot                                     | `apps/server/src/domain/bots/<name>.js` implementing `Bot`                                                                                                                                                                                                | bot registry                              | engines, rooms                                             |
| A new storage backend                         | new `*Dao` with the same contract                                                                                                                                                                                                                         | composition root                          | domain, service                                            |
| A new transport/API (e.g. REST v2, admin API) | new controllers in `service/`                                                                                                                                                                                                                             | router / composition root                 | domain and below                                           |
| A reaction to something that happened         | a domain-event subscriber                                                                                                                                                                                                                                 | composition root                          | the code that emits the event                              |

---

## 3. Coding standards

1. **Value objects, not raw strings.** Identifiers and constrained values (`RoomCode`, `UserId`, `GameId`, `Username`) get a small model that validates on creation. After that the type is trusted; nothing re-checks it.
2. **No `null` as a result.** `get*()` either returns the thing or throws a typed error (`NotFoundError`). Collections are empty arrays, never `null`. Don't initialise variables to `null` to fill later — compute the value directly.
3. **Don't pass `null`/`undefined` to mean "not provided".** Use a separate function or an explicit option. Public functions check their contract (`assertDefined`, model constructors) and fail immediately.
4. **Named parameters.** More than two parameters, or two of the same type → one object parameter: `createRoom({ hostId, gameId, options })`, not `createRoom(hostId, gameId, options)`.
5. **No silent fallbacks.** Missing or invalid required input fails loudly (4xx for clients, boot failure for config). A default is fine only when it is part of the documented contract. Temporary compatibility fallbacks must log a warning and have a removal ticket.
6. **Immutability.** `const` by default; `Object.freeze` data objects and returned collections; never mutate arguments; produce new state instead (engines, reducers).
7. **Errors.**
   - Throw typed errors from `utils/errors.js` (`ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`, …), each with a stable `code`.
   - When re-throwing, wrap with `cause`: `throw new ConflictError("Room is full", { cause: err })`.
   - No broad `try/catch` in business code. Catch only what you can handle. Translation to HTTP status / socket error happens **once**, in the service layer.
   - Never send stack traces or internal messages to clients. Every error response has the shape
     `{ error: { code, message, requestId, details? } }`; clients switch on `code` (`ERROR_CODES` in `@classicade/shared`).
8. **Secrets.** Passwords are hashed only with `utils/passwordHasher` (scrypt) and checked only with its constant-time `verify`; never logged,
   never returned. Authentication failures use one generic message and equal work, so they reveal nothing.
9. **Logging.** Use the injected structured logger (`utils/logger.js`; `req.log` inside HTTP handlers, already bound to the request id), never `console` — enforced by lint. Log the error object, not `err.message`. Log at layer boundaries and on state changes that matter. **Never log secrets or personal data** — passwords, tokens, session ids, emails.
10. **Validate input at the edge, strictly.** Types, lengths, patterns, list sizes; reject unknown fields. Once inside the domain, data is trusted.
11. **No abstraction without a second use.** No base classes or "interfaces" with one implementation. Dependency injection already gives us testability. (Contracts like `GameEngine` are fine — they have several implementations by design.)
12. **Constants over string literals** for event names, game ids, error codes — defined once (usually `@classicade/shared`).
13. **Small and obvious.** One responsibility per function/module. Names say what, comments say why. No dead code, no commented-out code, no `var`, `===` only.

---

### Comment style (owner's rule, enforced by lint since CC-125)

**14. Comments are for people.** Write a comment where the code cannot speak for itself: a business rule, a decision that is not obvious, or an order that matters. Say why, not what. Write in plain words for a new teammate who knows JavaScript but not this codebase. Avoid jargon and shorthand such as idempotent, upsert, observer pattern, e.g., i.e., and arrows in prose. Say what happens instead, for example "running it twice changes nothing". Use short sentences that end with a full stop. Do not use semicolons. Do not use dashes as punctuation (a spaced hyphen, a double hyphen, an en dash or an em dash). Use a full stop, comma, colon or brackets instead. Hyphens inside a word are fine (best-of-3, read-only, CC-089). Write lists as numbered items or as separate sentences, not as hyphen bullets. Anything inside backticks is code and is exempt. Put a ticket or ADR ID at the end in brackets only when the reader needs the background, and never as the only explanation, for example "(see ADR-014)". Every exported function, hook and component has a JSDoc block. Parameter descriptions go after the type, never inside the braces. Checked by `npm run lint` (rule `classicade/comment-style`).

`npm run lint` enforces this rule (CC-125, merged). The local ESLint rule `classicade/comment-style` checks
JavaScript comments, and `scripts/check-comments.mjs` checks CSS comments. The rule is an error in every folder listed
in `COMMENT_STYLE_ON` (`eslint-rules/commentStyleScope.mjs`): today `packages/games`, `packages/shared`,
`eslint-rules` and `scripts`. The other folders are reworded one pull request at a time in CC-126 (ROADMAP.md §7),
and each moves into `COMMENT_STYLE_ON` when its pull request lands. Until then, new and changed comments in those
folders must still follow the rule, and reviewers check them by hand.

---

## 4. Testing standards

**Pyramid:** many unit tests → some integration tests → few end-to-end tests.

| Level       | What                                                                                                                                           | Tools                                                      | Where                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------- |
| Unit        | One module, its collaborators faked. Engines, components, models, utils.                                                                       | Vitest                                                     | `*.test.js` beside code |
| Integration | Real HTTP/socket stack + in-memory MongoDB, one flow end to end.                                                                               | Vitest, supertest, socket.io-client, mongodb-memory-server | `*.integration.test.js` |
| End to end  | Whole journeys in real browsers (desktop + mobile) against the real server, production config, in-memory MongoDB — one file per kind of person | Playwright                                                 | `e2e/*.spec.js`         |

Rules:

1. **Test behaviour through the public API**, not private helpers or internal state.
2. **One behaviour per test**, named as a sentence: `it("rejects a move when it is not the player's turn")`.
3. **Arrange – Act – Assert**, visibly separated. Build inputs with small factory helpers, not copy-pasted literals.
4. **Deterministic.** Inject clock, RNG and id generators; use fake timers. No real network or sleeps in unit tests; in integration tests, poll for a condition instead of sleeping a fixed time.
5. **Test doubles of our own storage honour the real contract.** An in-memory DAO used in tests must pass the same
   contract suite as the real DAO (e.g. `testing/matchDaoContract.js` runs against MongoDB and the double), so the double can never drift.
6. **Fakes over mocks.** For our own layers use simple in-memory fakes (e.g. a fake accessor). Use spies/mocks only to assert an interaction that _is_ the behaviour (e.g. "emits `levelUp`").
7. **Assert errors by type**: `expect(() => fn()).toThrow(NotFoundError)` / `await expect(p).rejects.toThrow(...)`.
8. **Every bug fix starts with a failing test** that reproduces it.
9. **Cover edges**: empty, boundary, invalid, duplicate, concurrent/out-of-order where relevant.
10. **Browser tests are persona journeys** (`e2e/`, CC-081): visitor, guest, account holder, legacy player, attacker.
    The `players` fixture fails a test on any console error or warning, page error, CSP violation or unexpected failed
    request, on a secret (password, email, session id) in any URL, on a readable or non-`Secure`/`HttpOnly` session
    cookie, and on anything in web storage. Assert URLs and titles at every step, and what each player must _not_ see
    (hidden game state in the DOM and in WebSocket frames). A test that provokes a failure declares it
    (`player.expect(401, "/api/auth/login")`).
11. **Coverage gates** (enforced by `npm run test:coverage`, run in CI from CC-027): **100 % of lines and functions,
    99 % of branches**. Every branch is tested; the only exceptions are listed with a reason in `docs/tickets/CC-084.md`.
    A new untested branch is either tested, removed as dead code, or added to that list with its reason.
12. **History is behaviour.** Every screen's browser tests cover arriving by link, Back, Forward, Back/Forward chains,
    reload, and Back after redirects and after actions that change who you are or where you sit (`e2e/navigation.spec.js`).
    Actions that end a place — leaving a room, signing in — replace the history entry, so Back never re-enters it.
13. **Slow tests are tagged, never dropped** (CC-203). A test that plays many whole games (bot strength, long random
    walks) gets `{ tags: ["slow"] }`. Pull requests leave those out (`npm test`, `npm run test:coverage`), and
    `.github/workflows/nightly.yml` runs everything with coverage every night and on demand (`npm run test:all`).
    Keep a fast check of the same behaviour untagged beside it (fewer games, a shorter walk), so the PR gates still
    reach every line without the slow ones.
14. **Every browser engine** (CC-184). The suite runs on Chromium (laptop and phone) and on Firefox (laptop) on every pull
    request, and both merged jobs are required checks (ADR-039). WebKit (laptop, on macOS) is much slower on GitHub's runners,
    so `.github/workflows/webkit.yml` runs it nightly, on demand and on pull requests that change `apps/web`,
    `packages/shared` or `e2e`. `E2E_BROWSER=firefox|webkit npm run test:e2e` runs one engine locally. The e2e server serves HTTPS with a certificate made for each run (`e2e/tlsFront.js`), so every engine
    sees the production headers and the `Secure` cookie unchanged. Branch on `formFactor(testInfo)`, never on the
    project name. Engine wording the `players` fixture lets pass lives in `e2e/browserNoise.js`, each rule as
    narrow as the words allow and unit tested.
15. **Screenshot baselines** (CC-155, ADR-056). `e2e/baselines.visual.js` compares the main screens at 1280×720 and
    390×844, light and dark, with the PNGs in `e2e/visual-baselines/`. They are made and compared only in the pinned
    Playwright image, never on a laptop's own browser: `npm run test:visual` (Docker) compares, and after a change to
    the look made on purpose `npm run test:visual:update` or the `Visual baselines (update)` workflow (Actions tab,
    "Use workflow from" the ticket branch, and the ticket ID) writes the changed images. Review every changed image in the pull request before
    approving it. New screens get a baseline there. Anything that changes between runs is given a stand-in or painted
    from script in that spec (Playwright's own `mask` is blocked by the CSP), never accepted by a looser threshold.
    On failure the CI job keeps the expected, actual and diff images, a video and a trace for 14 days.

---

## 5. Dependency policy

1. **Latest stable only.** New dependencies use the latest stable release — never alpha, beta, RC, canary or nightly builds.
   Node.js: the current **Active LTS** line (`.nvmrc`).
2. **Fewer is better.** Before adding a package, check whether Node or an existing dependency already does it
   (e.g. `node --watch` instead of nodemon, `process.loadEnvFile` instead of dotenv in new code). Prefer well-maintained,
   widely-used packages with no native build step.
3. **Ranges and lockfile.** Caret ranges (`^x.y.z`) in `package.json`; `package-lock.json` is committed and is what CI installs (`npm ci`).
4. **Zero known vulnerabilities.** `npm audit` must report 0 high/critical before merge; anything lower gets a ticket.
5. **Stay current.** Dependabot (`.github/dependabot.yml`, CC-031) opens update PRs every Monday: patch + minor releases
   grouped (dev tools in one PR, runtime libraries in another), each major release in its own PR, GitHub Actions
   grouped. Every update PR must pass CI; merging deploys, so read its release notes and deployment impact first. A
   major upgrade that needs code changes gets its own ticket. `npm audit` runs in CI on every PR (CC-027).
6. **Shared versions.** One version of a library across workspaces unless a migration is in progress (e.g. one workspace moving to a new major ahead of the others).

---

## 6. Definition of done (per ticket)

- [ ] Code follows the layer rules; `npm run lint` has 0 errors.
- [ ] Unit tests for new behaviour; integration test if a flow changed; `npm test` and `npm run test:coverage` pass.
- [ ] `npm run format:check` passes; `npm audit` reports 0 high/critical.
- [ ] New dependencies follow §5.
- [ ] Docs updated: ticket file, board, KNOWN_ISSUES, PROGRESS (and ADR if a decision was made).
- [ ] Ran it for real when the change is user-visible or touches startup/wiring.
