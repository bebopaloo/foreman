# Controls view

**Status:** Approved
**Work items:** #67

Source: foreman ADR 0003, factory ADR 0007 (amended 2026-11-14), factory ADR 0012, ADR 0014 and ADR 0015, the factory record `_context/architecture/control-events.md`, and factory pull request bebopaloo/factory#120, step 4 of the build order. It builds on the approved Specs [`23-forge-and-tracker-connection.md`](23-forge-and-tracker-connection.md) and [`24-foreman-dash.md`](24-foreman-dash.md). It uses the status step and the list conventions of the Work view ([`65-work-view.md`](65-work-view.md)), and the theme and format modules of the Usage view ([`69-usage-view.md`](69-usage-view.md)). It owns the forge file step and the table `work_forge_files`, which the Factory health view ([`71-factory-health.md`](71-factory-health.md)) also uses. The Reviews view ([`66-reviews-view.md`](66-reviews-view.md)) is the other half of step 4. Layout reference: the Claude artifact "Foreman dash prototype", tab "Controls". Where the prototype and this Spec differ, this Spec is the master copy.

## Problem

Each client repo turns on its own **Control modules** in `.claude/factory.json`, and keeps its **Risk map**, **Control register**, **Threat model** and **Waivers** in its own files. Each Release has a **Release record** on the forge. To see which controls a repo has, which Waivers expire, which paths escalate again and again, and what evidence each Release has, the Operator opens the files and the releases of each repo on the forge, one by one.

An auditor of a regulated client asks for the controls that are on, the risks that the client accepted, and the evidence for each version. The Operator needs one page that shows these for one client, with links out to the forge and the tracker.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator opens the Controls view to check the controls of each repo, to renew a Waiver in time, to fix a Risk map and to prepare an audit.
- **Stakeholders and auditors of one client**: they see the Controls view only in a screen share by the Operator, in that client's **Client scope**.
- **The Reviews view and the Factory health view**: they read the cached repo config of this Spec.

## Acceptance criteria

Fixtures are synthetic: a synthetic repo list, Control events, Work cache and synthetic adapter output for `repo`, `file get` and `release asset`. No real repo file, Release record, event or token goes into the repo. In the scenarios, the default branch of each repo is `main`, and its repo config has no `main_branch`, unless the scenario says otherwise.

### The Controls view

- **When** the Operator opens `/controls`
- **Then** Foreman shows the sections Control modules by repo, Escalations, Waivers, Releases and Security artefacts, in that order
- **And** the header shows the Client scope, the connection state and the Refresh button of the step 2 Spec, and the nav marks "Controls".

### Control modules from the repo config

- **Given** a cached `.claude/factory.json` of `acme/pay` whose `controls` key has the profile `regulated` and 13 modules with `control_events`, and a cached file of `acme/web` with no `controls` key
- **When** the view loads
- **Then** the row of `acme/pay` shows "regulated", "13 modules", the module names, and Control events "on", with the note "Full review data from Control events"
- **And** the row of `acme/web` shows "none", "0 modules" and Control events "off", with the note "Forge data only: the Machine gate status, Factory identity reviews and merges".

### A controls key that is not valid

- **Given** a cached `.claude/factory.json` whose `controls` key has `modules` as a text, not a list
- **When** the view loads
- **Then** the row shows "controls key not valid: the factory stops the control steps"
- **And** Foreman reads no other control file of that repo.

### No repo config

- **Given** a repo whose `file get .claude/factory.json --ref main` fails with the error message `file not found: .claude/factory.json at main`, and a repo whose call fails with `ref not found: main`
- **When** the view loads
- **Then** the first row shows "no `.claude/factory.json` at `main`"
- **And** the second row shows "no branch `main`".

### The branch of the forge files

- **Given** a repo whose `repo` output has `default_branch` `trunk`, and a `.claude/factory.json` at `trunk` with `"main_branch": "develop"` and the `waivers` module on
- **When** the forge file step runs
- **Then** the adapter gets `repo`, then `file get .claude/factory.json --ref trunk`, then `file get _context/controls/waivers.toml --ref develop`
- **And** with a `main_branch` of `-x`, or with no `main_branch`, the adapter gets `file get _context/controls/waivers.toml --ref trunk`
- **And** a repo whose `default_branch` is empty, or is `-x`, shows "no default branch", and the step reads no file for it.

### Files only for modules that are on

- **Given** a repo with the modules `risk_tiers` and `waivers` on, and `control_register` and `threat_model` off
- **When** the forge file step runs
- **Then** the adapter gets `file get` for `.claude/factory.json`, `_context/controls/risk-map.toml` and `_context/controls/waivers.toml` only
- **And** Security artefacts shows "module off" for the Control register and the Threat model.

### When the forge file step runs

- **Given** a connected repo whose last forge file step ended 20 minutes ago
- **When** an incremental fetch from the 15-minute timer runs, then a fetch from a refresh request, then 61 minutes later a fetch from the timer, then a full fetch
- **Then** the first fetch runs no `repo` and no `file get`
- **And** the second, the third and the fourth fetch each run the forge file step
- **And** the first fetch of a repo with no earlier forge file step runs it.

### A file that did not change

- **Given** a cached Risk map with the blob sha `A`, and a `file get` that returns the sha `A`
- **When** the fetch reads it
- **Then** Foreman does not parse the file again, and sets its fetch time.

### A file that the adapter refuses

- **Given** a `file get` that fails with the error message `_context/controls/risk-map.toml is 2000000 bytes; file get reads at most 1048576 bytes`
- **When** the fetch reads it
- **Then** the Risk map shows "adapter error", keeps its earlier parsed data, and the repo's forge state is "partial"
- **And** a `file get` output with `size` 2,000,000 shows "invalid adapter output", and Foreman stores no content of it.

### The forge file commands on the allow-list

- **Given** the runner
- **When** a code path asks for `repo`, `file get _context/controls/waivers.toml --ref main`, `release asset v1.2.0 record-v1.2.0.json`, `file get .env --ref main`, `file get _context/controls/../../.env --ref main`, `file get _context/controls/waivers.toml --ref -x`, `file get _context/controls/waivers.toml --ref a..b`, `release asset v1.2.0 notes.md`, `release asset v1.2.0 ../x.json` and `repo --json`
- **Then** the runner accepts the first three commands
- **And** it refuses the other seven before a subprocess starts.

### Error messages map by their prefix

- **Given** `file get` and `release asset` calls that fail with exit code 1 and the error messages `file not found: x at main`, `ref not found: main`, `release not found: v1.2.0`, `asset not found: r.json in release v1.2.0`, `HTTP 401: Bad credentials` and `something else`
- **When** the runner maps them
- **Then** the states are "missing file", "missing ref", "missing tag", "missing asset", "token rejected" and "adapter error"
- **And** no log line and no cache row holds the error message.

### Output that breaks the contract

- **Given** a `file get` output whose `path` or `ref` differs from the command, whose `sha` is not 40 hex characters, or that has an unknown key
- **When** the fetch reads it
- **Then** Foreman does not store it, and the file shows "invalid adapter output"
- **And** the file keeps its earlier parsed data, and the repo's forge state is "partial".

### Escalations by path

- **Given** `escalated` events in 30 days: pull request 310 with the paths `src/ledger/transfer.ts` and `src/ledger/fees.ts`, `path_tier` `general` and `tier` `authority`; pull request 318 with the path `src/ledger/transfer.ts`, `path_tier` `general`, `tier` `authority` and the evidence `src/ledger/transfer.ts:42`; and pull request 321 with the path `src/payee/match.ts`
- **When** the view loads
- **Then** Escalations shows `src/ledger/transfer.ts` first, with general, authority, 2 times, the latest pull request 318 and the evidence `src/ledger/transfer.ts:42`
- **And** `src/ledger/fees.ts` and `src/payee/match.ts` each show 1 time
- **And** the section shows "1 path escalated 2 or more times. Change the Risk map in a pull request."

### Waivers and their expiry

- **Given** the UTC date 2026-11-14, a cached Waiver register of `acme/pay` with `WAIVER-7` that expires on 2026-11-28, `WAIVER-4` that expires on 2027-01-10 and `WAIVER-2` that expired on 2026-11-13, and `waiver_used` events in 30 days: 3 for `WAIVER-7` and 1 for `WAIVER-4`
- **When** the view loads
- **Then** Waivers shows `WAIVER-2` "expired", `WAIVER-7` "expires in 14 days" and `WAIVER-4` "current, 57 days", in that order
- **And** the use counts are 0, 3 and 1.

### A Waiver that expires today

- **Given** the UTC date 2026-11-14 and a Waiver that expires on 2026-11-14
- **When** the view loads
- **Then** the Waiver shows "expired", as `waivers.py` decides.

### A Waiver in use that is not in the register

- **Given** 2 `waiver_used` events for `WAIVER-9` of `acme/pay`, and no `WAIVER-9` in its cached register, which has the state `ok`
- **When** the view loads
- **Then** Waivers shows a row `WAIVER-9` with "not in the register at `main`" and 2 uses.

### What a Waiver covers

- **Given** Waivers that cover a finding (`file`, `category` and `ref`), a check (`name`) and a control (`id`)
- **When** the view loads
- **Then** Covers shows "finding: `packages/payments/webhook.ts` · Security · CWE-770", "check: trivy" and "control: CTRL-PAY-03"
- **And** the response and the cache hold no `reason` and no `risk` text.

### A Waiver register that is not valid

- **Given** a `waivers.toml` that is not valid TOML, and a register with one valid Waiver and one Waiver with no `expires`
- **When** the fetch parses them
- **Then** the first repo shows "Waiver register not readable", and its `waiver_used` counts still show
- **And** the second repo shows the valid Waiver and "1 Waiver not readable: position 2, field `expires`", with no field value.

### Releases with their records

- **Given** a cached tracker Release `v2.2.1` "released" with 6 issues, a cached forge release `v2.2.1` with the assets `record-v2.2.1.md` and `record-v2.2.1.json`, and a Release record with the tier `sensitive`, a Release approval by `op-login` and no gaps
- **When** the view loads
- **Then** Releases shows `v2.2.1` with "released", 6 issues, sensitive, "approved by `op-login`" with the approval time, "no gaps", and links to the tracker Release and the forge release.

### An open Release

- **Given** a cached tracker Release `v2.3.0` "open", an open pull request 330 from `release/2.3` into `production` with the head sha `B`, and a cached `factory/release-review` status `fail` on `B` (Work view Spec)
- **When** the view loads
- **Then** Releases shows `v2.3.0` with "open", the release pull request 330 with its link and checks, and the release review "fail"
- **And** the record columns show "no Release record before the release".

### A Release record with gaps

- **Given** a Release record with 3 `gaps`, a Control `CTRL-PAY-07` with the status `untested`, 1 direct commit, and a `release_approval` that is required and has no approver
- **When** the view loads
- **Then** the row shows "3 gaps: 1 Control not proven (CTRL-PAY-07), 1 commit with no pull request, Release approval missing"
- **And** the response and the cache hold no gap text and no review record.

### No Release record

- **Given** a released Release whose forge release has no asset whose name ends in `.json`, a released Release whose forge release has the assets `a.json` and `b.json`, a released Release with "no forge release" (step 2 Spec), and a Release record that fails the schema
- **When** the view loads
- **Then** the rows show "no Release record", "more than one Release record", "no forge release" and "Release record not readable"
- **And** the fetch runs no `release asset` for the first two
- **And** a repo with the `release_record` module off shows "Release record module off" for its records.

### A Release record is read once

- **Given** a cached, valid Release record for `v2.2.1`
- **When** the next fetch runs, and then a full fetch runs
- **Then** neither fetch runs `release asset v2.2.1 record-v2.2.1.json`
- **And** after `pnpm reindex`, the next fetch runs it once.

### Security artefacts

- **Given** a cached Risk map with 5 globs for `authority`, 3 for `sensitive`, 1 for `inert` and the boundaries `TB-1` and `TB-2`, a Control register with 4 Controls, and a Threat model with 2 boundaries and 5 threats, of which `TM-4` has "Controls: none" and `TM-5` cites `CTRL-OPS-09`, which the register does not have
- **When** the view loads
- **Then** Security artefacts shows "Risk map: authority 5, sensitive 3, general 0, inert 1 globs; 2 boundaries", "Control register: 4 Controls" and "Threat model: 2 boundaries, 5 threats, 1 with no Control (TM-4), 1 cited Control not in the register (CTRL-OPS-09)"
- **And** each artefact shows the first 7 characters of its blob sha and its "data as of" time.

### A module on and its file missing

- **Given** the module `threat_model` on and a `file get _context/threat-model.md --ref main` that fails with `file not found: _context/threat-model.md at main`
- **When** the view loads
- **Then** Security artefacts shows "`threat_model` is on, but the Threat model is missing at `main`".

### The Control register list

- **Given** a register with `CTRL-PAY-03` and `CTRL-PAY-07`, and a newest valid Release record `v2.2.1` with `CTRL-PAY-03` "passing"
- **When** the web app asks `/api/controls/register`
- **Then** `CTRL-PAY-03` has its title, owner, counts of sources, modules and manual checks, and "passing in `v2.2.1`"
- **And** `CTRL-PAY-07` has "not in a Release record".

### Lists in pages

- **Given** 120 Waivers in scope
- **When** the web app asks `/api/controls/waivers` with no `limit`, and then with the `nextCursor`
- **Then** the first page has 100 rows and the second has 20
- **And** a request with `limit=501`, `limit=0`, an unknown query key or a cursor that is not valid gets status 400.

### Controls in a client scope

- **Given** cached files, Releases and Control events of `acme` and `globex` repos
- **When** the view loads with the scope `acme`
- **Then** every section shows only the data of `acme` repos
- **And** a request to `/api/controls/releases` with `client=acme` and the repo ID of a `globex` repo gets status 400.

### Some repos not connected

- **Given** 3 repos in scope, of which 1 has no Work cache rows
- **When** the view loads
- **Then** Control modules, Waivers, Releases and Security artefacts show the data of the 2 connected repos
- **And** each shows "Data is not complete: 1 repo not connected. See Repos."

### Not connected

- **Given** no token for any repo in scope
- **When** the view loads
- **Then** Escalations shows the data from the Control events
- **And** Waivers shows each Waiver ID from the `waiver_used` events with its uses and "register not read"
- **And** Control modules, Releases and Security artefacts show "Not connected. Add the Foreman token to the Keychain, then run `pnpm local:up`."

### Text stays plain text

- **Given** a Control title and a Waiver owner that hold HTML and Markdown
- **When** the view shows them
- **Then** the page shows the text as it is, with no markup and no request to another host.

### Live update

- **Given** the view is open in a visible tab
- **When** 60 seconds pass
- **Then** the web app asks for the Controls data again, and the loaded pages of each list by the list conventions of the Work view Spec
- **And** while the tab is hidden, it does not ask.

### Accessibility

- **Given** each fixture set of the scenarios "Control modules from the repo config", "Waivers and their expiry", "Releases with their records", "A Release record with gaps", "Some repos not connected" and "Not connected", loaded from synthetic files and a seeded Work cache
- **When** the end-to-end test opens `/controls` with each set, in the light theme and in the dark theme
- **Then** the axe scan finds no WCAG 2.2 AA violation
- **And** each state pill (Control events, expiry, Release approval, release review) has a text label as well as a colour.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/work/contract` | The output shapes of `repo`, `file get` and `release asset` |
| `apps/api/src/work/runner` | The command allow-list gains `repo`, `file get` and `release asset`, and the error prefix map (below) |
| `apps/api/src/work/fetch` | Gains the forge file step and the Release record step |
| `apps/api/src/controls/files` | The fixed list of forge files of this Spec, their modules, the one repo config parser for every Spec that reads the repo config, and the parsers that keep only the fields below |
| `apps/api/src/controls/release-records` | The parser of the Release record JSON |
| `apps/api/src/controls/modules` | The default branch, the file branch, the Control modules and the `releases` key of each repo, from `work_forge_files`. The Reviews view uses it. |
| `apps/api/src/controls/escalations` | Escalations by path, from the `escalated` events |
| `apps/api/src/controls/waivers` | The Waivers, their expiry, and their uses from the `waiver_used` events |
| `apps/api/src/controls/releases` | The tracker Releases with their forge release, record and release review |
| `apps/api/src/controls/artefacts` | The Risk map, Control register and Threat model summaries, and the Control register list |
| `apps/api/src/dash/control-events` | The Control event reader of the dash Spec. This view uses it as it is. |
| `apps/api/src/routes/controls.ts` | The Controls routes |
| `packages/db` schema | The tables `work_forge_files` and `work_release_records` (below) |
| `packages/shared` | The Zod schemas of the Controls queries and responses |
| `apps/web/src/controls` | The Controls page |
| `apps/web/src/nav` | Gains the link "Controls" |
| `e2e/controls.spec.ts` | The end-to-end tests with the axe scan |
| `apps/api/package.json` | Gains the TOML 1.0 parser `smol-toml`, at an exact version that is 7 days old or more |

The page uses `apps/web/src/theme` and `apps/web/src/format` of the Usage view Spec, and `apps/web/src/list` and `apps/api/src/paging` of the Work view Spec. It does not define its own tokens, formats or paging.

### Configuration

No new variable. The variables of the step 2 Spec and the dash Spec do not change.

### Dependencies on the factory

- **Two Forge contract commands** (ADR 0003, ADR 0012), in factory pull request bebopaloo/factory#120. `file get <path> --ref <branch|tag>` returns `{"path", "ref", "sha", "size", "content"}`: `sha` is the 40-character blob sha, `size` is in bytes, and `content` is UTF-8 text of at most 1 MB. `release asset <tag> <name>` returns `{"tag", "name", "size", "content"}`, with at most 5 MB of UTF-8 text, for a tag `vX.Y.Z` or `<plugin>-vX.Y.Z`. On an error, each exits with code 1, writes nothing on standard output, and writes `{"error": "<message>"}` on standard error. The error object has no kind field.
- **The `repo` command** exists in the forge adapter today. It returns `{"host", "owner", "name", "url", "default_branch"}`. `default_branch` is empty for an empty repo.
- **The Release record assets.** `perform-release` attaches the Markdown and the JSON Release record to the forge release, with no fixed names. This Spec reads the one asset whose name ends in `.json`.
- **The head sha and the release review status.** The status step of the Work view Spec caches the `factory/release-review` status of each open release pull request. Without `head_sha` in the installed adapter, the release review shows "—".

Foreman's tests use synthetic adapter output, so they do not wait for these work items.

### The runner

The command allow-list of the step 2 Spec gains these Forge commands. The rule text is the same in every Spec that adds a command. Any other path, name, option or argument shape is refused before a subprocess starts.

| Role | Command | Rule |
|---|---|---|
| Forge | `repo` | No argument. |
| Forge | `file get <path> --ref <ref>` | `<path>` must be one of the fixed paths or path patterns that a Spec names. It never comes from adapter output. Every other path, for example `.env`, is refused, and so is a path with `..`, a leading `/` or a backslash. This Spec names the five paths of the table "Forge files". The Factory health Spec (71) adds the pattern `.claude/rules/<name>.md`. `<ref>` matches `^[A-Za-z0-9_][A-Za-z0-9._/+-]*$` and has no `..`, so a ref never starts with `-` and never reads as an option. |
| Forge | `release asset <tag> <name>` | `<tag>` matches the contract's tag pattern. `<name>` matches `^[A-Za-z0-9_][A-Za-z0-9._-]{0,250}\.json$`: a plain file name that ends in `.json`. |

- **Error prefix map.** For `file get` and `release asset`, the runner maps an exit code 1 with an error object by the fixed prefix of its `error` message. This map comes before the error table of the step 2 Spec:

  | Message starts with | State |
  |---|---|
  | `file not found:` | missing file |
  | `ref not found:` | missing ref |
  | `release not found:` | missing tag |
  | `asset not found:` | missing asset |

  Any other message maps by the error table of the step 2 Spec, which gives the class `other` ("adapter error") when no text matches. The runner never stores or logs the message, by the step 2 rule.

### Forge files

A **Forge file** is a file that Foreman reads from a repo at its main branch with `file get`. Foreman reads these Forge files, and only these, for this Spec. The paths are fixed in code.

| File | Path | Read when |
|---|---|---|
| Repo config | `.claude/factory.json` | always |
| Risk map | `_context/controls/risk-map.toml` | `risk_tiers` is on |
| Control register | `_context/controls/controls.toml` | `control_register` is on |
| Waiver register | `_context/controls/waivers.toml` | `waivers` is on |
| Threat model | `_context/threat-model.md` | `threat_model` is on |

- **The forge file step.** For each connected repo, after step 4 of the step 2 fetch:
  1. `repo`. It gives `default_branch`. An empty value, or a value that fails the ref rule of the runner, records "no default branch" for the repo, and the step reads no file.
  2. `file get .claude/factory.json --ref <default branch>`.
  3. `file get <path> --ref <file branch>` for each other file whose module is on. The file branch is the `main_branch` of the repo config when it passes the ref rule of the runner, else the default branch. A file whose module is off records "module off" and runs no call. A missing repo config means the profile `none` and no module on, as `factory_config.py` decides, so every other file records "module off". A repo config that is not readable, or a `controls` key that is not valid, reads no other file of this Spec, and those files keep their rows.

  This Spec owns the one parser of the repo config. The Factory health Spec (71) adds the keys `rules`, `compliance`, `stack_pack` and `factory_core_version` to it. It also adds its rule files to this step, at the file branch, as rows of the same table. It runs no second `repo` call and no second read of the repo config.
- **When.** The step runs for a repo when it has no earlier forge file step, when its last forge file step ended 60 minutes ago or more, on each full fetch, and on each fetch from a refresh request. These files change only in a pull request, so the 15-minute timer fetch does not read them each time.
- **No change.** When the `sha` equals the cached sha, Foreman does not parse the file again, and sets its fetch time.
- **Validation.** The output must have exactly the keys of the contract, and the `path` and the `ref` of the command. The `sha` has 40 hex characters. The `size` is a whole number from 0 to 1,048,576, and the `content` has at most 1,048,576 bytes in UTF-8. Other output is "invalid adapter output", by the step 2 rules, and Foreman stores no content of it.
- **Parse and drop.** Foreman parses each file at fetch time and stores only the fields below. It never stores the content.
- **Errors.** A file that fails keeps its earlier parsed data and records its state, or its error class by the step 2 table. The repo's forge state is then "partial", by the step 2 rules. A failed `repo` call records its error class for the repo, and the step keeps every cached file row.

### The parsed fields

| File | Rules | Foreman keeps |
|---|---|---|
| Repo config | JSON. It must be a JSON object; else it is "not readable". Foreman reads only the keys `main_branch`, `controls` and `releases` for this Spec, and the four keys of the Factory health Spec. It does not read the other keys, because the factory owns this file and adds keys to it. The parser validates each key alone, so a key that fails does not make another key fail. `controls`, when present, has only `profile`, `modules` and `settings`, the shape that `factory_config.py` checks: `profile` is a text, `modules` is a list of distinct texts that match `^[a-z_]+$`, and `settings` is an object. Else the state is "controls key not valid". With no `controls` key, the profile is `none` and no module is on, as `factory_config.py` decides. `releases`, when present, has `production_branch`, `baseline` and `switched_over`, as `context_init.py` writes them. | the `main_branch` value; the profile and the module names, or the state "controls key not valid"; the switch-over date and the production branch |
| Risk map | TOML. `[[tier]]` tables with `name` (a Risk tier) and `paths` (a list of globs), and `[[boundary]]` tables with `id` (`TB-<n>`) and `paths`, as `risk_tier.py` checks | the glob count of each Risk tier, and the boundary IDs with their glob counts |
| Control register | TOML. `[[control]]` tables with `id` (`CTRL-<AREA>-<n>`), `title`, `owner`, `modules`, and the optional `sources` and `manual_checks`, as `controls.py` checks; the optional top-level `tests` | for each Control: the ID, the title (at most 200 characters), the owner, and the counts of sources, modules and manual checks |
| Waiver register | TOML. `[[waiver]]` tables with `id` (`WAIVER-<n>`), `reason`, `risk`, `owner`, `approved_by`, `created` and `expires` (TOML dates) and `covers`, as `waivers.py` checks. `covers.kind` is `finding` (`file`, `category`, optional `ref`), `check` (`name`) or `control` (`id`). | for each Waiver: the ID, the owner, the approver, the two dates and the `covers` fields. Never `reason` and never `risk`. |
| Threat model | Markdown, read by the rules of `controls.py`: HTML comments are left out; `## TB-<n> <name>` starts a boundary; `### TM-<n> <name>` starts a threat; the lines `- STRIDE:` and `- Controls:` give its categories and its Control IDs, or `none`. | the boundary IDs, and for each threat: the ID, its boundary ID, its STRIDE categories and its Control IDs. Never the names and never the other lines. |

- An entry that fails its rules is skipped and counted, with its position and the failed field, and no field value. The other entries continue.
- A file that is not valid JSON, TOML or UTF-8 text is "not readable", and keeps no entries.
- When `main_branch` differs from the default branch, the Control modules row shows "the main branch in the factory config is `<main_branch>`, the default branch is `<default branch>`". Foreman reads the other forge files at the file branch.

### Release records

- **Which asset.** For each cached forge release (step 2 Spec) with no cached record, Foreman looks at its cached asset names. With exactly one name that ends in `.json`, the Release record step runs `release asset <tag> <name>`. With none, the record state is "no Release record"; with two or more, "more than one Release record". In these two states the step runs no call. A full fetch looks at the asset names again, because the step 2 `release view` step reads them again.
- **When.** In each fetch, after the step 2 `release view` step. A record does not change after the release, so only a fetch after `pnpm reindex` reads a cached record again.
- **Validation.** The output must have exactly the keys of the contract, and the `tag` and the `name` of the command. The `size` is a whole number from 0 to 5,242,880, and the `content` has at most 5,242,880 bytes. Other output is "invalid adapter output".
- **Rules.** The JSON has exactly the top-level keys that `release_record.py build` writes: `release`, `pull_requests`, `direct_commits`, `release_approval`, `controls`, `waivers`, `sbom_digest`, `control_modules` and `gaps`. `release.name` equals the tag. A record that fails is "Release record not readable".
- **Foreman keeps:** the release tier, the release pull request number, the baseline commit; for each pull request: its number, issue, Issue type, tier, and whether it has a review record; the count of direct commits; the Release approval (`required`, `approved_by`, `time`, `threshold`) or none; the count of each Control status and each Control ID with its status; for each Waiver: its ID, its expiry and its `covers` kind; the SBOM digest; the profile and the module names; and the count of gaps.
- **Foreman drops:** every review record, every pull request title, the subject of each direct commit, each gap text, the tests and manual checks of each Control, and the settings.
- **Gap kinds.** Foreman counts the gaps from the structured fields: Controls with the status `failing` or `untested`; direct commits; a Release approval that is required and has no approver; pull requests with no review record. The rest of the `gaps` count shows as "other".

### Work cache tables

These tables join the **Work cache** of the step 2 Spec. All times are `timestamp with time zone`, in UTC. `pnpm reindex` empties them with the other work tables.

| Table | Columns |
|---|---|
| `work_forge_files` | repo ID and path (primary key), ref, sha, size, fetch time, state (`ok`, `module_off`, `missing_file`, `missing_ref`, `not_readable`, `failed`), error class, skipped entries (position and field), parsed fields (JSON, validated with Zod on write and on read) |
| `work_release_records` | repo ID and tag (primary key), asset name (or none), size, fetch time, state (`ok`, `no_record`, `more_than_one_record`, `missing_tag`, `missing_asset`, `not_readable`, `failed`), error class, parsed fields (JSON, validated with Zod on write and on read) |

`work_repos` gains the default branch (or none), the file branch (or none), the state of the last `repo` call (`ok`, `no_default_branch` or `failed`) with its error class, and the end time of the last forge file step. There is an index on the repo ID of each new table. The release review comes from `work_commit_statuses` of the Work view Spec.

### Control modules by repo

Each repo in scope: `owner/name`, the default branch, the file branch, the profile, the count and the names of the modules, the Control events state (`on` when the modules list `control_events`), the switch-over date, and the note "Full review data from Control events" or "Forge data only: the Machine gate status, Factory identity reviews and merges" (foreman ADR 0003). A repo with no valid repo config shows its file state.

### Escalations

From the `escalated` events of the last 30 days, in scope:

- One row for each repo and path in `paths`. An event with two paths adds one to each path.
- The row has the count of events, the `path_tier` and the `tier` of the newest event, its pull request with its link from the Work cache, and its `evidence` (`file:line`).
- The order is the count from high to low, then the newest time, then the repo ID and the path.
- The section shows the first 50 rows and "and N more", and the count of paths with 2 or more escalations, with the note "Change the Risk map in a pull request."

### Waivers

- One row for each Waiver in the cached registers of the repos in scope, and one row for each Waiver ID in a `waiver_used` event of the last 30 days that no cached register of its repo has. A Waiver is its repo and its ID.
- A Waiver ID from the events with no register entry shows "not in the register at `<file branch>`" when the register of its repo has the state `ok`, and "register not read" in every other state.
- **Expiry**, against the current UTC date: "expired" when `expires` is today or earlier, as `waivers.py` decides; "expires in N days" when it is 30 days or fewer away, which is the window of the other sections; else "current, N days".
- **Uses:** the count of `waiver_used` events for that Waiver in 30 days, and the newest pull request.
- **Covers:** the kind and its structured fields, as in the scenario "What a Waiver covers".
- The order is the expiry date (expired first), then the repo ID, then the ID. A row with no register entry is last, by repo ID and ID.

### Releases

- One row for each tracker Release in the Work cache, in scope: the repo, the name, the state (`open` or `released`), the count of issues, and the link from the cache.
- **A released Release:** its forge release from the step 2 cache, with its link; its record: the tier, the Release approval ("approved by <login>" with its time, "not needed below <threshold>", "missing", or "not recorded" when `release_approval` is null), and the gaps by kind.
- **An open Release `vX.Y.Z`:** the open pull request whose head branch is `release/X.Y` and whose base is `production`, with its link, its checks and its release review from `work_commit_statuses`. The forge adapter merges only such a pull request into `production` (factory ADR 0015). With no such pull request, the row shows "no release pull request". The record columns show "no Release record before the release".
- A repo whose cached modules do not list `release_record` shows "Release record module off" in place of a missing record.
- The order is the repo ID, then the version by semantic version from high to low.

### Security artefacts

- One row for each repo in scope with its Risk map, Control register and Threat model: each with its state, the first 7 characters of its blob sha, its fetch time, and the summary of the scenario "Security artefacts".
- "Cited Control not in the register" compares the Control IDs of the Threat model with the cached register of the same repo, only when both are `ok`.
- **The Control register list:** each Control with its repo, ID, title, owner, the counts, and its status in the newest valid Release record of its repo (by semantic version), or "not in a Release record".

### Controls API

All routes are below `/api/controls`, and their schemas are in `packages/shared`. Query schemas use `.strict()`. The routes are `public: true` for the reason in the Usage ingest Spec. Each route takes the optional `client` value of the step 2 Spec. The list routes also take the optional `repo` (a repo ID), and `limit` (default 100, maximum 500) and `cursor` by the list conventions of the Work view Spec, and return `nextCursor`. A repo ID outside the `client` gets status 400.

| Route | Returns |
|---|---|
| `GET /` | One document: `state` (`ok`, or `not_connected` when no repo in scope has cache rows), `modules` (one row for each repo in scope), `escalations` (up to 50 rows, the total, the count of repeated paths), `artefacts` (one row for each repo in scope), `skipped` (the counts of the Control event reader and the skipped entries of the parsers) and `complete` (the count of repos in scope with no cache rows or a fetch error) |
| `GET /waivers` | The Waiver rows, in the order above |
| `GET /releases` | The Release rows, in the order above |
| `GET /register` | The Controls, by repo ID, then by Control ID |

All times are UTC, in ISO 8601, and dates are `YYYY-MM-DD`. The responses hold no file content, no Waiver `reason` or `risk`, no Threat model text, no review record, no gap text, no status description and no error message.

### Web app

- This Spec owns `/controls`. The nav shows the link "Controls".
- The layout follows the prototype's "Controls" tab: Control modules by repo, then Escalations, then Waivers and Releases side by side, then Security artefacts with the Control register list. At phone width, they stack.
- The Waivers, Releases and Control register lists use `apps/web/src/list`: the first page, and "Show more" for the next page.
- The web app asks for its routes on load and each 60 seconds while `document.visibilityState` is `visible`, and updates the loaded pages of each list by the list conventions.
- Titles, owners, logins, paths, globs and IDs are React text nodes. Links use only the `link` fields of the cache, with `rel="noopener noreferrer"`.
- Each state has a text label and a colour from the theme tokens. The colours pass 4.5:1 contrast for their text in the light and the dark theme. Dates and times use `apps/web/src/format`.
- Control modules, Waivers, Releases and Security artefacts use the Work cache rows. When one or more repos in scope have no cache rows or a fetch error, each shows "Data is not complete: N repos not connected. See Repos." The words "See Repos" link to the Repos section of the dash. When `state` is `not_connected`, each shows the step 2 "not connected" text. Escalations and the Waiver uses come from the local Control events and still show.

## Gating and rollout

- **Gating:** not required. The view adds a page, routes, cache tables and three read commands. It changes no existing flow.
- **Rollout:** after the step 2 Spec is built. The issues merge one by one into the Integration branch `feature/foreman-v1` (Integrated), in the order of "Build order"; the final pull request of that branch merges into the main branch. The runner change and the contract shapes merge first, with synthetic adapter output. Real data shows after the Operator installs a forge adapter with bebopaloo/factory#120: until then, the installed adapter has no `file get` or `release asset`, and the sections show "adapter error". A schema change needs no data migration: `pnpm reindex` empties the cache, and the next fetch fills it again. To undo, revert the change and run `pnpm local:reindex`.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The view shows the owner and the approver of each Waiver, and the approver of each Release approval. Logins and names of client staff are personal data. Control titles can hold client-confidential words.
- The cache keeps only the parsed fields above, never the content of a file or a record. All data stays on this Mac.
- In a client scope, the view hides the data of other clients.

## Out of scope

- "Review scope of recent reviews". It needs the `review-scope` Control event of factory Spec #85, which no code writes yet.
- The Release approval of an open Release. A valid approval needs the review body to start with the approval text, and the Work cache keeps no review body. The `release-approval` check run is not in the `checks` of the contract. The Release record shows the approval after the release.
- From the prototype: the release dates. The tracker Release and the forge release shapes have no date.
- From the prototype: the Waiver text in Covers. The `reason` and `risk` of a Waiver are free text, so the view shows the structured `covers` fields.
- From the prototype: the state "prepared". The tracker Release state is `open` or `released`.
- From the prototype: the link "Record". The cache has the asset names, not their links, so the view links to the forge release.
- The modules that a repo adds to or removes from its profile, and a check of module names against the catalogue. The catalogue is in the factory-core plugin, and Foreman reads no factory plugin file other than the adapter key of the step 2 Spec.
- The files at the `production` branch. The Release record of each tag holds the Waivers, the Control states and the modules that shipped. This replaces the words "at the main branch and the `production` branch" in the "Security artefacts" decision of foreman ADR 0003 with "at the main branch of the repo"; the ADR needs that amendment.
- Control test results between Releases. They are in JUnit reports of CI, which no read command returns.
- The `factory/machine-gate` status. The Work view Spec reads it.
- Overdue findings (`finding_overdue` events). `factory-next` shows them.
- The `deferred` gate decision and the `deferred` and `deferral_cleared` Control events of factory ADR 0018. The reader of the dash Spec skips and counts them.
- The branch rules of `production` and the deploy environments. The `branch rules` command is not on the allow-list.
- Cloud and CI sessions.
- Any action or write.

## Risks

- **The factory can change a file format.** The parsers follow `risk_tier.py`, `controls.py`, `waivers.py`, `factory_config.py` and `release_record.py`. A change there makes a file "not readable" in Foreman. These formats join the factory-Foreman source contract.
- **Foreman checks less of the `controls` key than the factory.** `factory_config.py` also checks the module names against the catalogue and the needs of each module. A key that Foreman accepts can still make the factory stop the control steps.
- **The error states depend on the message prefixes.** The forge adapter has no error kind. A change of the prefixes `file not found:`, `ref not found:`, `release not found:` or `asset not found:` makes the state "adapter error". The prefixes join the factory-Foreman source contract.
- **A token with no Contents permission looks like a missing file.** The forge then answers 404, and the adapter reports a missing ref or file. The setup steps of the step 2 Spec give the token Contents: read.
- **The forge file step adds calls.** Each forge file step costs one `repo` call, up to five `file get` calls, and the rule files of the Factory health Spec. The step runs each hour, on each full fetch and on each refresh request. A rate limit then makes the repo "partial", by the step 2 rules.
- **The TOML parser can differ from Python's `tomllib`.** Both follow TOML 1.0. The tests parse the factory templates as synthetic fixtures.
- **A Waiver register at the main branch can differ from the register in production.** The Release record shows the Waivers of each Release.

## Build order

Each slice is one pull request into the Integration branch `feature/foreman-v1`, in this order.

1. **Forge file commands.** `apps/api/src/work/contract.ts`, `apps/api/src/work/runner.ts` and their tests: the `repo`, `file get` and `release asset` shapes, the allow-list entries with the five paths of this Spec, and the error prefix map. Needs: the Spec 23 runner and contract (merged). The Spec 71 rule file slice needs this slice.
2. **Forge file step and repo config.** `packages/db/src/schema.ts` and a new migration (`work_forge_files`, the new `work_repos` columns), `apps/api/src/work/fetch.ts`, `apps/api/src/reindex.ts`, `apps/api/src/controls/files.ts` (the repo config parser), `apps/api/src/controls/modules.ts`, and the fetch tests in `apps/api/test/`. Needs: slice 1, and the Spec 23 fetch (#34). The Spec 66 routes slice and the Spec 71 rule file slice need this slice.
3. **Control file parsers.** `apps/api/src/controls/files.ts` gains the Risk map, Control register, Waiver register and Threat model parsers; `apps/api/package.json` and `pnpm-lock.yaml` gain `smol-toml`; the fetch reads the module files. Unit tests with the factory templates as synthetic fixtures. Needs: slice 2.
4. **Release records.** `packages/db/src/schema.ts` and a new migration (`work_release_records`), `apps/api/src/controls/release-records.ts`, `apps/api/src/work/fetch.ts`, and their tests. Needs: slice 1, and the Spec 23 `release view` step.
5. **Controls routes.** `apps/api/src/controls/escalations.ts`, `waivers.ts`, `releases.ts`, `artefacts.ts`, `apps/api/src/routes/controls.ts`, `apps/api/src/app.ts`, `packages/shared/src/controls.ts` and the API tests. Needs: slices 2, 3 and 4, the Spec 24 Control event reader, and the Spec 65 slices for the status step (`work_commit_statuses`) and the list conventions.
6. **Controls page.** `apps/web/src/controls/`, `apps/web/src/nav/`, `apps/web/src/App.tsx`, `e2e/controls.spec.ts`. Needs: slice 5, the Spec 24 nav, the Spec 65 list conventions slice, and the Spec 69 theme and format slices.

## Open questions

- None.
