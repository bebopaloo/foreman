# foreman

Foreman is the bebopaloo factory's pilot. It is built clean-room: never read, ask for, or copy code, files or screenshots from any other usage dashboard or admin tool. Work only from the Spec in `_context/features/` and this repo.

## Verify

Start the local database first: `docker compose up -d --wait db` (it listens on `127.0.0.1:55432`).

| Check                         | Command                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| Types                         | `pnpm typecheck`                                                     |
| Lint                          | `pnpm lint`                                                          |
| Format                        | `pnpm format:check`                                                  |
| Unit, component and API tests | `pnpm test`                                                          |
| One API test                  | `pnpm --filter @foreman/api exec vitest run <file> -t "<name>"`      |
| End to end                    | `pnpm test:e2e` (first run: `pnpm exec playwright install chromium`) |
| Preview of the branch         | the `stack-ts:preview` skill                                         |

All of them pass before a commit.

## Constraints

- Foreman binds to `127.0.0.1` only. No telemetry, no external fonts or scripts, and no outbound HTTP from Foreman's own code. The one exception: the adapter subprocesses run allow-listed read commands against the configured forge and tracker hosts, with Foreman's read-only token (`_context/adr/0003-read-only-forge-and-tracker-connection.md`).
- Foreman is read-only. It never changes the tracker, the forge, the repos or the factory.
- It reads Claude Code's own files and never writes them. Changes to Claude Code settings go through factory skills, not through Foreman.
- The API runs TypeScript with Node type stripping: use only erasable syntax (no `enum`, no parameter properties, no `namespace`), and import local files with their `.ts` extension.
- `.claude/rules/` holds the Repo rules from the factory's Rule templates. Change a rule there in its own commit; `.prettierignore` skips the folder so the files stay comparable with the templates.

## Context

- Rules: `.claude/rules/`. Factory settings: `.claude/factory.json`.
- Specs, decisions and terms: `_context/` (`features/`, `adr/`, `terminology.md`).
