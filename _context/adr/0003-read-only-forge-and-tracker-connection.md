# 3. Foreman reads the forge and the tracker through the adapters, with its own read-only credential

## Status

Accepted, 2026-11-14. Amends factory [ADR 0007](https://github.com/bebopaloo/factory/blob/main/_context/adr/0007-foreman-admin-ui.md) (scope, data sources and security).

## Context

The Operator wants Foreman to show the factory's work and controls, not only its usage. The **Foreman dash** and the Controls view need tracker and forge data: issues, pull requests, CI and gate states, Releases, Waivers and Release records. The Operator uses Foreman for three purposes: to run the factory, to show stakeholders how the factory works, and to move through an audit with links out to the forge and the tracker.

Factory ADR 0007 says that Foreman sends nothing out. Only an adapter knows how a forge or a tracker works (factory ADR 0001 and ADR 0012). The adapters use the Operator's `gh` login or the Factory identity, and both can write. Foreman runs in Docker, and a container cannot read the macOS Keychain.

There were three options:

- The factory writes local snapshots of tracker and forge data, and Foreman reads them. Foreman keeps "sends nothing out", but the data is only as new as the last factory run.
- Foreman calls the forge and tracker APIs in its own code. It copies adapter logic into TypeScript for each tracker.
- Foreman runs the adapter command lines with a read-only credential of its own.

A Python backend that imports the adapter modules was also rejected. The adapter contract is the command line and its JSON output, not the modules, and the backend stays TypeScript as the pilot of the `stack-ts` pack.

## Decision

- **Read-only.** Foreman has no action that changes the tracker, the forge, the repos or the factory. A refresh button is allowed. Every approval stays in a skill, the tracker or the forge.
- **The adapters.** The API runs the adapter command line as a subprocess, with `uv run`, and validates the JSON output with the contract shapes. It uses the adapter version that the factory has installed in the config folder.
- **A command allow-list.** One list in the code names the read commands that Foreman may run. Foreman refuses any other command before a subprocess starts.
- **The hosts.** Foreman's own code calls no host. The adapter subprocess gets only the forge and tracker hosts that the repo config names. Foreman sends no telemetry.
- **The credential.** A fine-grained personal access token, for Foreman alone, with read permissions only: Metadata, Contents, Issues, Pull requests, Commit statuses, Checks and Actions. A fine-grained token has one resource owner, so Foreman has one token for each forge host and owner, and each token covers only that owner's repos in the factory's repo list. Each token has an expiry date. A future tracker adapter gets its own read-only token by the same rule. Foreman accepts only the token type that the adapter declares (fine-grained). GitHub has no API that lists the permissions of a fine-grained token, so Foreman cannot warn about a write permission; the command allow-list keeps Foreman from writing.
- **The token storage.** The tokens are in the macOS Keychain, one item for each host and owner. `pnpm local:up` reads them on the host and gives them to the API container as a Compose secret. The API puts each token only into the environment of an adapter subprocess, in the variable that the adapter declares. The token never goes into the repo, an env file, a log, an API response or the database. With no token, Foreman starts, and the forge and tracker views show "not connected".
- **The cache.** Foreman fetches on start, each 15 minutes while it runs, and on a refresh request. The contract has no "updated" time, so each fetch reads the full lists, and reads the details only of open items and of items whose state or labels changed; a full fetch runs once a day and on `pnpm reindex`. The results go into Postgres, in the **Work cache**. A reindex restores the open items and the newest closed items, but not the older closed items. The forge and the tracker stay the record. The views read only the cache and show the "data as of" time. When a fetch fails, the views keep the last data and show its age and a short reason.
- **Security artefacts.** Foreman reads the Waivers, the Risk map, the Control register, the Threat model and the Release records from the forge, at the main branch and the `production` branch, never from a local checkout. It parses the Release record from the JSON file that `perform-release` attaches.
- **Untrusted text.** Foreman shows structured fields and titles only, as plain text, with no Markdown. It shows no body of an issue, a comment, a review thread or a pull request. Foreman takes each link from the `url` field of the adapter output, only when it uses `https`, has the repo's host and has no user name, password or port. It never shows a link that it takes from text. The page loads no image or script from another host.
- **Session history.** The session timeline uses metadata only. Foreman stores and returns no prompt, reply, tool input or tool output.
- **Client scope.** Each entry in the factory's repo list names its client. Foreman shows "All" or one client. With one client in scope, every view shows only the data of that client's repos, and the header shows the scope. A repo with no client is "Unassigned" and shows only in "All".

## Consequences

- The refresh button gets new data, and Jira or Linear work with no Foreman change, through their adapters.
- Three tests prove that Foreman runs no write command: the token type check, the command allow-list and the host allow-list. To undo the connection, the Operator deletes the Keychain items and empties the Work cache.
- The API image needs `uv`, Python and `gh`. The config folder mount already holds the installed adapters.
- The Forge contract (factory ADR 0012) needs two read commands: `file get <path> --ref <branch|tag>` and `release asset <tag> <name>`.
- The factory-Foreman source contract grows: the repo list gets a `client` field, which `context-init` writes. Foreman never writes the repo list.
- A repo with the `control_events` module off has no review events. For it, Foreman shows only the forge data (the `factory/machine-gate` status, the Factory identity reviews and the merge) with a note.
- The token expires. The Operator renews it, and a client organisation can block or need to approve fine-grained tokens. For such a client, a read-only GitHub App is the fallback.
- Foreman still sees only the local runtime. Cloud and CI sessions need another source later.
