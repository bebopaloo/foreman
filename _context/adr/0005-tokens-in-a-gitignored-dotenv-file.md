# 5. The forge and tracker tokens live in a gitignored dotenv file, and `pnpm dev` is the only way to run Foreman

## Status

Accepted, 2026-11-17. Supersedes the paragraph "The token storage" of [ADR 0003](0003-read-only-forge-and-tracker-connection.md).

## Context

Foreman had four ways to run: `pnpm dev`, `pnpm local:up`, the preview and the database container. The Operator runs Foreman by hand, attended, on one machine. One way is enough.

The local stack was the only way that gave the forge and tracker views their tokens. It read the tokens from the macOS Keychain and gave them to the API container as a Compose secret. `pnpm dev` ran with no token.

## Decision

- **One way to run.** `pnpm dev` is the only way to run Foreman by hand. The local stack is removed: `compose.local.yaml`, `scripts/local-up.sh` and `scripts/keychain-tokens.ts`. The database container (`compose.yaml`) and the preview (`compose.preview.yaml`) stay.
- **The token storage.** The tokens are in a gitignored dotenv file in the repo root, in the variable `FOREMAN_TOKENS_JSON`. The value is a JSON object that maps `<host>/<owner>` to a token. The Operator chose this over the Keychain.
- **The load.** `pnpm dev` loads the file with the Node option `--env-file-if-exists`. No dependency is added. The repo holds `.env.example` with a fake value.
- **The check.** The API validates the variable with Zod at start-up and stops when the value is not valid. A missing variable means no tokens: the views show "Not connected".
- **The use.** ADR 0003 does not change in any other way. The API puts each token only into the environment of an adapter subprocess, in the variable that the adapter declares. The token never goes into a tracked file, a log, an API response or the database.

## Consequences

- The tokens are plain text on the disk of the Operator, in a file that Git ignores. The Keychain protected them better. The Operator accepts this for a local, read-only, fine-grained token with an expiry date.
- The secret scan and the `.gitignore` rule for `.env` and `.env.*` keep the file out of the repo. `.env.example` is the one tracked file.
- Foreman no longer runs all the time in a container. The Operator starts `pnpm dev` when needed.
- The host needs `uv`, `gh` and `git` for the adapters. The API image of the preview already has them.
- To undo the connection, the Operator deletes `FOREMAN_TOKENS_JSON` from the file and empties the Work cache.
