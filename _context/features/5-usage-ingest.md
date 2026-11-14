# Usage ingest

**Status:** Approved
**Work items:** #5

Source: the clean-room brief `2026-11-13-foreman-usage-brief.md` (13 Nov 2026), sections 3 to 7, 9 and 10. The Usage view (Spec B) and the factory items F1 to F4 are not in this Spec.

## Problem

The Operator runs many Claude Code sessions across client repos, the factory and side projects. The Operator cannot see which **Project**, model, **Agent type** or skill uses the tokens, or how close the plan came to each **Limit window** in the past weeks.

Claude Code deletes old transcripts, so the history disappears after a period. The Operator cannot plan limit use, compare skills or later bill an engagement without that history.

Foreman needs a data layer that reads the transcripts, the **Transcript archive** and the **Limit readings** into a **Usage index**, and an API that gives this data to the Usage view.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this machine. The Operator reads the Usage view and starts a refresh.
- **The Usage view** (Spec B): the web app that reads the API of this Spec.

## Acceptance criteria

Fixtures are synthetic and use only the public transcript format. No real transcript goes into the repo.

### Ingest of a session

- **Given** a config folder with one synthetic session transcript of 3 **Turns** in the main conversation
- **When** a refresh runs
- **Then** the **Usage index** has 3 turns, each with its time, model, token counts, **Project**, branch and **Agent type** "main"
- **And** the index holds no prompt, reply, tool input or tool output.

### One message on several lines

- **Given** a transcript that writes one assistant message on 3 lines with the same message ID
- **When** a refresh runs
- **Then** the index has 1 turn for that message, with the largest token counts of the 3 lines.

### A turn in the live folder and in the archive

- **Given** a session whose transcript is in the live folder and, compressed, in the **Transcript archive**
- **When** a refresh runs
- **Then** each turn of the session counts once.

### History survives after Claude Code deletes a transcript

- **Given** a session that is only in the **Transcript archive**
- **When** a refresh runs, or `pnpm reindex` runs
- **Then** the index has the turns of that session.

### Only new data is read

- **Given** a refresh that read a transcript, and 2 new lines that Claude Code appended to it after
- **When** the next refresh runs
- **Then** the ingest reads only the 2 new lines
- **And** the log shows the file path and the count of new lines, and no record content.

### A file that changed in place

- **Given** a refresh that read a transcript, and a later change to bytes that the refresh already read
- **When** the next refresh runs
- **Then** the ingest reads the full file again
- **And** each turn still counts once.

### A half-written last line

- **Given** a transcript whose last line has no line end
- **When** a refresh runs
- **Then** the ingest skips that line
- **And** the next refresh reads it when the line is complete.

### A malformed line

- **Given** a transcript with one line that is not valid JSON, between two valid turns
- **When** a refresh runs
- **Then** the index has the 2 valid turns
- **And** the log shows the file path and a count of 1 skipped line.

### Project from a worktree or a subfolder

- **Given** sessions whose working folder is the main checkout of a repo, a worktree of that repo, and a subfolder of that repo
- **When** a refresh runs
- **Then** all their turns have the same **Project**, whose key is the path of the main checkout and whose label is the folder name of the main checkout.

### Two Projects with the same folder name

- **Given** two repos at `/synthetic/a/app` and `/synthetic/b/app`
- **When** the API returns the Projects
- **Then** the labels are `app (a)` and `app (b)`.

### A session outside a repo

- **Given** a session whose working folder is not in a git repo
- **When** a refresh runs
- **Then** its Project key is the folder path and its label is the folder name with "(no repo)".

### Agent type of a sub-agent

- **Given** a sub-agent transcript with a meta file that names the agent type `software-developer`, and a second sub-agent transcript with no meta file
- **When** a refresh runs
- **Then** the turns of the first sub-agent have the **Agent type** `software-developer`
- **And** the turns of the second have the **Agent type** "sub-agent (unknown)".

### Exact skill attribution

- **Given** a session where the main conversation calls the skill `to-code` with the `Skill` tool, and the skill starts a `software-developer` sub-agent
- **When** a refresh runs
- **Then** the `to-code` row shows 1 call
- **And** the turns of the sub-agent count as exact turns of `to-code`.

### Estimated skill attribution

- **Given** a slash command that loads the skill `review-spec`, 4 main-conversation turns after it, a user message with only tool results, 2 more turns, and then a real user message
- **When** a refresh runs
- **Then** the 6 turns before the real user message count as estimated turns of `review-spec`.

### Built-in commands and ambiguous spans

- **Given** a user message `/compact`, and a later assistant message that calls two skills
- **When** a refresh runs
- **Then** `/compact` adds no skill call
- **And** the span after the two calls has the skill "(ambiguous)".

### User message times

- **Given** a session with 3 real user messages, 2 user messages with only tool results, and a sub-agent whose transcript has a task prompt
- **When** a refresh runs
- **Then** the index stores the times of the 3 real user messages, with no text
- **And** the sub-agent's task prompt adds no user message time.

### Sub-agent file read before its parent

- **Given** a refresh that reads a sub-agent transcript of a skill, and a later refresh that reads the new lines of the parent session that hold the skill call
- **When** the second refresh ends
- **Then** the turns of the sub-agent count as exact turns of the skill.

### A missing source

- **Given** a config folder with no `projects/` folder, no **Transcript archive** and no capture file
- **When** a refresh runs
- **Then** the refresh ends with the state "idle" and 0 files
- **And** the log names each missing source.

### An unreadable file

- **Given** an archive file that the API cannot read
- **When** a refresh runs
- **Then** the ingest skips that file, logs its path and counts it, and reads all other files.

### Limit readings

- **Given** a capture file with **Limit readings** for two 5-hour windows and one 7-day window
- **When** a refresh runs and the Usage view asks for the limit history
- **Then** the API returns the peak used percentage of each past window and the latest reading with its time.

### No limit readings

- **Given** no capture file
- **When** the Usage view asks for the limit history
- **Then** the API returns no windows and no latest reading, and the refresh does not fail.

### List-price estimate

- **Given** a price table row for a synthetic model with an input rate, an output rate and fast-mode rates, and turns with input, output, cache writes for both TTLs, cache reads, web searches and one fast-mode turn
- **When** the API returns usage for the list-price estimate
- **Then** each amount follows the rules of section "Price table and estimate"
- **And** the fast-mode turn shows in its own model row, for example `claude-opus-5-5 (fast)`.

### A price fix changes the history

- **Given** a refresh that read turns, and a later change to the input rate in the price table
- **When** the API restarts and returns usage
- **Then** all estimates use the new rate, with no reindex.

### Unknown model

- **Given** 3 turns of a model that no price table row matches
- **When** the API returns usage
- **Then** the turns count for tokens and turns, they have no estimate, and the response lists "3 turns unpriced" for that model.

### Refresh on start, daily and on demand

- **Given** a running API
- **When** the API starts, when 24 hours pass since the last refresh, or when the Usage view sends a refresh request
- **Then** a refresh runs, and only one refresh runs at a time.

### A refresh while a refresh runs

- **Given** a refresh that runs
- **When** the Usage view sends a refresh request, the daily timer fires, or the Operator runs `pnpm reindex`
- **Then** the refresh request returns the run in progress, the timer skips, and `pnpm reindex` stops with the message that a refresh is running.

### Refresh progress

- **Given** a first refresh over 3,100 files
- **When** the Usage view asks for the refresh status
- **Then** the API returns the state "running", the count of files read and the total, for example 1,240 of 3,100
- **And** after the refresh, the API returns the state "idle" and the "data as of" time.

### A failed refresh

- **Given** a refresh that stops because the database is not available
- **When** the Usage view asks for the refresh status
- **Then** the API returns the state "failed" with a short reason and no record content
- **And** the "data as of" time stays at the last good refresh.

### Rebuild the index

- **When** the Operator runs `pnpm reindex`
- **Then** the command deletes the **Usage index** data, reads all sources again and shows the counts of files and turns.

### Config folder

- **Given** no config folder variable
- **When** the API starts
- **Then** it reads from `~/.claude-bebopaloo`
- **And** when the variable points to `~/.claude`, the API stops at start-up with a message that names the variable.

### A request with a foreign Host header

- **Given** a running API
- **When** a request arrives with the `Host` header `evil.example`
- **Then** the API rejects it with status 421 and does not run the route.

### An invalid query

- **Given** a running API
- **When** a request has an unknown time zone, a `from` date after its `to` date, or a range of more than 3,700 buckets
- **Then** the API rejects it with status 400.

### A refresh request from a foreign page

- **Given** a running API
- **When** a refresh request arrives with an `Origin` header that is not in the allow-list
- **Then** the API rejects it with status 403 and no refresh starts.

### Local runtime

- **When** the Operator runs `pnpm local:up`
- **Then** the stack builds and starts the web app and the API on `http://127.0.0.1:47100`, with Postgres on a named volume and no published database port
- **And** the config folder and the Foreman data folder are mounted read-only
- **And** when the Foreman data folder does not exist, the command creates it with mode `0700` first.

The Operator checks this scenario by hand. All other scenarios are automated tests.

### Scheduled price check

- **Given** the weekly price check workflow
- **When** the public pricing page has a rate that differs from the price table, has a model that the table does not have, or cannot be parsed
- **Then** the workflow opens one issue that names the differences
- **And** when an open price check issue exists, the workflow adds a comment to it and does not open a second issue.

## Design

### Components

| Module | Does |
|---|---|
| `packages/db` schema | The **Usage index** tables (below) |
| `apps/api/src/usage/sources` | Finds the files of the three sources and reads new lines from each |
| `apps/api/src/usage/parse` | Maps one transcript line to a turn, a skill call, a user message time or nothing |
| `apps/api/src/usage/projects` | Maps a working folder to a **Project** key and label |
| `apps/api/src/usage/skills` | **Skill attribution** for each turn |
| `apps/api/src/usage/ingest` | One refresh: the sources, the parse, the attribution and the writes, under one lock |
| `apps/api/src/usage/refresh` | The refresh schedule and the refresh state |
| `apps/api/src/usage/prices` | Loads the price table and calculates the **List-price estimate** |
| `apps/api/src/routes/usage.ts` | The usage API |
| `apps/api/src/host-check.ts` | The `Host` and `Origin` checks |
| `apps/api/src/reindex.ts` | The `pnpm reindex` command |
| `packages/shared` | The Zod schemas of the usage API |
| `data/price-table.json` | The price table |
| `scripts/price-check.ts` and `.github/workflows/price-check.yml` | The scheduled price check |
| `compose.local.yaml` | The local runtime stack |

### Configuration

| Variable | Default | Use |
|---|---|---|
| `FOREMAN_CLAUDE_DIR` | `~/.claude-bebopaloo` | The config folder. Foreman reads `projects/**` in it. A value that resolves to `~/.claude` stops the API at start-up. |
| `FOREMAN_DATA_DIR` | `~/.foreman` | The Foreman data folder. It holds `archive/` and `limit-readings.jsonl`. |
| `PORT` | `47130` | The API port |
| `CORS_ORIGINS` | `http://127.0.0.1:47173` | The allow-list of origins |

Foreman does not use `CLAUDE_CONFIG_DIR`, because that variable changes Claude Code itself when a shell exports it.

### The source contract

The factory items F2 and F3 write the archive and the capture file. They follow this contract. Foreman only reads it.

- **Live transcripts:** `<FOREMAN_CLAUDE_DIR>/projects/<project folder>/<session id>.jsonl`, and the sub-agent transcripts and their meta files below `<session id>/`, as Claude Code writes them.
- **Transcript archive:** `<FOREMAN_DATA_DIR>/archive/` has the same tree as `projects/`. Each file is gzip-compressed and has the added suffix `.gz`. A meta file is also compressed. The folder has mode `0700` and each file has mode `0600`.
- **Capture file:** `<FOREMAN_DATA_DIR>/limit-readings.jsonl`. Each line is one JSON object with `time` (ISO 8601), `session_id` and `rate_limits` as the statusline payload gives it: `five_hour` and `seven_day`, each with `used_percentage` and `resets_at`.

### Transcript fields that Foreman uses

The parser uses only these fields of the public transcript format. It ignores all other fields and never stores text.

| Value | Field |
|---|---|
| Record kind | `type` (`assistant` or `user`) |
| Session ID, time, working folder, branch | `sessionId`, `timestamp`, `cwd`, `gitBranch` |
| Turn key | `message.id` of an assistant record |
| Model | `message.model`. A record with the model `<synthetic>` is not a turn. |
| Token counts | `message.usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, and `cache_creation.ephemeral_5m_input_tokens` and `cache_creation.ephemeral_1h_input_tokens` |
| Web searches | `message.usage.server_tool_use.web_search_requests` |
| Speed and tier flags | `message.usage.speed` and `message.usage.service_tier` |
| Skill call | an assistant `tool_use` block with the name `Skill`; Foreman keeps only its tool call ID and the skill name from its input |
| Sub-agent start | an assistant `tool_use` block that starts an agent; Foreman keeps only its tool call ID |
| Slash command | the command name in a user record (`<command-name>`) |
| Real user message | a user record in the main session file that is not marked as meta and that has content other than `tool_result` blocks. A user record in a sub-agent transcript is never a real user message. |

### Ingest rules

- A **Turn** is an assistant record that has `message.usage` and a model that is not `<synthetic>`.
- The turn key is `message.id`. When several lines share a key, the turn keeps the largest value of each token count. A turn that is in the live folder and in the archive counts once. The turn belongs to the session in the record's own `sessionId`, not to the file that the ingest read it from.
- An assistant record with usage and no `message.id` is malformed.
- The ingest keeps a cursor for each file: the path, the size, the modification time, the byte offset of the last complete line, and a SHA-256 hash of the first 4 KiB and of the 4 KiB before the offset.
- On a refresh, a plain file with the same hashes is read from its offset. A file that is smaller than its offset, or whose hashes differ, is read again from the start. A compressed archive file is read in full when its size or time changed.
- A re-read writes turns by their key, so a turn never counts twice. A re-read never deletes a turn, because the history must survive a deleted transcript.
- The ingest skips a last line with no line end, and does not move the offset past it. It skips a line that is not valid JSON or that does not match the parser schema, and counts it.
- A missing source is empty. The ingest logs its path, and the refresh does not fail.
- The ingest skips a file that it cannot read. It logs the path, counts the file in the refresh result, and reads the other files.
- The log has file paths and counts only. It never has a field value from a record.
- The ingest runs under a Postgres advisory lock. While a refresh holds the lock, `POST /refresh` returns the run in progress, the daily timer skips, and `pnpm reindex` stops with the message that a refresh is running.
- A refresh has two steps. First it reads the new lines of all files. Then it runs the **Skill attribution** again for each session that got new rows, from the stored rows. The order in which the ingest reads the files does not change the result.

### Project rules

- When the working folder exists and git can read it, the key is the main checkout from git (the folder above the common git folder). A subfolder resolves to its repo root.
- When the folder does not exist, or git cannot read it, the path rules apply with no git call:
  - a path with a `.claude/worktrees/<name>` or `.worktrees/<name>` part maps to the path before that part;
  - a path below another known Project key maps to the longest such key.
- In the local runtime stack the repo folders are not mounted, so the path rules always apply there.
- A session that is outside a repo gets its folder path as the key and "(no repo)" in its label.
- The label is the folder name of the key. When two keys have the same folder name, the label adds the name of the parent folder, for example `app (a)`.
- The API identifies a Project by a Project ID: the first 12 hex characters of the SHA-256 of the key. A path never goes into a URL.

### Agent type rules

- A turn in the main session file has the **Agent type** "main".
- A turn in a sub-agent transcript gets the agent type from the meta file next to it. With no meta file, it gets "sub-agent (unknown)".

### Skill attribution rules

- A skill call is a `Skill` tool call, or a slash command that is not a built-in command. One module holds the list of built-in commands, for example `/clear`, `/model` and `/compact`.
- The skill name is the name with no leading `/`, and keeps a plugin prefix, for example `factory-core:to-code`.
- **Exact:** the count of calls of each skill.
- **Exact:** the turns of a sub-agent are turns of skill S when the tool call that started the sub-agent is the call of S, is in a span of S, or is in a sub-agent whose turns belong to S. The meta file gives the tool call ID.
- **Estimate:** a span starts after a skill call and ends at the next real user message. The turns of the main conversation in the span are estimated turns of the skill. A later skill call in the span starts a new span.
- When one message calls two or more skills, the span gets the skill "(ambiguous)".
- Each turn stores the skill name, or none, and the basis: exact or estimate.

### Usage index (Postgres)

All times are `timestamp with time zone`, in UTC. The index stores no prompt, reply, tool input or tool output.

| Table | Columns |
|---|---|
| `turns` | turn key (primary key), session ID, agent ID, time, model, speed flag, service tier, input tokens, output tokens, cache write 5m tokens, cache write 1h tokens, cache read tokens, web search count, Project key, branch, **Agent type**, skill name, skill basis |
| `skill_calls` | tool call or record ID (primary key), session ID, ID of the calling agent (none for the main conversation), time, skill name, Project key |
| `agents` | agent ID (primary key), session ID, **Agent type**, ID of the tool call that started it |
| `agent_starts` | tool call ID (primary key), session ID, ID of the calling agent (none for the main conversation), time |
| `user_messages` | record ID (primary key), session ID, time, Project key, branch |
| `limit_readings` | session ID, time, **Limit window**, used percentage, reset time; key: session ID, time and window |
| `ingest_files` | path (primary key), source, size, modification time, offset, hashes, last read time |
| `refresh_runs` | ID, start time, end time, state, files total, files read, turns added, short failure reason |

There are indexes on the turn time, the Project key and the session ID.

### Price table and estimate

- `data/price-table.json` has one row for each model ID or ID prefix: the input rate and the output rate in USD for each 1 million tokens, the fast-mode input and output rates when the model has them, the source URL and an `as_of` date. A `rules` block holds the cache write multiplier for the 5-minute TTL and for the 1-hour TTL, the cache read multiplier, the batch discount and the web search charge for each 1,000 searches, with their source URL and `as_of` date.
- The API validates the file with Zod at start-up and stops when it is invalid.
- A model matches the row with the same ID, else the row with the longest matching prefix. Prices have no date ranges.
- The estimate of one turn is: input × input rate, plus output × output rate, plus each cache write × input rate × its TTL multiplier, plus cache reads × input rate × the cache read multiplier, plus the web search charge. A fast-mode turn uses the fast-mode rates. A turn with the batch service tier gets the batch discount on its token amounts. When a turn has cache writes with no TTL split, the 5-minute multiplier applies.
- A turn is unpriced when no row matches its model, or when it is a fast-mode turn and the row has no fast-mode rates.
- Foreman calculates the estimate when it reads. It never stores an estimate. A change to the price table changes all of the history after the API restarts.
- Each response with an estimate carries the note: "List-price estimate: what this usage costs at the public API prices. It is not what your subscription charges."
- The Operator fills the first rows from the public pricing page, with its URL in each row.

### Usage API

All routes are below `/api/usage`, and their schemas are in `packages/shared`. Query schemas use `.strict()`.

Common query values:

- `from` and `to`: dates `YYYY-MM-DD`, both included.
- `tz`: an IANA time zone name from the browser. All grouping by day, week or month uses this zone. Weeks start on Monday.
- `project`: an optional Project ID.

| Route | Returns |
|---|---|
| `GET /status` | The refresh state (`idle`, `running` or `failed`), files read and files total during a run, the "data as of" time, and a short failure reason |
| `POST /refresh` | Starts a refresh, or returns the run that is in progress. Status 202. |
| `GET /projects` | Each Project: ID, label, "no repo" flag, first and last turn time. `limit` has a default of 500 and a maximum of 1,000. |
| `GET /breakdown` | Rows for one `dimension` (`project`, `model`, `agentType`, `skill`, `branch` or `session`), sorted by total tokens. The key of a model row is the model and the speed flag, so a fast-mode row shows as, for example, `claude-opus-5-5 (fast)`. The label of a session row is its Project label, and the row also has the first and last turn time of the session. Each row has the key, the label, the input, output, cache write and cache read tokens, the turns, the estimate and the unpriced turns. Skill rows also have the calls, the exact turns and the estimated turns. The response has a totals row over all rows, the row count, and the list of unpriced models with their turn counts. `limit` has a default of 100 and a maximum of 500. |
| `GET /series` | One bucket for each `grain` (`day`, `week` or `month`) from `from` to `to`, each with the token counts, the turns and the estimate. Empty buckets are in the list with zeros. A range of more than 3,700 buckets gets status 400. |
| `GET /limits` | For each **Limit window**: the past windows whose reset time is between `from` and `to`, each with its reset time and its peak used percentage; and the latest reading with its time. Readings group by window and by reset time to the minute. |

An unknown `tz`, a `from` date after the `to` date, or an unknown Project ID gets status 400.

The capture file parser accepts `resets_at` as epoch seconds or as ISO 8601. It skips a line with no `rate_limits` and does not count it as malformed, because the statusline has no limits before the first API response of a session.

The Usage view derives the activity calendar, the cache efficiency and the month outlook from `/series` and `/breakdown`. No route returns transcript text.

### Access and security

- The API binds to `127.0.0.1` in development. In the local runtime stack, the container listens on its own network and the host port binds to `127.0.0.1` only.
- A global `onRequest` hook rejects a request whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]`, with any port, with status 421. This blocks DNS rebinding. The hook covers all routes, the health route included.
- `POST /refresh` rejects a request with an `Origin` header that is not in `CORS_ORIGINS`, with status 403.
- Foreman has no sign-in: the Operator is the only user and the loopback bind and the `Host` check are its access control. The usage routes are marked `public: true` for this reason.
- Foreman makes no outbound HTTP calls. Only the CI workflow fetches the pricing page.

### Refresh

- The API starts a refresh when it starts, then each 24 hours while it runs, and on `POST /refresh`.
- The refresh runs in the API process, in the background. A request never waits for it.
- The "data as of" time is the end time of the last refresh that did not fail.

### Commands and ports

| Command | Does |
|---|---|
| `pnpm reindex` | Deletes the **Usage index** data and reads all sources again, against `DATABASE_URL` |
| `pnpm local:up` | Builds the local runtime stack and starts it again |
| `pnpm local:reindex` | Runs the reindex in the local runtime stack |

| Use | Port |
|---|---|
| Local runtime (web and API on one origin) | 47100 |
| Dev API | 47130 |
| Dev web server | 47173 |
| Preview default | 47180 |
| Dev database | 55432 (no change) |

The README, `vite.config.ts`, `config.ts`, `compose.preview.yaml` and the e2e config change to these ports.

### Local runtime stack

`compose.local.yaml` with the project name `foreman` runs Postgres, a migrate step, the API and the web server (Caddy), with `restart: unless-stopped`. A named volume holds the database, and the database port is not published. The stack mounts `FOREMAN_CLAUDE_DIR` and `FOREMAN_DATA_DIR` read-only. Only the web port 47100 is published, on `127.0.0.1`.

- `pnpm local:up` creates `FOREMAN_DATA_DIR` with mode `0700` when it does not exist, before Docker starts. Without this step, Docker creates the folder with the wrong mode.
- The stack sets `CORS_ORIGINS` to `http://127.0.0.1:47100` and `http://localhost:47100`.
- The API container must read archive files of mode `0600` through the mount. The runtime issue tests this on the Operator's Mac with a synthetic archive file.

### Scheduled price check

> **Caution:** The workflow is a CI change, so it is outside the Unattended envelope. The Operator builds or approves the workflow issue.

- `scripts/price-check.ts` fetches each distinct source URL in the price table, parses the rates, and compares them with the table. It has a timeout and validates what it parses.
- `.github/workflows/price-check.yml` runs the script each week and on manual start, with `contents: read` and `issues: write` permissions only.
- When the rates differ, when the page has a model that the table does not have, or when the script cannot parse the page, the workflow opens an issue with the label `price-check`. When an open issue with that label exists, it adds a comment instead. The workflow issue also creates the `price-check` label.
- The parser has unit tests with a small synthetic HTML fixture.

## Gating and rollout

- **Gating:** not required. Foreman has no users other than the Operator yet, the Usage index and the usage API are new, and no other component reads them. The port change affects only the Operator's local development.
- **Rollout:** each issue merges to the main branch on its own (Incremental). The Usage view (Spec B) builds on the API after it merges. The Operator runs `pnpm local:up` when the runtime stack issue merges, and real data shows after F2 and F3 exist. To undo, stop the stack and revert the change. `pnpm reindex` rebuilds the index at any time, so a schema change needs no data migration.
- **Field check:** before the Operator merges the parser PR at G3, the Operator compares the fields in its synthetic fixture with one of the Operator's own transcripts, on this machine. No real transcript goes into the repo or the PR.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The **Usage index** holds folder paths, which contain the user name of the machine, branch names, skill names, session IDs and the times of the Operator's own messages. It holds no prompt, reply or tool data.
- All data stays on this machine. The **Transcript archive** holds full transcript text, so its file modes are set by F2. Foreman mounts it read-only and never copies text out of it.

## Out of scope

- The Usage view and all UI (Spec B).
- The archive hook, the capture script, the capture setup skill and the statusline spike (factory items F1 to F4). This Spec only sets the contract that they follow.
- A command that deletes archive files older than a date. It belongs with the archive hook (F2), because Foreman never writes the archive.
- The Engagement ledger and Factory health views. The index only keeps the user message times that the ledger needs.
- Long-context rates for prompts above the long-context threshold. The estimate uses the base rates.
- An estimate stored in the database, and date ranges for prices.

## Risks

- **The transcript format is not a stable public API.** A field change can stop the parse. The parser counts skipped lines, so a drop in turns shows in the logs and in the refresh result.
- **The path rules can map a worktree to the wrong Project** when a worktree is in a place that the rules do not know. `pnpm reindex` fixes the index after a rule change.
- **Skill attribution for turns of the main conversation is an estimate.** The API keeps exact turns and estimated turns apart, and the Usage view labels the estimate.

## Open questions

- None.
