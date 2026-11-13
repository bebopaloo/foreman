# foreman

A local, read-only admin UI for the bebopaloo software factory. It will show Claude usage and limit use, an engagement ledger per client repo, and factory health.

Status: the repo is set up with the factory's `stack-ts` pack. Foreman is the factory's pilot project: it is specified and built with the factory itself. The Spec comes next, in `_context/features/`.

## Stack

TypeScript end to end: a React web app, a Fastify API and a Postgres database with Drizzle, in a pnpm workspace. The Spec decides which parts Foreman keeps.

| Folder            | Holds                                                      |
| ----------------- | ---------------------------------------------------------- |
| `apps/web`        | React with Vite and TanStack Query                         |
| `apps/api`        | Fastify API, run by Node with type stripping               |
| `packages/db`     | Drizzle schema, migrations and the database client         |
| `packages/shared` | Zod schemas that the web app and the API share             |
| `e2e`             | Playwright end-to-end tests with an axe accessibility scan |

## Start

You need Node 26, pnpm 12 (`npm install --global pnpm@12.18.0`) and Docker.

```bash
pnpm install
docker compose up -d --wait db
pnpm db:migrate
pnpm dev
```

The web app runs at http://127.0.0.1:5173 and calls the API at http://127.0.0.1:3000 through the Vite proxy.

The local database listens on `127.0.0.1:55432`. Set `DB_PORT` before `docker compose up` to use another port, and change `DATABASE_URL` and `TEST_DATABASE_URL` to match. It accepts local connections without a password; never use these settings for a shared database.

## Check

| Command             | Does                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`    | Type check every package                                                                                                 |
| `pnpm lint`         | ESLint with the type-checked rules                                                                                       |
| `pnpm format:check` | Prettier                                                                                                                 |
| `pnpm test`         | Unit, component and API integration tests. The API tests need the database.                                              |
| `pnpm test:e2e`     | Playwright. Starts the dev servers unless `E2E_BASE_URL` is set. Run `pnpm exec playwright install chromium` once first. |

CI runs all of these, a secret scan and a dependency audit on every pull request.

## Preview

`compose.preview.yaml` runs a production-like build of the current checkout on this machine: the API image, the built web app behind Caddy on one origin, and its own database. Only the web port is published, on `127.0.0.1`.

```bash
PREVIEW_PORT=8100 docker compose -f compose.preview.yaml -p foreman-preview up -d --build --wait
E2E_BASE_URL=http://127.0.0.1:8100 pnpm test:e2e
docker compose -f compose.preview.yaml -p foreman-preview down --volumes
```

The stack-ts `preview` skill does the same with one project and a stable port per branch.

## Database changes

Change `packages/db/src/schema.ts`, run `pnpm db:generate`, read the generated SQL in `packages/db/migrations/`, and commit both.

## Configuration

The API reads these variables at start-up and stops if one is invalid.

| Variable       | Default                                               |
| -------------- | ----------------------------------------------------- |
| `DATABASE_URL` | none; `pnpm dev` uses the local database              |
| `HOST`         | `127.0.0.1`                                           |
| `PORT`         | `3000`                                                |
| `CORS_ORIGINS` | `http://127.0.0.1:5173`; a comma-separated allow-list |
| `LOG_LEVEL`    | `info`                                                |
