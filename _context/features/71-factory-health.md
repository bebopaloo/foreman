# Factory health

**Status:** Approved
**Work items:** #71

Source: factory ADR 0007 (Factory health: plugin versions, Repo rule drift, unattended run history, stopped items), foreman ADR 0003, the last step of the build order. It builds on the approved Specs [`23-forge-and-tracker-connection.md`](23-forge-and-tracker-connection.md) and [`24-foreman-dash.md`](24-foreman-dash.md), and on the forge file step of the Controls view Spec ([`67-controls-view.md`](67-controls-view.md)), which owns the read of `.claude/factory.json`. Layout reference: the Claude artifact "Foreman dash prototype", tab "Factory health". Where the prototype and this Spec differ, this Spec is the master copy.

## Problem

The Operator runs the **Factory** on several repos for several clients. Three facts about the factory itself are hard to see today:

- **Plugin versions.** The Operator does not see which **Factory plugins** are older than the version in the **Marketplace**, unless the Operator opens the plugin menu of Claude Code.
- **Rule drift.** `context-init` writes each **Repo rule** from a **Rule template**, and the team owns the copy after that. A template changes in a later plugin version, and a team can edit its copy. Nothing shows which repos have rules that differ from the templates, or why.
- **Unattended runs.** The **Foreman dash** shows only the last run. The Operator cannot compare the runs of the last weeks, or see which items a stopped run left and whether a later run resumed them.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator opens Factory health to decide when to update a plugin, which repos need a rule update, and whether the runs work.
- **Stakeholders and auditors of one client**: they see the view only in a screen share by the Operator, in that client's **Client scope**.

## Acceptance criteria

Fixtures are synthetic: a synthetic config folder with `installed_plugins.json`, `known_marketplaces.json`, a Marketplace copy, a plugin cache with Rule templates, a night log and a run lock, and a synthetic forge adapter (Spec 23) that returns `repo` and `file get` output and the errors of factory PR #120. No real plugin file, rule file, repo or log goes into the repo.

### The Factory health view

- **When** the Operator opens `/health`
- **Then** Foreman shows the sections Plugin versions, Rule drift and Unattended runs, in that order
- **And** the header shows the Client scope, the connection state and the Refresh button of Spec 23
- **And** the header nav has the link "Factory health".

### An update is available

- **Given** user-scope installs `factory-core@demo-market` at version `0.30.0` and `stack-ts@demo-market` at version `0.10.0`, and a Marketplace copy whose `plugin.json` files give `0.37.5` and `0.10.0`
- **When** the view loads
- **Then** Plugin versions shows `factory-core` with "0.37.5 available" and `stack-ts` with "current"
- **And** the section shows "Marketplace copy `demo-market` as of" the `lastUpdated` time, and "Foreman makes no network call. A version that is newer than this copy does not show."

### The version in the Marketplace entry

- **Given** a Marketplace entry for `factory-github` with `version` `0.12.0`, and a `plugin.json` in its source folder with `0.11.0`
- **When** the view loads
- **Then** the Marketplace version of `factory-github` is `0.12.0`.

### An install newer than the Marketplace copy

- **Given** an install of `factory-github` at `0.12.0`, and a Marketplace copy that gives `0.8.0`
- **When** the view loads
- **Then** the row shows "newer than the Marketplace copy".

### Versions that are not SemVer

- **Given** an install at version `abc1234` and a Marketplace version `abc1234`, and a second install at `abc1234` with a Marketplace version `def5678`
- **When** the view loads
- **Then** the first row shows "current" and the second row shows "differs from the Marketplace copy".

### A Marketplace in a local folder

- **Given** a Marketplace with the source kind `directory` and the `installLocation` `/home/operator/demo-factory`, and no `FOREMAN_MARKETPLACE_DIR` value
- **When** the view loads
- **Then** each plugin of that Marketplace shows its installed version and "Marketplace not readable by Foreman: set `FOREMAN_MARKETPLACE_DIR`"
- **And** with `FOREMAN_MARKETPLACE_DIR` set to `/home/operator/demo-factory`, the rows show the versions from that folder, with the note "a local folder: Foreman reads its files as they are now".

### A plugin source outside the Marketplace

- **Given** a Marketplace entry whose `source` is `../../outside`, an absolute path, or an object source with a git URL
- **When** the view loads
- **Then** Foreman reads no file outside the Marketplace folder
- **And** the row shows "version not in the local Marketplace copy".

### A plugin or Marketplace that is not known

- **Given** an install key `factory-extra@demo-market` whose name is not in the Marketplace, and an install key `tool@other-market` with no entry in `known_marketplaces.json`
- **When** the view loads
- **Then** the rows show "not in the Marketplace" and "Marketplace not known".

### Installs in other scopes

- **Given** a key `stack-ts@demo-market` with one user-scope entry and two entries with the scope `project`
- **When** the view loads
- **Then** the row compares the user-scope entry, and shows "2 installs in other scopes, not compared".

### No plugin files

- **Given** a config folder with no `installed_plugins.json`, or a file that is not valid JSON
- **When** the view loads
- **Then** Plugin versions shows "No plugin data: `installed_plugins.json` is missing or not readable"
- **And** Rule drift and Unattended runs still show.

### Plugin versions in a client scope

- **Given** the scope `acme`
- **When** the view loads
- **Then** Plugin versions shows the same rows as in "All", with the note "The whole factory: the same in every scope"
- **And** a request to `/api/factory-health/plugins` with `client=acme` gets status 400.

### Rules that match the templates

- **Given** a connected repo whose `.claude/factory.json` at its default branch has `rules` `["coding", "typescript"]`, `compliance` `["gdpr"]` and the Stack pack `stack-ts`, and rule files at that branch that equal the stamped templates of the installed `factory-core` and `stack-ts`
- **When** the view loads
- **Then** Rule drift shows the repo with "3 Repo rules match the templates"
- **And** each rule shows "current".

### An older stamp with the same text

- **Given** a rule file `coding.md` whose stamp line names `factory-core 0.8.1`, an installed `factory-core` `0.30.0`, and a file text below the stamp line that equals the installed template
- **When** the view loads
- **Then** the rule shows "current, stamp 0.8.1".

### A rule behind the template

- **Given** a rule file `security.md` with the stamp `factory-core 0.8.1`, whose text differs from the installed `0.30.0` template and equals the `0.8.1` template in the plugin cache
- **When** the view loads
- **Then** the rule shows "behind: the template changed after 0.8.1"
- **And** the repo shows "1 Repo rule behind factory-core 0.30.0".

### A rule that the team edited

- **Given** a rule file `testing.md` with the stamp `factory-core 0.8.1`, whose text differs from the installed template and from the `0.8.1` template in the plugin cache
- **When** the view loads
- **Then** the rule shows "edited by the team".

### No template at the stamp version

- **Given** a rule file with the stamp `stack-ts 0.6.0` whose text differs from the installed template, and no `0.6.0` folder in the plugin cache
- **When** the view loads
- **Then** the rule shows "differs from the template. Foreman cannot tell a team edit from a template change."

### A rule with no stamp

- **Given** a rule file `coding.md` with no stamp line, or with a stamp line that names the template `security`
- **When** the view loads
- **Then** Foreman compares the whole file text with the installed template
- **And** the rule shows "current, no stamp" when the texts are equal, else "differs from the template".

### A stamp after the front matter

- **Given** a rule file `react.md` that starts with a front matter block from `---` to `---`, then the stamp line, and the template `react.md` that starts with the same front matter
- **When** the view loads
- **Then** Foreman finds the stamp line after the front matter, and compares the text without it.

### A listed rule that is missing

- **Given** a factory config at `main` that lists `fastify-api`, and a `file get .claude/rules/fastify-api.md --ref main` that fails with exit code 1 and the error `{"error": "file not found: .claude/rules/fastify-api.md at main"}`
- **When** a fetch runs and the view loads
- **Then** the rule shows "missing at `main`".

### A rule with no template

- **Given** a factory config that lists the rule `python`, with no installed template of that name, and the Stack pack `stack-py`, which is not installed
- **When** the view loads
- **Then** the rule shows "no template in the installed plugins"
- **And** the repo shows "Stack pack `stack-py` is not installed".

### A template name in two plugins

- **Given** a template `testing.md` in the installed `factory-core` and in the installed Stack pack
- **When** the view loads
- **Then** the rule `testing` shows "template name not unique".

### A repo with no factory config

- **Given** a connected repo with the default branch `main`, where `file get .claude/factory.json --ref main` fails with the error `file not found: .claude/factory.json at main`
- **When** a fetch runs and the view loads
- **Then** the repo shows "not set up: no `.claude/factory.json` at `main`", and no rule file is read.

### A factory config that is not valid

- **Given** a `.claude/factory.json` that is not valid JSON, or whose `rules` is not a list of names
- **When** a fetch runs
- **Then** the repo shows "factory config not readable", and the fetch reads no rule file for it
- **And** the cache keeps the rule rows of the last valid read.

### The default branch and the main branch differ

- **Given** a repo whose `repo` output has the `default_branch` `trunk`, and a factory config at `trunk` with `main_branch` `main`
- **When** a fetch runs and the view loads
- **Then** Foreman reads the config at `trunk` and the rules at `main`, as the Controls view Spec reads the other forge files
- **And** the repo shows "the main branch in the factory config is `main`, the default branch is `trunk`".

### A rule leaves the list

- **Given** cached rows for the rules `coding` and `react`, and a new factory config that lists only `coding`
- **When** a fetch runs
- **Then** the cache has no row for `react`.

### A plugin update changes a template

- **Given** cached rule files, and a plugin update that changes the installed template `coding.md`
- **When** the view loads, with no fetch between
- **Then** the rule `coding` shows the state from the new template.

### The fetch reads the rule files

- **Given** an empty cache and one connected repo with the default branch `main`, whose factory config has no `controls` key and lists 2 rules and 1 Compliance template
- **When** the first fetch runs
- **Then** the forge adapter gets `repo`, `file get .claude/factory.json --ref main`, and `file get .claude/rules/<name>.md --ref main` once for each of the 3 names
- **And** the cache holds no file text: only the sha, the size, the stamp values and the hash of each rule file
- **And** a later timer fetch less than 60 minutes after the last forge file step runs no `file get`, by the timing of the Controls view Spec.

### A path that is not allowed

- **Given** a code path that asks the runner for `file get .claude/rules/coding.md --ref main`, `file get .env --ref main`, `file get .claude/rules/../settings.json --ref main`, `file get .claude/rules/Coding.md --ref main` or `file get .claude/rules/coding.md --ref --upload-pack`
- **When** the runner gets the request
- **Then** it accepts the first command
- **And** it refuses the other four, and no subprocess starts for them.

### A large or invalid rule file

- **Given** a `file get` result with a `size` above 1,048,576 bytes, a result that fails the contract shape, and an error that is not a missing file or a missing ref, each for one rule file with an earlier hash in the cache
- **When** a fetch runs and the view loads
- **Then** the three rules show "file too large", "invalid adapter output" and "adapter error", by the file rules of the Controls view Spec
- **And** no rule shows a drift state from its earlier hash.

### Rule drift in a client scope

- **Given** 4 connected repos, 2 of the client `acme`
- **When** the view loads with the scope `acme`
- **Then** Rule drift shows only the 2 `acme` repos.

### Some repos not connected

- **Given** 3 repos in scope, of which 1 has no token
- **When** the view loads
- **Then** Rule drift shows the 2 connected repos, and "Data is not complete: 1 repo not connected. See Repos."
- **And** the third repo shows "not connected: no token".

### Not connected

- **Given** no token for any repo in scope
- **When** the view loads
- **Then** Rule drift shows "Not connected. Add the Foreman token to FOREMAN_TOKENS_JSON in the .env file, then restart pnpm dev."
- **And** Plugin versions and Unattended runs show the local data.

### A failed fetch

- **Given** cached rule data from a fetch 2 hours ago, and a later fetch where the forge adapter fails with `rate_limit`
- **When** the view loads
- **Then** Rule drift shows the cached data with its "data as of" time and "rate limit".

### Unattended runs

- **Given** night log lines in the last 30 days of three runs: run B on 2026-11-12 from 01:00 to 03:12 UTC with 3 builds; run A on 2026-11-13 from 01:00 to 05:41 UTC with 8 builds, of which 6 merged, and at most 4 at one time; and run C on 2026-11-14 from 01:00 to 06:58 UTC with 10 builds and at most 5 at one time
- **When** the view loads with the scope "All", in a browser with the time zone UTC
- **Then** Unattended runs shows C, A and B, newest first
- **And** the row of A shows the night "2026-11-13", the window "01:00–05:41", "8 builds: 6 merged" with the counts of the other results, and "peak 4 of 5".

### Stopped items

- **Given** run A, which ends with issue 12 of `acme/app` in IN PROGRESS and issue 14 in IN REVIEW with no end line, and a later run B with a line for issue 12
- **When** the view loads
- **Then** the row of A shows "2 stopped items"
- **And** the list shows `acme/app #12` "resumed by the run of" the night of B, and `acme/app #14` "not resumed yet".

### A run in progress

- **Given** a run lock that holds the `run_id` of the newest run, with a heartbeat 4 minutes ago, and 3 builds of that run with no end line
- **When** the view loads
- **Then** the row of that run shows "in progress", with the window to now
- **And** its 3 builds show as "running", and the row has no stopped items.

### Runs in a client scope

- **Given** a run with 3 builds of `acme` and 2 builds of `globex` that run at one time, and a newer run with builds of `globex` only
- **When** the view loads with the scope `acme`
- **Then** Unattended runs shows only the first run, with "3 builds" and "peak 3 at one time" and no count of the 5 slots
- **And** its window runs from the first to the last `acme` line.

### Two runs in one night

- **Given** two runs with different `run_id` values whose lines start on the same night
- **When** the view loads
- **Then** Unattended runs shows two rows with the same night.

### A run that crosses midnight UTC

- **Given** one run with lines in `runs/2026-11-13.jsonl` and in `runs/2026-11-14.jsonl`
- **When** the view loads
- **Then** Unattended runs shows one row for that run, with one window.

### Skips and blocked at selection

- **Given** a run with 9 lines from READY to READY and 1 line for issue 15 from READY to BLOCKED with no earlier line for it
- **When** the view loads
- **Then** the row shows "9 skips" and "1 blocked at selection"
- **And** neither counts in the builds or in the peak.

### No run

- **Given** no night log line in the last 30 days in scope
- **When** the view loads
- **Then** Unattended runs shows "No run in the last 30 days".

### Many runs

- **Given** 45 runs in the last 30 days
- **When** the web app asks for the runs with no `limit`
- **Then** the API returns the 30 newest runs and a cursor
- **And** the request with that cursor returns the other 15.

### Malformed and missing night log data

- **Given** the fixture of the Spec 24 scenario "A malformed line", and then no `runs/` folder, and then a `runs/` folder that the API cannot read
- **When** the view loads
- **Then** Unattended runs uses the valid lines and shows the count of skipped lines
- **And** it shows no row and no error with no folder, and "cannot read the factory folder" with a folder that it cannot read.

### Text stays plain text

- **Given** a plugin name, a Marketplace version and an issue title that hold HTML and Markdown
- **When** the view shows them
- **Then** the page shows the text as it is, with no markup and no request to another host
- **And** a version that is longer than 64 characters or holds a character outside `0-9 A-Z a-z . + -` shows "version not readable".

### No local paths in a response

- **Given** install folders, Marketplace folders and night log repo folders below `/home/operator`
- **When** the web app asks for the three Factory health routes
- **Then** no response holds a path below `/home/operator`. A repo outside the repo list shows by the last part of its folder path, as in Spec 24.

### Live update

- **Given** the view is open in a visible tab
- **When** 60 seconds pass
- **Then** the web app asks for the three Factory health routes again
- **And** while the tab is hidden, it does not ask.

### Logs

- **Given** a fetch that reads rule files, and a view request that reads the plugin files
- **When** they end
- **Then** the log has the repo IDs, the command names, the file names, the counts and the error classes
- **And** it has no file text, no hash, no token and no local path below the home folder.

### Accessibility

- **Given** each fixture set of the scenarios "An update is available", "A Marketplace in a local folder", "No plugin files", "Rules that match the templates", "A rule behind the template", "Some repos not connected", "Not connected", "Stopped items", "A run in progress" and "No run"
- **When** the end-to-end test opens `/health` with each set, in the light theme and in the dark theme
- **Then** the axe scan finds no WCAG 2.2 AA violation
- **And** at a width of 375 pixels the page has no horizontal page scroll
- **And** each plugin state, rule state and build result has a text label as well as a colour.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/factory-health/plugins` | Reads `installed_plugins.json`, `known_marketplaces.json` and the Marketplace copies, and compares the versions |
| `apps/api/src/factory-health/templates` | Finds the Rule templates of the installed plugins and of the cached plugin versions, and hashes them |
| `apps/api/src/factory-health/rule-drift` | Compares the cached rule files with the templates, for each repo in scope |
| `apps/api/src/factory-health/runs` | One row for each run in the last 30 days, from the night log reader and the run rules of Spec 24 |
| `apps/api/src/dash/runs` (Spec 24) | Gains the export `runsInWindow`: the builds, results, lanes and peak of every run in the window, in one scope. The dash, the Reviews view and this Spec use it. |
| `apps/api/src/work/runner` (Spec 23) | The `file get` rule of the Controls view Spec gains the path pattern `.claude/rules/<name>.md` |
| `apps/api/src/controls/files` (Controls view Spec) | The parser of `.claude/factory.json` gains the keys of this Spec; a parser for a rule file keeps only its stamp values and its text hash |
| `apps/api/src/work/fetch` (Controls view Spec) | The forge file step gains the rule files |
| `apps/api/src/work/adapters` (Spec 23) | Its rules find the install folder of a plugin; this Spec uses them for every installed plugin |
| `apps/api/src/routes/factory-health.ts` | The Factory health routes |
| `packages/shared` | The Zod schemas of the Factory health routes |
| `apps/web/src/factory-health` | The page: Plugin versions, Rule drift, Unattended runs |
| `apps/web/src/nav` (Spec 24) | Gains the link "Factory health" to `/health` |
| `e2e/factory-health.spec.ts` | The end-to-end tests with the axe scan |

The page uses the `format` and `theme` modules of the Usage view Spec, and the list conventions of the Work view Spec. This Spec adds no table: the rule files go into `work_forge_files` of the Controls view Spec.

### Configuration

| Variable | Default | Use |
|---|---|---|
| `FOREMAN_MARKETPLACE_DIR` | none | The folder of one **Marketplace** whose source kind is `directory`, for example the Operator's checkout of the factory repo. `pnpm dev` reads the folder directly. With no value, a `directory` Marketplace is "not readable by Foreman". The API stops at start-up when the value is not an absolute path. |

The variables of Specs 5, 23 and 24 do not change.

### Dependencies on the factory

This Spec only uses these. Foreman's tests use a synthetic adapter, so they do not wait for the factory.

- **`file get`.** Factory PR #120 adds `file get <path> --ref <ref>` to the GitHub Forge adapter and the Forge contract (factory ADR 0012). It returns `{"path", "ref", "sha", "size", "content"}`, with `content` as UTF-8 text of at most 1 MB. An error is exit code 1, nothing on standard output, and `{"error": "<message>"}` on standard error, with no error kind. Foreman maps the message by its fixed prefix, by the rules of the Controls view Spec: `file not found:` is a missing file, `ref not found:` is a missing ref, and any other message maps by the error table of Spec 23.
- **`repo`.** The GitHub Forge adapter has this read command today. It returns `{"host", "owner", "name", "url", "default_branch"}`. The Controls view Spec adds it to Foreman's allow-list.
- **The stamp line.** `context-init` writes the stamp line `<!-- <plugin> <version>: from Rule template <name>. The team owns this file. -->` today (`stamp` in `context_init.py`): as the first line of each Repo rule, or as the first line after its front matter. The line is part of the factory-Foreman source contract. A change to it needs a Foreman change first.

### Plugin versions

Local, read-only, on each request, with no index and no network call. All files are below `<FOREMAN_CLAUDE_DIR>/plugins/`. Foreman never reads `plugin-directory-cache-v2.json`.

- **Installs.** `installed_plugins.json` has `version` (a number) and `plugins`: an object whose keys are `<plugin>@<marketplace>`, each with a list of entries. Foreman uses the keys `scope`, `installPath`, `version` and `lastUpdated` of each entry, and ignores other keys. The row of a key compares its one entry with the scope `user`. Entries with other scopes count in "N installs in other scopes, not compared". A key with no user-scope entry shows only that count.
- **Marketplaces.** `known_marketplaces.json` is an object with one entry for each Marketplace name. Foreman uses `source.source` (the source kind), `installLocation` and `lastUpdated`.
- **The Marketplace folder.**
  - When `installLocation` has the part `plugins/marketplaces/<name>`, Foreman maps it to `<FOREMAN_CLAUDE_DIR>/plugins/marketplaces/<name>` by the part of the path below `plugins/`, as Spec 23 maps an install folder. This is the local copy that Claude Code keeps for a git Marketplace.
  - When the source kind is `directory`, Foreman reads the folder only when its real path equals the real path of `FOREMAN_MARKETPLACE_DIR`.
  - Otherwise the Marketplace is "not readable by Foreman". The real path of the folder must resolve inside the mapped or configured folder.
- **The Marketplace version.** Foreman reads `.claude-plugin/marketplace.json` in the Marketplace folder, and finds the entry in `plugins` whose `name` equals the plugin. The version is the entry's `version` when it has one. Else, when the entry's `source` is a relative path that starts with `./`, it is the `version` in `<source>/.claude-plugin/plugin.json`. The real path of that file must resolve inside the Marketplace folder. Any other `source` gives "version not in the local Marketplace copy".
- **Versions.** A version is a string of 1 to 64 characters from `0-9 A-Z a-z . + -`. Any other value is "version not readable".
- **Limits.** Each JSON file is at most 1 MB. A file that is larger, not valid JSON or fails its schema is skipped and counted.

| State | Rule |
|---|---|
| current | The two versions are equal |
| `<version>` available | Both are SemVer, and the Marketplace version has the higher precedence by SemVer 2.0.0 |
| newer than the Marketplace copy | Both are SemVer, and the installed version has the higher precedence |
| differs from the Marketplace copy | One or both are not SemVer, and the strings differ |
| not in the Marketplace | The Marketplace has no entry with that name |
| Marketplace not known | `known_marketplaces.json` has no entry with that name |
| Marketplace not readable by Foreman | No readable Marketplace folder, by the rules above |
| version not in the local Marketplace copy | The entry has no `version` and no relative `source` |
| version not readable | A file is missing or not valid, or a version fails the version rule |

- Each Marketplace shows its name, its source kind and its `lastUpdated` time, with the note "Foreman makes no network call. A version that is newer than this copy does not show." A `directory` Marketplace also has the note "a local folder: Foreman reads its files as they are now".
- Plugin versions belong to the whole factory, not to one repo. They show in every Client scope, with the note "The whole factory: the same in every scope".

### Rule templates

Local, read-only, on each request.

- The template sources of a repo are the installed `factory-core` and the installed Stack pack that the repo's factory config names in `stack_pack.name`. Foreman finds the install folder of each by the rules of Spec 23, section "Adapters": one key whose part before `@` is the plugin name, with one user-scope entry, mapped into `<FOREMAN_CLAUDE_DIR>/plugins/`.
- Engineering templates are `<install folder>/templates/rules/*.md`. Compliance templates are `<install folder>/templates/rules/compliance/*.md`. The name of a template is its file name without `.md`.
- A name in `rules` uses an engineering template. A name in `compliance` uses a Compliance template. When two sources have a template with the same name, the rule is "template name not unique", as `context-init` refuses it.
- **The template at the stamp version.** For a stamp `<plugin> <version>`, Foreman reads the same template below `<FOREMAN_CLAUDE_DIR>/plugins/cache/<marketplace>/<plugin>/<version>/templates/rules/`, where `<marketplace>` is the Marketplace of the installed key. Claude Code keeps older versions in this cache only for a time. With no such file, the state is "differs from the template" (below).
- Foreman hashes each template file with SHA-256. A template file larger than 1,048,576 bytes is skipped and counted.

### Rule files in the forge file step

The Controls view Spec owns the forge file step of a fetch: the `repo` call, the read of `.claude/factory.json` at the default branch, the timing (the first fetch of a repo, a fetch when the last forge file step is 60 minutes old or more, each full fetch, and each fetch that a refresh request starts, but not every 15-minute timer fetch), the file limits, the contract checks, the error states and the table `work_forge_files`. This Spec adds two things to that step, and changes none of its rules.

1. **The repo config keys.** The parser of `.claude/factory.json` also keeps these keys, validated with Zod: `rules` and `compliance` (lists of at most 50 names that match `^[a-z0-9][a-z0-9-]*$`), `stack_pack` (`null`, or `name` and `version`) and `factory_core_version` (a version by the version rule below). When one of them fails, the repo config record holds the rule state "factory config not readable", and the other keys of the Controls view Spec still count.
2. **The rule files.** After the repo config, `file get .claude/rules/<name>.md --ref <ref>` once for each distinct name in `rules` and `compliance`. `<ref>` is the ref at which the Controls view Spec reads its other files: the `main_branch` of the repo config when it is a valid branch name, else the default branch.

- A missing `.claude/factory.json` makes the repo "not set up". A missing ref for it makes the repo "branch not found". A repo config whose rule keys fail makes the repo "factory config not readable". In these three cases the step reads no rule file, and keeps the rule rows of the last valid read.
- For each rule file, `work_forge_files` holds a row with the path `.claude/rules/<name>.md`, by the columns of the Controls view Spec. Its parsed fields are only the kind (`rule` or `compliance`), the stamp plugin, the stamp version, the stamp name and the SHA-256 of the text without the stamp line. The row holds no file text.
- A missing rule file has the state `missing_file`, and shows "missing at `<ref>`". A missing ref shows "branch not found". The states `too_large` and `not_readable`, an invalid output and the other error classes show by the Controls view Spec: "file too large", "not readable", "invalid adapter output" and the Spec 23 text of the error class. A rule in one of these states shows that state, and never a drift state from an earlier hash.
- A valid repo config replaces the rule rows of the repo: the step deletes the row of each `.claude/rules/*.md` path whose name the config no longer lists.
- When the `sha` of a rule file equals the cached sha, the step keeps the parsed fields and sets the fetch time, by the Controls view rule "No change".

### The stamp line

Foreman reads the stamp as `context-init` writes it:

- When the text starts with `---` and a line end, and has a later line `---` with a line end, the stamp is the line right after that line. Else the stamp is the first line.
- The line matches `<!-- <plugin> <version>: from Rule template <name>. The team owns this file. -->`, where `<plugin>` matches `^[a-z0-9][a-z0-9-]*$` and `<version>` follows the version rule above.
- A stamp counts only when its `<name>` is the rule name. With no stamp that counts, Foreman hashes the whole text.
- Foreman compares text as it is, with no change of line ends or spaces, as `context-init` does.

### Rule drift

For each rule, at request time, from the cached rows and the local templates:

| State | Rule |
|---|---|
| current | The text equals the installed template. With an older stamp version, it shows "current, stamp `<version>`". With no stamp, "current, no stamp". |
| behind | The text differs from the installed template, and equals the template at the stamp version in the plugin cache |
| edited by the team | The text differs from the installed template and from the template at the stamp version |
| differs from the template | The text differs from the installed template, and there is no stamp or no template at the stamp version. The note says "Foreman cannot tell a team edit from a template change." |
| missing at `<ref>` | The rule file is not at the ref of the forge file step |
| branch not found | The ref of the forge file step does not exist |
| no template in the installed plugins | No installed source has a template of that name and kind |
| template name not unique | Two sources have a template of that name |
| file too large, not readable, invalid adapter output, or the text of an error class | The last read of the rule file failed, by the file rules of the Controls view Spec |

- Each repo in scope shows its `owner/name`, its default branch, the `factory_core_version` and the Stack pack of its factory config, its "data as of" time from Spec 23, and one summary line: "N Repo rules match the templates", or the counts of each other state, for example "1 Repo rule behind factory-core 0.30.0". A repo whose Stack pack is not installed also shows "Stack pack `<name>` is not installed".
- When the factory config names a `main_branch` that is not the default branch, the repo shows "the main branch in the factory config is `<main_branch>`, the default branch is `<branch>`".
- A Repo rule belongs to its team (factory ADR 0003), so no state is an error. Foreman shows the drift, and a change goes through a factory skill.

### Unattended runs

Local, read-only, on each request, from the night log reader of Spec 24 (`apps/api/src/dash/night-log`). This Spec uses the Spec 24 rules for the window of 30 days, the scope of a line, skips, builds, leaf issues, starts, ends, results, lanes and "blocked at selection". It does not define them again.

- **A run** is one `run_id` with one or more lines in scope in the 30 days. In a client scope, the run uses only the lines of that client's repos, as the last run of Spec 24 does.
- **Night and window.** The window of a run runs from its first to its last line in scope, or to now while the lock holds that `run_id` and is not stale. The night is the date of the window start in the browser's time zone. A run that started before the 30 days uses only its lines in the 30 days, by the Spec 24 window rule.
- **The rules in one place.** `runsInWindow` in `apps/api/src/dash/runs` applies the Spec 24 rules to every `run_id` in the window, and the last run of the dash is its newest run. The Reviews view uses the same export.
- **Builds.** The count of builds, and the count of each result.
- **Peak.** The highest count of builds at one time in the run. In the scope "All", it shows as "peak N of 5". In a client scope, it shows as "peak N at one time", with no slot count, so that the load of other clients does not show.
- **Stopped items.** A build of a run that is not in progress, with the result "stopped at run end" or "in review". The run left it open, and `factory-run` resumes it in a later run (its section 3). Each stopped item shows its repo, its number, its title from the Work cache as plain text when the cache has it, and its link from the cache. It shows "resumed by the run of `<night>`" for the first later run in scope with a line for the same repo and issue, else "not resumed yet". The API gives the window start of that run, and the web app shows its night.
- **Skips** and **blocked at selection**: the counts of the run.
- The runs sort by window start, newest first.

### Factory health API

All routes are below `/api/factory-health`, and their schemas are in `packages/shared`. Query schemas use `.strict()`. The routes are `public: true` for the reason in the Usage ingest Spec. Each list route is paginated with `limit` and `cursor`, by the cursor rules of Spec 23.

| Route | Query | Returns |
|---|---|---|
| `GET /plugins` | `limit` (default 100, maximum 500), `cursor`. A `client` value gets status 400, as the limits route of Spec 23 does. | The Marketplaces with their name, source kind, `lastUpdated` time and state; the plugin rows with the key, the plugin, the Marketplace, the installed version, the install `lastUpdated` time, the Marketplace version, the state and the count of other-scope installs; the skipped file counts |
| `GET /rule-drift` | `client`, `repo` (a repo ID; one outside the `client` gets status 400), `limit` (default 50, maximum 200), `cursor` | The repos in scope, by `owner/name`, each with its connection state, "data as of" time, default branch, factory config state and versions, summary counts and rules. Each rule has its name, kind, state, stamp plugin and version, and the installed version of its source. The response has the `complete` count of Spec 24 and the skipped template count. |
| `GET /runs` | `client`, `limit` (default 30, maximum 100), `cursor` | The runs, newest first, each with the run ID, the window start and end, the in-progress flag, the build count, the count of each result, the peak and, only in the scope "All", the slot limit 5, the skips, the count blocked at selection, and the stopped items with repo ID or folder label, issue, result, title, link and the window start of the resuming run (or null). The response has the `skipped` counts of Spec 24. |

All times are UTC, in ISO 8601. No response holds a local path, a file text, a hash, an install folder or a Marketplace folder.

### Command allow-list

The Controls view Spec adds `repo` and `file get` to the runner of Spec 23, with this rule text, which every Spec uses:

- `file get <path> --ref <ref>`: `<path>` refuses a `..` part, a leading `/` and a backslash, and is one of the fixed paths or path patterns that a Spec names. `<ref>` refuses a leading `-`. Any other argument shape is refused before a subprocess starts.

This Spec adds one path pattern: `.claude/rules/<name>.md`, where `<name>` matches `^[a-z0-9][a-z0-9-]*$`. The fetch builds the path only from a name that passed the repo config schema, never from other adapter output.

### Web app

- The page route `/health` is a web app route. Caddy and the Vite proxy send only `/api/*` to the API, so `/health` gets the web app. The API health check stays at `GET /api/health`, which the Compose health checks and the smoke test call. The Factory health routes are below `/api/factory-health`, so that no new route is below `/api/health`.
- The layout follows the prototype's "Factory health" tab: the three sections in a grid, which stacks at phone width. The runs table scrolls inside its section at phone width, and the page has no horizontal scroll.
- The web app asks for the three routes on load and each 60 seconds while `document.visibilityState` is `visible`.
- Plugin names, versions, rule names, repo names, titles and labels are React text nodes, by the Spec 23 rules. Links use only the `link` field.
- Each plugin state, rule state and build result has a text label and a colour. The colours pass 4.5:1 contrast for their text. The tables use table semantics with column headers.
- Rule drift uses the Work cache rows of the repos in scope. When one or more repos in scope have no cache rows or a fetch error, it shows "Data is not complete: N repos not connected. See Repos.", with "See Repos" as a link to the Repos section of the Foreman dash. When no repo in scope has cache rows, it shows the Spec 23 "not connected" text. Plugin versions and Unattended runs still show.

## Gating and rollout

- **Gating:** not required. The view adds a page and three routes, and adds rows to a cache table of the Controls view Spec. It changes no existing flow. The rule files fail with "adapter error" until the installed forge adapter has `file get`, and the other fetch steps still run, by the Spec 23 rule that each role and repo fails alone.
- **Rollout:** the issues merge into the Integration branch `feature/foreman-v1` (Integrated), in the order of the section "Build order". Plugin versions and Unattended runs work with no token. Rule drift shows real data after factory PR #120 merges and the Operator updates the factory plugins. After the rule file slice reaches the local runtime, the Operator runs `pnpm reindex` once, so that the next full fetch parses each `.claude/factory.json` again with the new keys. To undo, revert the change; `pnpm reindex` empties the rule rows with the rest of the Work cache.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The view shows plugin names and versions, repo names, rule names, issue numbers and titles from the Work cache, and repo folder labels from the night log.
- The cache keeps no text of a rule file or a factory config: only the parsed fields of section "Rule files in the forge file step". A rule file is client repo content, so Foreman keeps only its hash.
- The plugin files and the night log hold local paths with the user name of the machine. No response and no log holds them.
- In a client scope, the view hides the data of other clients, also the count of the 5 build slots. Plugin versions are the same in every scope and hold no client data.

## Out of scope

- The exclusions of every Foreman v1 view: "Review scope of recent reviews" (it needs the `review-scope` Control event of factory Spec #85, which no code writes yet), overdue findings, the deferred finding events of factory ADR 0018, any action or write other than the refresh request, and cloud and CI sessions.
- Any action: a plugin update, a Marketplace update or a rule update. Changes go through Claude Code and factory skills.
- The text of a difference between a rule and its template. Foreman keeps no rule text. `context-init` reports a "conflict" for such a file, and the planned `factory-upgrade` skill proposes the diff.
- Files in `.claude/rules/` that the factory config does not list. The Forge contract has no folder list command.
- Drift of the deny rules in `.claude/settings.json` and of the `_context/` skeleton. ADR 0007 names only the drift of Repo rules.
- Marketplace plugins that are not installed, and a check for a newer version over the network.
- A comparison of the install commit (`gitCommitSha`) with the Marketplace copy.
- Whether a run ended by itself or stopped. The night log has no end line, and the run summary file is free text.
- Runs older than 30 days, and a mark for a run that started before the 30 days. The night log reader of Spec 24 reads 30 days and gives no older line.

## Risks

- **The plugin files are Claude Code internals, not a public contract.** A change of `installed_plugins.json`, `known_marketplaces.json` or the cache folder layout can stop Plugin versions or the "behind" state. Foreman validates each file, and shows "not readable" or "differs from the template", not a wrong state.
- **Claude Code removes old cached versions.** Then "behind" and "edited by the team" fall back to "differs from the template".
- **A `directory` Marketplace is a working folder.** Its version is the version of the files on the branch that is checked out now, which can be a branch that is not merged. The note on the Marketplace says so. The mount gives the API container read access to that whole folder.
- **The rule files cost forge calls.** Each forge file step makes one call for each listed rule, for each connected repo: about 50 more calls in each full fetch and each refresh request for 6 repos with 8 rules. A timer fetch makes them at most once each hour. A rate limit makes the repo "partial", by the Spec 23 rules.
- **The stamp line is shared text.** A change of its words in `context-init` makes every rule "current, no stamp" or "differs", so it is part of the source contract.

## Build order

Each slice is one PR-sized issue. A slice of another Spec that it needs is named with its Spec number or issue.

1. **71-1 Plugin versions.** `apps/api/src/factory-health/plugins`, `apps/api/src/routes/factory-health.ts` (`GET /plugins`), `packages/shared`, `apps/api/src/config.ts` (`FOREMAN_MARKETPLACE_DIR`). The Plugin versions scenarios. Needs: Spec 23 issue #28 (the adapter install folders, done).
2. **71-2 Unattended runs.** `apps/api/src/dash/runs` (the export `runsInWindow`), `apps/api/src/factory-health/runs`, `apps/api/src/routes/factory-health.ts` (`GET /runs`), `packages/shared`. The run scenarios. Needs: Spec 24 issues #40 and #41 (the night log reader and the run rules); Spec 66 uses the same export, so the first of the two slices adds it.
3. **71-3 Rule files in the forge file step.** `apps/api/src/controls/files`, `apps/api/src/work/fetch`, `apps/api/src/work/runner`, with their tests. The scenarios of the fetch, the repo config, the paths and the file states. Needs: the Controls view slice for the forge file step and `work_forge_files` (Spec 67).
4. **71-4 Rule templates and Rule drift.** `apps/api/src/factory-health/templates`, `apps/api/src/factory-health/rule-drift`, `apps/api/src/routes/factory-health.ts` (`GET /rule-drift`), `packages/shared`. The drift state scenarios, the scope and the connection states. Needs: 71-3.
5. **71-5 Factory health page.** `apps/web/src/factory-health`, `apps/web/src/nav`. The view, the plain text, the live update and the state scenarios. Needs: 71-1, 71-2, 71-4; Spec 69 slice 69-1 (theme and format); Spec 24 issue #40 (the nav); Spec 23 issue #36 (the header).
6. **71-6 Factory health end-to-end tests.** `e2e/factory-health.spec.ts` with the axe scan over the fixture sets of the scenario "Accessibility". Needs: 71-5.

## Open questions

- None. The `repo` command is on the allow-list, by the binding decision for all Specs, and the Controls view Spec adds it. `file get` returns UTF-8 text, and its errors have no kind: Foreman maps them by their fixed message prefix.
