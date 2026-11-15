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

The web app runs at http://127.0.0.1:47173 and calls the API at http://127.0.0.1:47130 through the Vite proxy.

The local database listens on `127.0.0.1:55432`. Set `DB_PORT` before `docker compose up` to use another port, and set the same `DB_PORT` when you run the tests. It accepts local connections without a password; never use these settings for a shared database.

## Parallel worktrees

Two git worktrees of this repo can run their tests at the same time:

- The API tests use the database `app_test_<folder>`, where `<folder>` is the name of the checkout folder. The tests create it when it does not exist. Set `TEST_DATABASE_URL` to use a different database.
- `pnpm test:e2e` starts the dev servers on free ports. Set `E2E_WEB_PORT` and `E2E_API_PORT` to choose the ports.

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
PREVIEW_PORT=47180 docker compose -f compose.preview.yaml -p foreman-preview up -d --build --wait
E2E_BASE_URL=http://127.0.0.1:47180 pnpm test:e2e
docker compose -f compose.preview.yaml -p foreman-preview down --volumes
```

The stack-ts `preview` skill does the same with one project and a stable port per branch.

## Local runtime

`pnpm local:up` builds and starts the stack in `compose.local.yaml` and keeps it running (`restart: unless-stopped`). The web app and the API share one origin at http://127.0.0.1:47100. Postgres uses a named volume and has no published port.

The stack mounts two folders read-only: the config folder (`FOREMAN_CLAUDE_DIR`, default `~/.claude-bebopaloo`) and the Foreman data folder (`FOREMAN_DATA_DIR`, default `~/.foreman`). When the data folder does not exist, `pnpm local:up` creates it with mode `0700` first. It stops when `FOREMAN_CLAUDE_DIR` is `~/.claude`.

One more folder is optional: `FOREMAN_MARKETPLACE_DIR`, an absolute path to the folder of one Marketplace with the source kind `directory`, for example the checkout of the factory repo. `pnpm local:up` mounts it read-only at the same path in the API container. Without it, Factory health shows such a Marketplace as not readable by Foreman.

```bash
pnpm local:up
pnpm local:reindex   # rebuilds the Usage index inside the running stack
docker compose -f compose.local.yaml -p foreman-local down   # stop the stack and keep the data
```

Set `LOCAL_PORT` to use another web port and `LOCAL_PROJECT` to use another Compose project name.

### Forge and tracker tokens

Foreman reads work items and pull requests through the factory's adapter plugins. It needs one read-only token for each host and owner in the factory's repo list. The token stays in the macOS Keychain, in the Compose secret `foreman_tokens` (the file `/run/secrets/foreman_tokens` in the API container) and in the memory of the runner. It is never in a file of the repo, in an environment value of a container or in a log.

For each owner:

1. Create a fine-grained token on GitHub. Give it the owner of the repos, only those repos, an expiry date, and these read permissions: Metadata, Contents, Issues, Pull requests, Commit statuses, Checks and Actions.
2. Store it in the Keychain. The command asks for the token, so it does not reach your shell history:

   ```bash
   security add-generic-password -s foreman -a github.com/<owner> -w
   ```

3. Run `pnpm local:up` again. It reads one Keychain item for each distinct `<host>/<owner>` in the repo list, with the service `foreman` and `<host>/<owner>` as the account. A missing item is an owner that shows "not connected: no token". The stack starts anyway.

At the end of `pnpm local:up`, a smoke test runs inside the API container. For each owner it runs one allow-listed read command (`pr list --state open`) through the installed forge adapter and prints one line, for example `github.com/acme: connected`. It exits with an error when the adapter output is not valid, the token is not a fine-grained token, or the adapter plugin is not readable. The API image has Python, `uv`, `gh` and `git` for the adapters.

## Database changes

Change `packages/db/src/schema.ts`, run `pnpm db:generate`, read the generated SQL in `packages/db/migrations/`, and commit both.

## Configuration

The API reads these variables at start-up and stops if one is invalid.

| Variable       | Default                                                |
| -------------- | ------------------------------------------------------ |
| `DATABASE_URL` | none; `pnpm dev` uses the local database               |
| `HOST`         | `127.0.0.1`                                            |
| `PORT`         | `47130`                                                |
| `CORS_ORIGINS` | `http://127.0.0.1:47173`; a comma-separated allow-list |
| `LOG_LEVEL`    | `info`                                                 |
