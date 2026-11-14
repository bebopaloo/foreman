# Forge and tracker connection

**Status:** Approved
**Work items:** #23

Source: foreman ADR 0003 and factory ADR 0007 (amended 2026-11-14), step 2 of the build order. The Foreman dash (step 3), the Controls data (step 4) and the session timeline (step 5) are not in this Spec.

## Problem

The Operator runs the factory on several repos for several clients. To see the work state, the Operator opens the tracker and the forge for each repo, one by one. Foreman shows only usage. The **Foreman dash** and the later views need the tracker and forge data in one place, on this machine, fast, and also when the forge is slow or down.

The Operator also shows Foreman to stakeholders and auditors of one client. Today every view shows every **Project**, so a screen share can show the work and the usage of another client.

Foreman needs a read-only connection to the forge and the tracker, a cache of the work state, and a **Client scope** that every view obeys.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator chooses the Client scope, starts a refresh and reads the views.
- **Stakeholders and auditors of one client**: they see Foreman only in a screen share by the Operator, in that client's scope. They never use Foreman themselves.
- **The Foreman dash** (step 3) and the later views: they read the API of this Spec.

## Acceptance criteria

Fixtures are synthetic. The tests use a synthetic adapter: a small command line that returns contract-valid JSON and records its arguments, its working folder and its environment. No real token, repo or issue goes into the repo.

### Clients from the repo list

- **Given** a repo list with two repos of the client `acme`, one repo of the client `bebopaloo` and one repo with no `client`
- **When** the web app asks for the clients
- **Then** the API returns `acme` with 2 repos, `bebopaloo` with 1 repo, and an "Unassigned" count of 1.

### An unassigned repo shows only in "All"

- **Given** a repo with no `client` in the repo list, and cached issues for it
- **When** the web app asks for issues with the scope `acme`, and then with no scope
- **Then** the first response has none of its issues
- **And** the second response has its issues.

### An unknown client

- **Given** a repo list with no client `globex`
- **When** a request has `client=globex`, or the Operator opens a Foreman URL with `?client=globex`
- **Then** the API rejects the request with status 400
- **And** the web app shows "Unknown client" and no data. It does not fall back to "All".

### An invalid repo list entry

- **Given** a repo list with one valid entry and one entry whose `client` has a space in it
- **When** a fetch runs
- **Then** the fetch reads the valid repo
- **And** the status names the invalid entry by its position and the field that failed, with no field value.

### No repo list

- **Given** a config folder with no repo list
- **When** a fetch runs
- **Then** the fetch ends with the state "idle", 0 repos and the reason "no repo list"
- **And** the usage views work as before.

### A repo leaves the repo list

- **Given** cached issues and pull requests for a repo, and a valid repo list that no longer has that repo
- **When** the next fetch runs
- **Then** the cache has no rows of that repo.

### An invalid repo list

- **Given** cached data for two repos, and a repo list that is not valid JSON, or whose `repos` is not a list
- **When** a fetch runs
- **Then** the fetch changes no row and ends with the reason "repo list not readable"
- **And** an entry that fails validation keeps its cached rows.

### Duplicate repo list entries

- **Given** two repo list entries for `Acme/App` and `acme/app` on `github.com` with the same `client`
- **When** a fetch runs
- **Then** Foreman uses the first entry, and fetches the repo once
- **And** when the two entries have different `client` values, Foreman skips both, and the status names their positions.

### A repo with no forge name

- **Given** a repo list entry with no `repo` field
- **When** a fetch runs
- **Then** no adapter runs for it
- **And** its state is "not connected: no forge name".

### The adapter from its plugin

- **Given** an installed adapter plugin whose `plugin.json` declares its command line in the `factory_adapter` key, and an `installed_plugins.json` key `factory-github@bebopaloo-factory` with a user-scope entry
- **When** a fetch runs for a repo whose `forge` is `factory-github`
- **Then** Foreman runs that command line, from the install folder that the entry names.

### An ambiguous or missing plugin

- **Given** a repo whose `forge` is `factory-github`, and either no matching key or two keys `factory-github@a` and `factory-github@b` with user-scope entries
- **When** a fetch runs
- **Then** no subprocess starts for that adapter
- **And** the repo's state is "adapter not readable by Foreman".

### A plugin with no adapter key

- **Given** a repo whose `forge` names an installed plugin with no `factory_adapter` key
- **When** a fetch runs
- **Then** no subprocess starts for that adapter
- **And** the repo's state is "adapter not readable by Foreman".

### An adapter command outside its plugin

- **Given** a `factory_adapter` key whose command is `../other/run.py` or an absolute path, or an install folder that resolves outside `<FOREMAN_CLAUDE_DIR>/plugins/`
- **When** a fetch runs
- **Then** Foreman refuses the adapter, and no subprocess starts.

### An adapter of the wrong role

- **Given** a repo whose `forge` field names a plugin whose `factory_adapter` role is `tracker`
- **When** a fetch runs
- **Then** Foreman refuses the adapter, and no subprocess starts.

### No token

- **Given** no token for `github.com/acme`, and cached data for a repo of `acme`
- **When** Foreman starts and a fetch runs
- **Then** no subprocess starts for the repos of that owner
- **And** the status shows "not connected: no token" for `github.com/acme`
- **And** the work routes return no data for the repos of that owner
- **And** the usage views work as before.

### One token for each owner

- **Given** tokens for `github.com/acme` and `github.com/bebopaloo`, and repos `acme/app` and `bebopaloo/foreman`
- **When** a fetch runs
- **Then** the adapter calls for `acme/app` get only the `acme` token
- **And** the calls for `bebopaloo/foreman` get only the `bebopaloo` token.

### A token that is not fine-grained

- **Given** a token for `github.com/acme` whose prefix is not the prefix that an adapter declares, for example a classic token
- **When** Foreman starts
- **Then** no subprocess of that adapter starts for that owner
- **And** the status shows "token refused: not a fine-grained token"
- **And** no log line and no response holds the token or its prefix.

### A token that the forge rejects

- **Given** cached data for a repo, and an adapter that reports an authentication error
- **When** a fetch runs
- **Then** the status shows "token rejected" for that owner
- **And** the views keep the cached data and show its "data as of" time.

### Error classes from the adapter text

- **Given** adapter errors with the texts `HTTP 401: Bad credentials`, `HTTP 404: Not Found`, `API rate limit exceeded`, `gh timed out after 120 s` and `something else`
- **When** the runner maps them
- **Then** the error classes are `auth`, `not_found`, `rate_limit`, `timeout` and `other`
- **And** an exit code other than 0 and 1, an end by a signal, or a standard error that is not an error object also maps to `other`.

### The forge fails and the tracker works

- **Given** a repo whose tracker adapter returns valid output and whose forge adapter fails with `not_found`
- **When** a fetch runs
- **Then** the cache has the new issues and Releases of that repo
- **And** the repo's forge state is "repo not found or no access", and its tracker state is "connected".

### A write command is refused

- **Given** a code path that asks the runner for `pr merge 12`, `issue state 3 --set DONE` or any command that is not on the allow-list
- **When** the runner gets the request
- **Then** it refuses the command with an error
- **And** no subprocess starts.

### A host that is not allowed

- **Given** a repo list entry with the host `git.example.com`, and `FOREMAN_ALLOWED_HOSTS` with only `github.com`
- **When** a fetch runs
- **Then** no subprocess starts for that repo
- **And** its state is "host not allowed".

### The adapter runs isolated

- **Given** a fetch for the repo `acme/app` on `github.com`
- **When** the synthetic adapter records its call
- **Then** the arguments start with `--host github.com --repo acme/app`
- **And** the working folder is a new empty folder outside any git repo
- **And** the environment holds only the variables in the section "The runner", with the token in the variable that the adapter declares
- **And** the environment holds no variable whose name starts with `FACTORY_`.

### A slow adapter

- **Given** an adapter call that does not end in 60 seconds
- **When** the timeout passes
- **Then** Foreman stops the whole process group of the subprocess and deletes its temporary folder
- **And** the repo's state is "timeout", and the other repos continue.

### Output that breaks the contract

- **Given** an adapter that returns a PR with an unknown key, or with `checks` set to `green`
- **When** a fetch runs
- **Then** Foreman does not store that output, and the repo's state is "invalid adapter output"
- **And** the log names the command, not the output.

### First fetch

- **Given** an empty cache and one connected repo with 3 issues (2 open), 2 pull requests (1 open) and 1 released tracker Release
- **When** the first fetch runs
- **Then** the adapter gets `issue list --state all`, `issue list --state open`, `pr list --state all`, `pr list --state open` and `release list --state all` once each
- **And** `issue relations` for each of the 3 issues, `pr reviews` for each of the 2 pull requests, and `release view` for the released Release
- **And** the cache holds no issue body and no review body.

### Later fetch

- **Given** a cache from an earlier fetch, and a closed issue whose Issue state and labels did not change
- **When** the next fetch runs
- **Then** the adapter gets the five list commands, `issue relations` for each open issue and `pr reviews` for each open pull request
- **And** it gets no detail command for the closed issue that did not change.

### A closed item that changed

- **Given** an issue that was open at the last fetch and is closed now
- **When** the next fetch runs
- **Then** the adapter gets `issue relations` for that issue once
- **And** the fetch after that gets no detail command for it.

### An item that drops out of the list

- **Given** a cached closed issue that is no longer in the 100 newest issues of the list
- **When** a fetch runs
- **Then** the cache keeps that issue with its last data
- **And** the API returns it with `stale: true`.

### An open item older than the 100 newest

- **Given** a repo with 150 issues, of which the oldest is open
- **When** a fetch runs
- **Then** the `issue list --state open` result updates that issue, and it has `stale: false`.

### A new item that closed between two fetches

- **Given** an issue that has no cached row and is closed
- **When** a fetch runs
- **Then** the adapter gets `issue relations` for it once.

### A detail command fails

- **Given** a repo where `issue relations 7` fails with `not_found`, a released tracker Release `v1.0.0` whose `release view` fails with `not_found`, and a review whose commit is empty
- **When** a fetch runs
- **Then** the list results of that repo are written, and issue 7 keeps its earlier relations with the error class `not_found`
- **And** `v1.0.0` records "no forge release", and only a full fetch tries it again
- **And** the review is skipped and counted
- **And** the repo's state is "partial".

### Full fetch

- **Given** a last full fetch more than 24 hours ago, or the Operator runs `pnpm reindex`
- **When** the next fetch runs
- **Then** it reads the details of every listed item again
- **And** after `pnpm reindex`, the work cache is empty before that fetch starts.

### A released Release

- **Given** a tracker Release `v1.2.0` in the state "released", and a tracker Release `v1.3.0` in the state "open"
- **When** a fetch runs
- **Then** the adapter gets `release view v1.2.0` once and caches the tag, the target commit and the asset names
- **And** it gets no forge call for `v1.3.0`.

### Reviews without text

- **Given** a pull request with 2 reviews from the Factory identity and 1 review from the Operator
- **When** a fetch runs
- **Then** the cache has 3 reviews, each with its author, state, commit and time, and no body.

### One repo fails

- **Given** two connected repos, and an adapter that fails for the first repo
- **When** a fetch runs
- **Then** the cache of the second repo is updated
- **And** the first repo keeps its last data, its last good fetch time and a short reason.

### Fetch on start, each 15 minutes and on demand

- **Given** a running API with a token
- **When** the API starts, when 15 minutes pass since the last fetch, or when the web app sends a refresh request
- **Then** a fetch runs, and only one fetch runs at a time.

### A fetch while a fetch runs

- **Given** a fetch that runs
- **When** the web app sends a refresh request, or the 15-minute timer fires
- **Then** the refresh request returns the fetch in progress, the timer skips, and `pnpm reindex` stops with the message that a fetch is running.

### Links from the contract

- **Given** an issue whose `url` is `https://github.com/acme/app/issues/7`, an issue whose `url` is `https://evil.example/x`, and issues whose `url` uses `http`, a port or a user name
- **When** the API returns the issues
- **Then** the first issue has its link
- **And** each other issue has no link.

### A title is plain text

- **Given** an issue title `<img src="https://evil.example/t.png"> **Fix** [this](https://evil.example)`
- **When** the web app shows the title
- **Then** the page shows the title text as it is, with no image, no bold and no link
- **And** the browser makes no request to `evil.example`.

### Usage in a client scope

- **Given** turns in a Project whose path matches a repo of `acme`, and turns in a Project that matches no repo in the list
- **When** the web app asks `/api/usage/breakdown`, `/api/usage/series` or `/api/usage/projects` with `client=acme`
- **Then** the response has only the turns of the `acme` Project
- **And** with no `client`, the response has both Projects.

### A Project outside the client

- **Given** a Project of `bebopaloo`
- **When** a usage request has `client=acme` and that Project's ID
- **Then** the API rejects the request with status 400.

### Limits take no client

- **Given** a running API and a repo list with the client `acme`
- **When** a request to `/api/usage/limits` has `client=acme`
- **Then** the API rejects it with status 400.

### Scope from the URL

- **Given** the Operator opens `/?client=acme`
- **When** the page loads
- **Then** the header shows the scope `acme`
- **And** every link inside Foreman keeps `client=acme`.

### Scope with no URL value

- **Given** the Operator chose `acme` in an earlier visit
- **When** the Operator opens `/` with no `client` value
- **Then** Foreman opens in the scope `acme`
- **And** when no scope is stored, or the browser storage cannot be read, Foreman opens in "All", and the header shows "All" in its distinct style.

### A refresh request from a foreign page

- **Given** a running API
- **When** a request to `POST /api/work/refresh` has an `Origin` header that is not in the allow-list
- **Then** the API rejects it with status 403, and no fetch starts.

### Logs

- **Given** a fetch with a token, titles and logins
- **When** the fetch ends
- **Then** the log has the repo IDs, the command names, the counts, the durations and the error classes
- **And** it has no token, title, login, label, branch name or adapter output.

### Local runtime with the token

- **Given** a Keychain item for Foreman for the account `github.com/acme`, and a repo of `acme` in the repo list
- **When** the Operator runs `pnpm local:up`
- **Then** the API container gets the token as a Compose secret, and the status shows "connected" for `github.com/acme`
- **And** the smoke test in the container runs the installed forge adapter and gets valid output
- **And** with no Keychain item, the stack starts and the status shows "not connected: no token"
- **And** the token is not in any file in the repo, in `docker inspect` environment values or in the container logs.

The Operator checks this scenario by hand. All other scenarios are automated tests.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/work/repo-list` | Reads and validates the factory's repo list |
| `apps/api/src/work/clients` | The **Client scope**: the clients, the repos of each client, and the client of a Project |
| `apps/api/src/work/adapters` | Finds the installed adapter plugins and their declared command lines |
| `apps/api/src/work/tokens` | Reads the tokens for each host and owner, and applies the prefix rule |
| `apps/api/src/work/runner` | The command allow-list, the host allow-list and the isolated subprocess |
| `apps/api/src/work/contract` | The Zod schemas of the adapter output shapes |
| `apps/api/src/work/fetch` | One fetch: the lists, the details and the cache writes, under one lock |
| `apps/api/src/work/schedule` | The fetch schedule and the fetch state |
| `apps/api/src/routes/work.ts` | The work API |
| `apps/api/src/routes/usage.ts` | Gains the `client` filter |
| `packages/db` schema | The work cache tables (below) |
| `packages/shared` | The Zod schemas of the work API and the `client` query value |
| `apps/web/src/scope` | The scope selector, the URL value, the stored last scope and the header label |
| `apps/web/src/connection` | The connection state, the "data as of" time and the refresh button in the header |
| `Dockerfile` | The API image gains Python 3.12 or later, `uv`, `gh` and `git`, at pinned versions |
| `compose.local.yaml` | The secret `foreman_tokens` and the new variables of the API service |
| `Caddyfile` | The content security policy of the web app |
| `scripts/local-up.ts` | `pnpm local:up` reads the Keychain items and passes the tokens as a Compose secret |
| `scripts/adapter-smoke.ts` | Runs one allow-listed read command through the installed forge adapter in the container |

### Configuration

| Variable | Default | Use |
|---|---|---|
| `FOREMAN_ALLOWED_HOSTS` | `github.com` | The hosts that an adapter may call. A comma-separated list. |
| `FOREMAN_TOKENS_FILE` | `/run/secrets/foreman_tokens` | The file with the tokens. With no file, every owner is "not connected: no token". |
| `FOREMAN_FETCH_MINUTES` | `15` | The time between two fetches |
| `FOREMAN_ADAPTER_TIMEOUT_SECONDS` | `60` | The timeout of one adapter call |

The variables of the Usage ingest Spec do not change. Foreman reads the repo list and the plugins below `FOREMAN_CLAUDE_DIR`, which the local runtime already mounts read-only.

### Dependencies on the factory

The factory changes these, in its own work items. This Spec only uses them.

- **The repo list fields.** `context-init register` writes `repo` (`owner/name`), `host` (default `github.com`) and `client` into each entry of `factory/repos.json`, and can fill them in an existing entry.
- **The contract rule.** ADR 0012 adds the rule that a change to the output shape of a command on Foreman's allow-list needs a Foreman change first.
- **The adapter key.** Each adapter plugin's `plugin.json` has a `factory_adapter` key, and ADR 0012 adds the rule:

  ```json
  "factory_adapter": {
    "role": "forge",
    "command": "scripts/forge_github.py",
    "token_env": "GH_TOKEN",
    "token_prefix": "github_pat_"
  }
  ```

  `role` is `forge` or `tracker`. `command` is a path inside the plugin folder. `token_env` is the variable from which the adapter reads its token. `token_prefix` is the prefix of the token type that Foreman accepts for that adapter (fine-grained).

Foreman's tests use synthetic repo lists and plugins, so they do not wait for these work items.

### The repo list

- The path is `<FOREMAN_CLAUDE_DIR>/factory/repos.json`. Foreman reads it at the start of each fetch and never writes it.
- Each entry has `path`, `forge`, `tracker` and `enabled`, and from the factory work item `repo`, `host` and `client`. Foreman validates each entry with a strict Zod schema:
  - `repo` matches `owner/name`;
  - `host` is a host name with no scheme, port or path;
  - `client` matches `^[a-z0-9][a-z0-9-]{0,39}$`.
- When the file is missing, is not valid JSON, or its `repos` is not a list, the fetch changes no row and ends with the reason. The factory writes the file in place, so a read can see half a file.
- An invalid entry is skipped, and keeps its cached rows. The status names its position and the failed field, with no value. The other entries continue.
- Foreman compares `host`, `owner` and `name` in lower case. When two or more entries name the same repo, Foreman uses the first one. When their `client` values differ, Foreman skips all of them, and the status names their positions.
- Foreman deletes the rows of a repo only when a valid repo list does not name it.
- Foreman shows every entry in the list, also an entry with `enabled` false. `enabled` controls the **Unattended loop**, not Foreman.
- A repo's ID is the first 12 hex characters of the SHA-256 of `<host>/<owner>/<name>`, in lower case. A repo path or name never goes into a URL; a client name can, because it is a business name that the Operator chose.

### Client scope

- The clients are the distinct `client` values in the repo list. A repo with no `client` is "Unassigned".
- With a `client` value, every list route returns only the data of that client's repos. With no value, it returns all data ("All").
- An unknown `client` value gets status 400.
- The client of a usage **Project** is the client of the repo list entry whose `path` equals the Project key. A Project with no matching entry shows only in "All".

### Adapters

- `<FOREMAN_CLAUDE_DIR>/plugins/installed_plugins.json` names the install folder of each plugin. Its keys are `<plugin>@<marketplace>`. Foreman uses the keys whose part before `@` equals the plugin name in the repo list and that have an entry with the user scope. No match, or more than one match, makes the repo "adapter not readable by Foreman".
- Foreman maps the install folder to the mounted config folder by the part of the path below `plugins/`. The result must resolve inside `<FOREMAN_CLAUDE_DIR>/plugins/`.
- Foreman reads `.claude-plugin/plugin.json` in that folder, and validates the `factory_adapter` key. The `role` must match the repo list field that names the plugin. The `command` must resolve to a file inside the plugin folder.
- A missing plugin, a missing key or an invalid key makes the repo "adapter not readable by Foreman".

### Tokens

- A fine-grained token has one resource owner: one user or one organisation. Thus Foreman has one token for each `<host>/<owner>`.
- The tokens file is a JSON object with one token for each `<host>/<owner>`, for example `{"github.com/acme": "…", "github.com/bebopaloo": "…"}`. A repo uses the token of its host and owner. With no token, the repo is "not connected: no token", and the work routes return no data for it.
- Foreman applies the `token_prefix` of each adapter to the token. A token with another prefix is "token refused: not a fine-grained token" for that adapter, and no subprocess of that adapter runs for that owner.
- The token is in memory only in the runner. It never goes into a log, a response, the database or an error message. The logger redacts the key `token` and every key that ends in `_token`, with a custom serializer, because a Pino `redact` path cannot match a key suffix.
- `pnpm local:up` reads one Keychain item for each distinct `<host>/<owner>` in the repo list, with the service `foreman` and `<host>/<owner>` as the account (`security find-generic-password -s foreman -a github.com/acme -w`). It gives the JSON object to Compose in an environment variable of the Compose process only, and Compose mounts it as the secret `foreman_tokens`. A missing item is a missing host in the object.
- The README gives the setup steps: create a fine-grained token with the read permissions Metadata, Contents, Issues, Pull requests, Commit statuses, Checks and Actions, with the owner of the repos and only those repos, with an expiry date, and store it with `security add-generic-password -s foreman -a github.com/<owner> -w`. Repeat for each owner.

### The runner

The runner is the only module that starts a subprocess.

- **Command allow-list.** The runner accepts only these commands, with these options:

  | Role | Command |
  |---|---|
  | Tracker | `issue list --state all` |
  | Tracker | `issue list --state open` |
  | Tracker | `issue relations <number>` |
  | Tracker | `release list --state all` |
  | Forge | `pr list --state all` |
  | Forge | `pr list --state open` |
  | Forge | `pr reviews <number>` |
  | Forge | `release view <tag>` |

  Any other command, option or argument shape is refused before a subprocess starts. `<number>` is a positive integer, and `<tag>` matches the contract's tag pattern.
- **Host allow-list.** The runner refuses a repo whose `host` is not in `FOREMAN_ALLOWED_HOSTS`.
- **The call.** `uv run <command file> --host <host> --repo <owner/name> <command>`, as an argument list with no shell, in its own process group.
- **The working folder.** A new empty temporary folder for each call, outside any git repo, deleted after the call. The adapter then finds no `.claude/factory.json`, so it never uses the Factory identity.
- **The environment.** Only these variables: `PATH`, `HOME` and `GH_CONFIG_DIR` (both in the temporary folder), `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `NO_COLOR=1`, `UV_OFFLINE=1`, `UV_PYTHON_DOWNLOADS=never`, `UV_CACHE_DIR` (in the temporary folder), and the token in the adapter's `token_env`. No other variable of the API process passes through.
- **Limits.** The timeout is `FOREMAN_ADAPTER_TIMEOUT_SECONDS`. At the timeout, the runner stops the whole process group, so that no `gh` process keeps the token, and deletes the temporary folder. Standard output is limited to 20 MB and standard error to 64 KB; more stops the call.
- **The result.** Exit code 0: the runner parses standard output as JSON and validates it with the strict contract schema of that command. Exit code 1 with an error object on standard error: the runner maps the `error` text to an error class with the table below. Any other result maps to `other`. The runner never stores or logs the error text.

| Error text contains (any case) | Error class |
|---|---|
| `HTTP 401` or `Bad credentials` | `auth` |
| `HTTP 404` or `Could not resolve` | `not_found` |
| `rate limit` | `rate_limit` |
| `timed out` | `timeout` |
| none of these | `other` |

The adapters give only free text today. An error kind in the contract is a later factory change; until then, a test covers each row of the table.

| Error class | Shown as |
|---|---|
| `auth` | "token rejected" |
| `not_found` | "repo not found or no access" |
| `rate_limit` | "rate limit" |
| `timeout` | "timeout" |
| `invalid_output` | "invalid adapter output" |
| `other` | "adapter error" |

### Fetch

- A fetch runs under a Postgres advisory lock, with a key that differs from the usage refresh lock. While a fetch holds the lock, `POST /api/work/refresh` returns the fetch in progress and the timer skips.
- For each connected repo, in this order:
  1. `issue list --state all`, `issue list --state open`, `pr list --state all`, `pr list --state open` and `release list --state all`. The open lists reach open items that are older than the 100 newest.
  2. `issue relations` for each open issue, and for each issue that has no cached row or whose `state`, `issue_state` or labels differ from the cache.
  3. `pr reviews` for each open pull request, and for each pull request that has no cached row or whose `state` or labels differ from the cache.
  4. `release view <name>` for each tracker Release in the state "released" with no cached forge release and no "no forge release" record.
- Each item records the time of the last list that included it. An item that the last fetch did not list has `stale: true` in the API.
- A detail command that fails leaves the cached details of that item as they are, and marks the item with the error class. The list results of the repo are still written. The repo's state is then "partial". A `release view` that returns `not_found` records "no forge release", and only a full fetch tries it again. A review that fails the contract shape, for example with an empty commit, is skipped and counted.
- The two roles of a repo are separate. When one adapter fails, the data of the other is still written.
- A full fetch runs step 2 and step 3 for every listed item. It runs when the last full fetch is more than 24 hours old, and after `pnpm reindex`.
- The writes of one repo run in one transaction. The adapter calls run outside it.
- A repo that fails keeps its rows. The fetch records the error class and continues with the next repo.
- A fetch never deletes a cached item that drops out of a list. It deletes all rows of a repo that a valid repo list no longer names.
- `pnpm reindex` also deletes the work cache, and the next fetch is a full fetch. While a fetch runs, `pnpm reindex` stops with the message that a fetch is running. A reindex restores the open items and the 100 newest closed items of each list; older closed items do not come back.
- The "data as of" time of a repo is the end time of its last fetch with no error.

### Work cache (Postgres)

All times are `timestamp with time zone`, in UTC. The cache stores no body of an issue, a pull request, a comment or a review, and no `url` that fails the link check.

| Table | Columns |
|---|---|
| `work_repos` | repo ID (primary key), host, owner, name, client (or none), forge plugin, tracker plugin, forge state, forge error class, tracker state, tracker error class, last good fetch time |
| `work_issues` | repo ID and number (primary key), title, state, Issue state, priority, labels, author, link, parent, children, blocked by, last listed time, details fetch time, details error class |
| `work_pull_requests` | repo ID and number (primary key), title, state, draft, head branch, base branch, author, checks, labels, link, last listed time, details fetch time, details error class |
| `work_reviews` | repo ID, pull request number, position (primary key), author, state, commit, time |
| `work_releases` | repo ID and name (primary key), state, link, issue numbers |
| `work_forge_releases` | repo ID and tag (primary key), target commit (or none), asset names, link, "no forge release" flag |
| `work_fetch_runs` | ID, start time, end time, kind (`full` or `incremental`), state, repos read, adapter calls, short failure reason |

There are indexes on the repo ID of each table and on the Issue state.

### Links

- A link comes only from the `url` field of the adapter output.
- Foreman keeps a `url` only when it uses `https`, its host equals the repo's `host`, and it has no user name, password or port. Otherwise the item has no link.
- Foreman never takes a link from a title, a body or a label.

### Work API

All routes are below `/api/work`, and their schemas are in `packages/shared`. Query schemas use `.strict()`. The routes are `public: true` for the reason in the Usage ingest Spec. Every list route takes the optional `client` and `repo` (a repo ID) values, and is paginated with `limit` (default 100, maximum 500) and `cursor`.

| Route | Returns |
|---|---|
| `GET /status` | The fetch state (`idle`, `running` or `failed`) and the reason of an idle fetch with no repos, the start and end of the last fetch and of the last full fetch, the repo list problems (position and field), the connection state of each `<host>/<owner>`, and the forge and tracker state, error class and "data as of" time of each repo |
| `POST /refresh` | Starts a fetch, or returns the fetch in progress. Status 202. It checks `Origin` against `CORS_ORIGINS`. |
| `GET /clients` | Each client with its repo count, and the count of unassigned repos |
| `GET /repos` | Each repo: ID, `owner/name`, host, client, state and "data as of" time |
| `GET /issues` | Issues with their repo ID, number, title, state, Issue state, priority, labels, author, link, relations and `stale` flag. It filters by `issue_state` and `state`. |
| `GET /pull-requests` | Pull requests with their repo ID, number, title, state, draft, branches, author, checks, labels, link, `stale` flag, and review counts by author and state |
| `GET /releases` | Tracker Releases with their state, issue numbers and link, and the forge release of each released one |

A repo ID that does not belong to the `client` gets status 400.

Order: issues and pull requests sort by repo ID, then by number from high to low. Releases sort by repo ID, then by name from high to low. Clients and repos sort by name. The cursor is an opaque base64url value of the last sort key. A cursor that is not valid gets status 400.

### Usage API changes

- `/api/usage/projects`, `/api/usage/breakdown` and `/api/usage/series` take an optional `client` value, by the rules of the section "Client scope".
- A `project` value outside the `client` gets status 400.
- `/api/usage/limits` takes no `client` value, because a **Limit window** belongs to the whole plan. The Usage view hides the limit panel in a client scope.

### Web app

- The header shows the scope on every page: the client name, or "All" in a distinct style with a different background. It also shows the connection state, the oldest "data as of" time of the repos in scope, and one Refresh button. The button sends `POST /api/work/refresh` and `POST /api/usage/refresh`.
- The scope selector lists "All" and each client.
- The scope is the `client` value in the URL. Every link inside Foreman keeps it.
- With no `client` value, the page uses the last scope from browser storage, else "All". Each read and write of the storage is in a `try`/`catch`; a failure means "All".
- An unknown client shows "Unknown client" and no data.
- Titles, labels, branch names and logins are React text nodes. The web app has no Markdown renderer and no `dangerouslySetInnerHTML`. Links use only the `link` field of the API, with `rel="noopener noreferrer"`.
- The content security policy allows images, scripts, styles and connections only from the same origin. The `Caddyfile` sets it in the local runtime.

### Access and security

- The bind, the `Host` check and the `Origin` check of the Usage ingest Spec apply to all work routes.
- Foreman's own code makes no outbound call. Only the adapter subprocess calls a host, and only a host in `FOREMAN_ALLOWED_HOSTS`.
- Three tests prove that Foreman runs no write command: the prefix rule, the command allow-list and the host allow-list. They do not prove that the token itself is read-only; the setup steps and the forge's own token settings do that.

## Gating and rollout

- **Gating:** not required. The feature adds new routes, new tables and a header. The new `client` value on the usage routes is optional, and a request with no value gets the same result as before. The token is the switch: with no Keychain item, no adapter runs and nothing goes out.
- **Rollout:** the issues of this Spec are blocked by the Usage ingest issues for the usage routes, `pnpm reindex` and the local runtime stack. They merge into the main branch one by one (Incremental). The runner, the allow-lists and the token rules merge before the first fetch. Real data shows after the factory work items exist and the Operator stores the tokens. A schema change needs no data migration: `pnpm reindex` empties the cache, and the next full fetch fills it again.
- **Undo:** delete the Keychain items, run `pnpm local:reindex` to empty the work cache, and restart the stack; the views then show "not connected". To undo the code, revert the merged pull requests.
- **Dev and CI:** the runner calls `uv run`, so the synthetic adapter is a Python script, and dev and CI need `uv` and Python 3.12 or later. The CI workflow gains that setup step.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The cache holds issue and pull request titles, labels, branch names and the forge logins of authors and reviewers. Logins of client staff and of strangers are personal data. Titles can hold client-confidential words.
- All data stays on this Mac. The **Client scope** keeps one client's data off the screen in a screen share of another client.
- The token is a credential. It stays in the Keychain, the Compose secret and the runner's memory.

## Out of scope

- The **Foreman dash** and every other view of the work data (step 3).
- The Controls data: Waivers, the Risk map, the Control register, the Threat model, Release record assets, the `factory/machine-gate` status, and the contract commands that they need (step 4).
- The session timeline (step 5).
- The repo list fields and the `factory_adapter` key. They are factory work items.
- Every write to the forge, the tracker, the repos or the factory.
- Bodies of issues, pull requests, comments, review threads and reviews.
- A tracker on another host than the forge, for example Jira.
- A warning before a token expires.
- The warning of ADR 0003 when the forge reports a write permission on the token. GitHub has no API that lists the permissions of a fine-grained token.
- An error kind in the adapter contract.
- Cloud and CI sessions.

## Risks

- **Claude Code can refuse an unknown key in `plugin.json`.** Then the factory work item puts the adapter key into its own file next to `plugin.json`, and this Spec reads that file.
- **Some closed items do not come back after a reindex.** Each list returns at most the 100 newest items, so a closed item outside them is lost when the cache is emptied.
- **An installed adapter can be older than the contract.** For example, the installed tracker adapter can lack `release list`. Then the call fails with "invalid adapter output" or "adapter error", and the factory upgrade fixes it.
- **The path of a repo list entry can differ from the Project key**, for example when `context-init register` ran in a worktree. Then that Project shows only in "All". `context-init` can fix the entry.

## Open questions

- None.
