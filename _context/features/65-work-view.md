# Work view

**Status:** Approved
**Work items:** #65

Source: foreman ADR 0003, factory ADR 0007 (amended 2026-11-14), factory ADR 0012 and factory pull request bebopaloo/factory#120. It builds on the approved Specs [`23-forge-and-tracker-connection.md`](23-forge-and-tracker-connection.md) (issue #34 builds its routes) and [`24-foreman-dash.md`](24-foreman-dash.md). It owns the list conventions that the other views use (`limit`, `cursor`, `nextCursor` and "Show more"), and the `status get` command for the Controls view ([`67-controls-view.md`](67-controls-view.md)). Layout reference: the Claude artifact "Foreman dash prototype", tab "Work" ("Issues and pull requests"). Where the prototype and this Spec differ, this Spec is the master copy.

## Problem

The Operator runs the factory on several repos for several clients. To see one issue with its pull request, its CI result, its **Machine gate** decision, its review round and its **Risk tier**, the Operator opens the tracker, the forge and the Control events of each repo, one by one. The **Foreman dash** shows only counts and the items that wait for the Operator. It does not list every issue and pull request.

The Operator also shows the work of one client to stakeholders and auditors. An audit needs one list that goes from an issue to its pull request and its gate state, with links out to the tracker and the forge.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator opens the **Work view** to find an issue, to filter the work and to follow a link to the tracker or the forge.
- **Stakeholders and auditors of one client**: they see the Work view only in a screen share by the Operator, in that client's **Client scope**.
- **The other views**: they use the list conventions of this Spec, and the Controls view reads the `factory/release-review` statuses that the status step of this Spec caches.

## Acceptance criteria

Fixtures are synthetic: a synthetic repo list, synthetic Control event files, a seeded **Work cache** and the synthetic adapter of the step 2 Spec. No real issue, repo, login or commit goes into the repo. In the scenarios, `A` and `B` stand for two different 40-character hex commit shas.

### An issue with its pull request

- **Given** the repo `acme/app` with issue 12 "Add the export", open, Issue state IN REVIEW, priority `high` and the label `type:feature`
- **And** pull request 40, open, with the head branch `12-add-the-export`, `checks` `success`, the label `risk:sensitive` and the head sha `A`
- **And** a cached `factory/machine-gate` status `pass` on `A`
- **And** `gate` Control events for pull request 40 of `acme/app`: round 1 `fail` and round 2 `pass`
- **When** the Operator opens `/work`
- **Then** the row shows `acme/app`, `#12`, "Add the export", IN REVIEW, `feature`, `high`, `#40`, `success`, `pass`, `2`, `sensitive`, an Issue link and a PR link.

### An issue with no pull request

- **Given** issue 15 in READY, and no pull request whose head branch starts with `15-`
- **When** the Operator opens `/work`
- **Then** the row of issue 15 shows "—" in PR, CI, Machine gate, Round and Risk tier, and has only an Issue link.

### The branch prefix links a pull request to its issue

- **Given** issues 12 and 123, and a pull request with the head branch `123-fix-the-total`
- **When** the API builds the rows
- **Then** the pull request is in the row of issue 123
- **And** the row of issue 12 has no pull request.

### Two pull requests for one issue

- **Given** issue 12, a closed pull request 40 and an open pull request 44, both with head branches that start with `12-`
- **When** the API builds the rows
- **Then** the row of issue 12 shows `#44` and "1 more"
- **And** when both pull requests are closed, the row shows `#44`, the higher number
- **And** pull request 40 has no row of its own.

### A pull request with no issue

- **Given** an open pull request 50 "Release 1.2" with the head branch `release/1.2`, and a pull request 51 with the head branch `20-old-work` in a repo with no cached issue 20
- **When** the Operator opens `/work`
- **Then** each pull request has its own row, with "—" in Issue, Type and Priority, the pull request title in Title, and "no issue" in State
- **And** each row has only a PR link.

### The Machine gate from the forge status

- **Given** pull request 40 with the head sha `A`, a cached `factory/machine-gate` status `pending` on `A`, and a newest `gate` Control event `fail` for pull request 40
- **When** the API builds the row
- **Then** Machine gate shows "pending" with the source "forge".

### The Machine gate from the Control events

- **Given** a cached pull request 40 with no head sha, because the installed adapter is older than bebopaloo/factory#120, and a newest `gate` Control event `blocked` in round 3 for pull request 40
- **When** the API builds the row
- **Then** Machine gate shows "blocked (event)" with the source "Control events"
- **And** with no `gate` event for pull request 40 in 30 days, Machine gate shows "—".

### A status for an older head commit

- **Given** a cached status `pass` on `A`, and a later fetch that lists pull request 40 with the head sha `B` and whose `status get B factory/machine-gate` fails with `timeout`
- **When** the API builds the row
- **Then** Machine gate does not use the status on `A`, and uses the `gate` Control events by the rule of the scenario above
- **And** the repo's forge state is "partial".

### No status on the head commit

- **Given** pull request 40 with the head sha `B`, and a cached status `none` on `B`
- **When** the API builds the row
- **Then** Machine gate shows "not set" with the source "forge".

### Machine gate status reads in a fetch

- **Given** a first fetch of a repo with 2 open and 3 closed pull requests, each with a `head_sha`, and none of them from `release/*`
- **When** the fetch runs, and then a later fetch runs in which 1 closed pull request has a new head sha
- **Then** the first fetch runs `status get <head_sha> factory/machine-gate` once for each of the 5 pull requests
- **And** the later fetch runs it for the 2 open pull requests and the 1 closed pull request with the new head sha, and for no other pull request
- **And** a full fetch runs it for each listed pull request.

### Release review status reads in a fetch

- **Given** an open pull request 330 with the head branch `release/2.3`, the base `production` and the head sha `B`; an open pull request 331 with the head branch `release/2.4-try` and the base `production`; and a closed pull request 300 with the head branch `release/2.2` and the base `production`
- **When** a fetch runs
- **Then** the fetch runs `status get B factory/release-review` for pull request 330, in each fetch
- **And** it runs no `factory/release-review` read for pull requests 331 and 300.

### The status command on the allow-list

- **Given** the runner
- **When** a code path asks for `status get <40 hex characters> factory/machine-gate`, `status get <40 hex characters> factory/release-review`, `status get abc123 factory/machine-gate`, `status get <40 hex characters> factory/other` and `status set <40 hex characters> factory/machine-gate pass`
- **Then** the runner accepts the first two commands
- **And** it refuses the other three before a subprocess starts.

### Status output that breaks the contract

- **Given** a `status get A factory/machine-gate` whose output has the sha `B`, the context `factory/release-review`, the state `green`, or an unknown key
- **When** the fetch reads it
- **Then** Foreman does not store it, and the pull request gets the details error class `invalid_output`
- **And** Foreman never stores the status `description`.

### Pull request output with and without a head sha

- **Given** adapter output for `pr list --state all` with one pull request that has `head_sha` `A`, one that has no `head_sha`, and one whose `head_sha` is `abc`
- **When** a fetch reads it
- **Then** Foreman refuses the whole output as "invalid adapter output", by the step 2 rule
- **And** output in which every pull request has a valid `head_sha`, or in which no pull request has it, is stored.

### Round from the gate events

- **Given** `gate` Control events for pull request 40 of `acme/app` in rounds 1, 2 and 3, a round 2 event for pull request 40 of `acme/web`, and a round 1 event for pull request 41 of `acme/app` that is 31 days old
- **When** the API builds the rows
- **Then** the row of pull request 40 of `acme/app` shows Round `3`
- **And** the row of pull request 41 shows Round "—".

### A repo with no Control events

- **Given** the connected repo `acme/web` with cached pull requests and no Control event in 30 days
- **When** the Operator opens `/work`
- **Then** the page shows "No Control events in 30 days for `acme/web`. Round and the event Machine gate show —."
- **And** its rows still show CI, the forge Machine gate status and the Risk tier.

### Risk tier from the labels

- **Given** pull request 40 with the labels `risk:general` and `risk:authority`, pull request 41 with the label `risk:extreme` only, and pull request 42 with no `risk:*` label
- **When** the API builds the rows
- **Then** the Risk tier of pull request 40 is `authority`, the highest tier
- **And** pull requests 41 and 42 show "—".

### Issue type from the labels

- **Given** issue 12 with `type:fix`, issue 13 with no `type:*` label, and issue 14 with `type:fix` and `type:chore`
- **When** the API builds the rows
- **Then** the Type of issue 12 is `fix`, of issue 13 "—", and of issue 14 "more than one type".

### A closed issue with no end state

- **Given** a closed issue whose Issue state is TODO, because it has no `state:*` label
- **When** the Operator opens `/work`
- **Then** its State shows "TODO · closed".

### Filter by Issue state

- **Given** rows in scope: 3 READY issues, 2 BLOCKED issues, 1 DONE issue and 1 pull request with no issue
- **When** the Operator opens `/work`
- **Then** the state filter shows "All 7", "TODO 0", "READY 3", "IN PROGRESS 0", "IN REVIEW 0", "BLOCKED 2", "DONE 1", "CANCELLED 0" and "No issue 1"
- **And** when the Operator chooses BLOCKED, the table shows the 2 BLOCKED rows, and the URL has `issue_state=BLOCKED`.

### Filter by type, priority and repo

- **Given** in `acme/app`: 2 `feature` issues with priority `high`, 1 `fix` issue with priority `high` and 1 `feature` issue with priority `low`; and in `acme/web`: 1 `feature` issue with priority `high`
- **When** the Operator chooses the type `feature`, the priority `high` and the repo `acme/app`
- **Then** the table shows the 2 rows that match all three filters
- **And** the state filter counts use the type, priority and repo filters, so "All" shows 2.

### A type or priority filter leaves out rows with no issue

- **Given** 1 issue with no `type:*` label and priority `none`, and 1 pull request with no issue
- **When** the request has `type=none`, or `priority=none`
- **Then** the response has the issue row and not the pull request row.

### Sort

- **Given** issues with the priorities `low`, `highest`, `none` and `high`, and 1 pull request with no issue
- **When** the request has `sort=priority`
- **Then** the rows come in the order `highest`, `high`, `low`, `none`, then the pull request with no issue
- **And** with `sort=state`, the rows come in the order TODO, READY, IN PROGRESS, IN REVIEW, BLOCKED, DONE, CANCELLED, then the rows with no issue
- **And** with no `sort`, the rows come by `owner/name`, then by number from high to low.

### Paging

- **Given** 230 rows in scope
- **When** the web app asks for `/api/work/items` with no `limit`, and then with each `nextCursor`
- **Then** the responses have 100, 100 and 30 rows, and the last `nextCursor` is null
- **And** a request with `limit=501`, `limit=0`, a cursor that is not valid, or a cursor from a request with another `sort`, `issue_state`, `type`, `priority`, `repo` or `client` value gets status 400.

### Show more

- **Given** 230 rows in scope
- **When** the Operator opens `/work` and chooses "Show more" two times
- **Then** the table shows 100, then 200, then 230 rows, and the button no longer shows
- **And** after each choice, the focus moves to the first new row.

### Query values that are not valid

- **Given** a running API
- **When** a request to `/api/work/items` has `issue_state=DOING`, `type=bug`, `sort=title` or the unknown key `q`
- **Then** the API rejects it with status 400
- **And** when the Operator opens `/work?issue_state=DOING`, the page shows "This link has a filter value that is not valid." with a link to `/work` in the same scope, and no rows.

### Work in a client scope

- **Given** 4 issues of `acme`, 2 issues of `globex`, and 1 issue of a repo with no client
- **When** the web app asks for `/api/work/items` with `client=acme`, and then with no `client`
- **Then** the first response has only the 4 issues of `acme`, and its `counts` count only them
- **And** the second response has all 7 issues
- **And** a request with `client=acme` and the repo ID of a `globex` repo gets status 400.

### The repo filter in a client scope

- **Given** the scope `acme`, with the repos `acme/app` and `acme/web`
- **When** the Operator opens the repo filter
- **Then** it lists "All repos", `acme/app` and `acme/web`, and no repo of another client.

### An item that drops out of the list

- **Given** a cached closed issue with `stale: true`
- **When** the Operator opens `/work`
- **Then** its row shows the marker "not in the last fetch".

### Some repos not connected

- **Given** 3 repos in scope, of which 1 has no cache rows because it has no token
- **When** the Operator opens `/work`
- **Then** the table shows the rows of the 2 connected repos
- **And** the page shows "Data is not complete: 1 repo not connected. See Repos.", with "Repos" as a link to the Repos section of the dash in the same scope.

### Not connected

- **Given** no repo in scope with cache rows
- **When** the Operator opens `/work`
- **Then** the page shows "Not connected. Add the Foreman token to FOREMAN_TOKENS_JSON in the .env file, then restart pnpm dev." and no table.

### Malformed Control events

- **Given** a Control event file with one line that is not valid JSON and one `gate` event with `round` 4
- **When** the API builds the rows
- **Then** it uses the other events and counts 2 skipped Control events in `skipped`
- **And** the log shows the file name and the count, with no line content.

### Titles stay plain text

- **Given** an issue title `<img src="https://evil.example/t.png"> **Fix** [this](https://evil.example)`
- **When** the Work view shows it
- **Then** the page shows the title text as it is, with no image, no bold and no link
- **And** the browser makes no request to `evil.example`.

### Links from the cache only

- **Given** an issue whose cached link is null, because its `url` failed the step 2 link check, and its pull request with a valid link
- **When** the Operator opens `/work`
- **Then** the row has the PR link and no Issue link.

### No text beyond the structured fields

- **Given** cached issues and pull requests, a cached status, and `gate` events with `counts`, `categories` and `refs`
- **When** the web app asks for `/api/work/items`
- **Then** the response holds no issue body, no pull request body, no review body, no status description and no Control event key other than `round` and `decision`.

### Live update

- **Given** the Work view is open in a visible tab with 200 rows loaded in 2 pages
- **When** 60 seconds pass
- **Then** the web app asks for the first page again with no cursor, and then for one more page with the new `nextCursor`, and shows the new rows in place of the old rows
- **And** while the tab is hidden, it does not ask.

### The view in the header

- **Given** the web app
- **When** the Operator opens any page in the scope `acme`
- **Then** the header nav has the link "Work" to `/work?client=acme`
- **And** on `/work`, the link has `aria-current="page"`.

### Accessibility

- **Given** each fixture set of the scenarios "An issue with its pull request", "A pull request with no issue", "Filter by Issue state", "Show more", "Query values that are not valid", "Some repos not connected" and "Not connected", from a seeded Work cache and synthetic Control event files
- **When** the end-to-end test opens `/work` with each set, in the light theme and in the dark theme
- **Then** the axe scan finds no WCAG 2.2 AA violation
- **And** each Issue state, Machine gate and Risk tier value has a text label as well as a colour.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/work/contract` | The pull request shape gains the optional `head_sha`. The new `status get` output shape. |
| `apps/api/src/work/runner` | The command allow-list gains `status get <sha> <context>` for the two contexts below |
| `apps/api/src/work/fetch` | Gains the status step and the linked issue number of each pull request |
| `apps/api/src/work/gate-signals` | The highest round and the newest decision of each pull request, from the Control events of the last 30 days |
| `apps/api/src/work/items` | The Work rows: the link of issues and pull requests, the filters, the sort, the cursor and the counts |
| `apps/api/src/paging` | The list conventions on the API side: the cursor codec and the page cut (below). Every list route of every view uses it. |
| `apps/api/src/dash/control-events` | The Control event reader of the dash Spec. The Work view uses it as it is. |
| `apps/api/src/routes/work.ts` | Gains `GET /api/work/items` |
| `packages/db` schema | New columns and an index on `work_pull_requests`, and the new table `work_commit_statuses` (below) |
| `packages/shared` | The list conventions on the schema side (`PageQuery` and `nextCursor`), and the Zod schemas of the items query and response |
| `apps/web/src/list` | The list conventions in the browser: the paged list, "Show more" and the 60-second update of loaded pages. Every paged list of every view uses it. |
| `apps/web/src/work` | The Work page: the filters, the table and the notes |
| `apps/web/src/nav` | Gains the link "Work" |
| `e2e/work.spec.ts` | The end-to-end tests with the axe scan |

The Work page uses `apps/web/src/theme` (the colour tokens) and `apps/web/src/format` (times and numbers) of the Usage view Spec (69). It does not define its own tokens or formats.

### Configuration

No new variable. The variables of the step 2 Spec and the dash Spec do not change.

### Dependencies on the factory

- **The head commit in the pull request shape.** Factory pull request bebopaloo/factory#120 adds `head_sha` to the pull request output of `pr list` and `pr view`. It is the full 40-character sha of the head commit. The contract shape in `tests/contract/` gains it. This Spec treats `head_sha` as present. By the contract rule of the step 2 Spec, the Foreman change ships first, so Foreman also accepts output with no `head_sha` from an older installed adapter.
- **The status command.** `status get <sha> <context>` exists in the forge adapter today. It returns `{"sha", "context", "state", "description"}`, with `state` `pass`, `fail`, `pending` or `none`.

While the cache has no head sha for a pull request, Foreman runs no `status get` for it, and the Machine gate column uses the Control events. Foreman's tests use the synthetic adapter, so they do not wait for the factory work item.

### Data sources of the columns

| Column | Source | Rule |
|---|---|---|
| Repo | Work cache, `work_repos` | `owner/name` |
| Issue | Work cache, `work_issues` | The issue number, or "—" in a row with no issue |
| Title | Work cache | The issue title, or the pull request title in a row with no issue |
| State | Work cache, `work_issues` | The Issue state. A closed issue whose Issue state is not DONE or CANCELLED adds "closed". A row with no issue shows "no issue". |
| Type | Work cache, issue labels | The **Issue type**: `feature`, `fix` or `chore` from one `type:*` label. No label: "—". More than one: "more than one type". |
| Priority | Work cache, issue `priority` | `highest`, `high`, `medium`, `low`, or "—" for `none` |
| PR | Work cache, `work_pull_requests` | The linked pull request (below), with its state and a draft marker, and "N more" for its other linked pull requests |
| CI | Work cache, pull request `checks` | `success`, `failure`, `pending` or "no checks" for `none`. It leaves out the `factory/*` statuses, by the forge contract. |
| Machine gate | The cached `factory/machine-gate` status, else `gate` Control events | By the rule in "Machine gate" below |
| Round | `gate` Control events, last 30 days | The highest `round` of the pull request's `gate` events, else "—" |
| Risk tier | Work cache, pull request labels | The highest tier of the pull request's `risk:<tier>` labels, from `authority` down to `inert`. A label with another tier word is ignored. No such label: "—". |
| Links | Work cache, `link` fields | The Issue link and the PR link, only where the cache has a link, by the step 2 link rules |

### The linked pull request

- The factory names the branch of an issue `<issue>-<slug>` (`to-code`), and the docs pull request of a Spec `<issue>-spec-<slug>`. The fetch stores the linked issue number of each pull request: the number in its head branch before the first `-`, when the head branch matches `^[1-9][0-9]{0,9}-`. Else the pull request has no linked issue number.
- A pull request links to the issue with that number in the same repo, when the cache has that issue.
- When two or more pull requests link to one issue, the row shows one: the open pull request with the highest number, else the pull request with the highest number. The row counts the others as "N more". They have no row of their own.
- A pull request that links to no cached issue has its own row. Examples: a release pull request from `release/X.Y`, the final pull request of an Integrated feature from `feature/<slug>`, and a pull request of the Operator with another branch name.

### Machine gate

The factory posts the **Machine gate** decision as the `factory/machine-gate` commit status on the head commit, and writes a `gate` Control event for each decision (`review-pr`). The status is `pass` for `pass`, `pending` for `wait` and for a new head commit before the next round, and `fail` for `fail` and `blocked`. The two sources use different words:

| Source | Values | Shown as |
|---|---|---|
| Status on the head commit | `pass`, `fail`, `pending`, `none` | "pass", "fail", "pending", "not set" |
| Newest `gate` event | `pass`, `fail`, `wait`, `blocked` | "pass (event)", "fail (event)", "wait (event)", "blocked (event)" |

- When `work_commit_statuses` has a `factory/machine-gate` row for the pull request whose sha equals the pull request's cached head sha, the column shows that status, with the source "forge". The forge status is the value that branch protection reads.
- Else, the column shows the decision of the newest `gate` event of the pull request in the last 30 days, with the source "Control events". Its round is not always the round of the current head commit, so the text "(event)" marks it.
- Else the column shows "—".
- A `gate` event belongs to the pull request whose repo `owner/name` equals its `repo` in lower case, and whose number equals its `pr`. The dash Spec gives the reader, the window, the validation and the skip counts.

### Fetch changes

These add to the fetch of the step 2 Spec. Its other rules do not change.

- **The allow-list.** The runner accepts this Forge command. Any other context, sha shape or option is refused before a subprocess starts.

  | Role | Command | Rule |
  |---|---|---|
  | Forge | `status get <sha> <context>` | `<sha>` matches `^[0-9a-f]{40}$`. `<context>` is exactly `factory/machine-gate` or `factory/release-review`. |

- **The contract.** The pull request shape accepts an optional `head_sha` that matches `^[0-9a-f]{40}$`. In one list output, every pull request has `head_sha`, or none has it; else the output is "invalid adapter output". The `status get` output shape is exactly `sha`, `context`, `state` (`pass`, `fail`, `pending` or `none`) and `description`. Foreman refuses an output whose `sha` or `context` differs from the request.
- **The status step.** After step 3 of the step 2 fetch, for each listed pull request with a `head_sha`:
  - `status get <head_sha> factory/machine-gate` when the pull request is open, or when its cached `factory/machine-gate` row has another sha, or when it has no such row. A full fetch runs it for each listed pull request with a `head_sha`.
  - `status get <head_sha> factory/release-review` when the pull request is open, its head branch matches `^release/[0-9]+\.[0-9]+$` and its base is `production`. This is the release pull request of factory ADR 0015: the forge adapter merges only such a pull request into `production`. The step runs it in each fetch, because the release review can change on the same head commit.
- **The linked issue number.** The fetch calculates it from the head branch when it writes the pull request row.
- **Failures.** A `status get` that fails leaves the cached row as it is, marks the pull request with the error class in its details error class, and makes the repo "partial", by the step 2 detail rules. Its errors map by the error table of the step 2 Spec.
- Foreman stores the status `state` and `sha`, and never the `description`, because the description is free text.

### Work cache changes (Postgres)

| Table | Change |
|---|---|
| `work_pull_requests` | New columns: head sha (or none), linked issue number (or none) |
| `work_commit_statuses` | New table: repo ID, pull request number and context (primary key), sha, state, fetch time |

A new index on the repo ID and the linked issue number of `work_pull_requests`, and an index on the repo ID of `work_commit_statuses`. All times are `timestamp with time zone`, in UTC. The cache stores no status description. `pnpm reindex` empties the new table with the other work tables. The migration adds columns that can be empty, so the step 2 rows stay valid, and the next fetch fills them.

### List conventions

This Spec owns these rules. Every list route and every paged list of every view uses them, and does not define them again.

- **Query.** A list route takes `limit` and `cursor`. Each route names its default and its maximum `limit`. A `limit` below 1 or above the maximum gets status 400.
- **Response.** A list response has `nextCursor`: the cursor of the next page, or null on the last page.
- **Cursor.** An opaque base64url value of a JSON object that holds the sort key of the last row of the page, and the query values that decide the rows and their order. `apps/api/src/paging` validates the decoded object with Zod. A cursor that does not decode, fails the schema, or holds other query values than the request gets status 400.
- **Order.** Each route names a total order, with a unique last key, for example the repo ID and the number. Thus no row shows twice.
- **Show more.** The page shows the first page. A "Show more" button below the list loads the next page and adds its rows. The button shows only while `nextCursor` is not null. After a load, the focus moves to the first new row, and a live region says "N more rows shown".
- **Live update.** When a view updates a paged list, it asks again for the first page, with no cursor. Then it asks for as many more pages as it had loaded, each with the new `nextCursor`. It shows the new rows in place of the old rows.

### Work API

`GET /api/work/items`. The schemas are in `packages/shared`. The query schema uses `.strict()`. The route is `public: true` for the reason in the Usage ingest Spec. The step 2 routes `GET /api/work/issues` and `GET /api/work/pull-requests` do not change. They return two separate lists, so they cannot filter or page the joined rows, and they have no Control event data. The Work view uses `GET /api/work/repos` for the repo filter and `GET /api/work/status` for the connection state, as they are.

| Query value | Values |
|---|---|
| `client` | The client of the step 2 Spec |
| `repo` | A repo ID. A repo ID that does not belong to the `client` gets status 400. |
| `issue_state` | `TODO`, `READY`, `IN PROGRESS`, `IN REVIEW`, `BLOCKED`, `DONE`, `CANCELLED`, or `none` for the rows with no issue |
| `type` | `feature`, `fix`, `chore`, `multiple` or `none` |
| `priority` | `highest`, `high`, `medium`, `low` or `none` |
| `sort` | `repo` (the default), `priority` or `state` |
| `limit` | 1 to 500, default 100 |
| `cursor` | The `nextCursor` of the response before |

- **Rows.** Each cached issue of a repo in scope is one row. Each cached pull request in scope that links to no cached issue is one row. A `type` or `priority` value leaves out the rows with no issue.
- **Sort.** `repo`: by `owner/name`, then by number from high to low. `priority`: `highest`, `high`, `medium`, `low`, `none`, then the rows with no issue, and in each group by `owner/name`, then by number from high to low. `state`: the Issue states in the order of the `issue_state` table, then the rows with no issue, and in each group by `owner/name`, then by number from high to low. The number of a row is the issue number, or the pull request number in a row with no issue. The last key of each order is the repo ID, then the row kind (issue or pull request), then the number.
- **Queries.** The API reads the issues, the pull requests and the statuses of the repos in scope in three queries, and builds the rows, the counts and the page in memory. It runs no query for each row. The Work cache holds at most the open items and the 100 newest closed items of each list for each repo, and the items that dropped out of a list.

The response:

| Part | Holds |
|---|---|
| `state` | `ok`, or `not_connected` when no repo in scope has cache rows |
| `items` | The rows of this page. Each row: repo ID, `owner/name`, client; the issue (number, title, state, Issue state, type, priority, link, `stale`) or null; the linked pull request (number, title, state, draft, `checks`, link, `stale`, count of other linked pull requests) or null; the Machine gate (value and source) or null; the round or null; the Risk tier or null |
| `nextCursor` | The cursor of the next page, or null |
| `counts` | The count of rows for each `issue_state` value and for "All", with the `client`, `repo`, `type` and `priority` values of the request, and with no `issue_state` value |
| `complete` | The count of repos in scope with no cache rows or a fetch error |
| `noControlEvents` | The repo IDs of the connected repos in scope with no Control event in the last 30 days |
| `skipped` | The counts of skipped Control event lines and files, by the dash Spec |

All times are UTC, in ISO 8601. The response holds no body of an issue, a pull request or a review, no status description, and no Control event key other than the `round` and the `decision` of `gate` events.

### Web app

- This Spec owns `/work`. The header nav of the dash Spec (`apps/web/src/nav`) shows the link "Work", and the link keeps the `client` value.
- The header of the step 2 Spec shows the Client scope, the connection state, the oldest "data as of" time of the repos in scope and the Refresh button. The Work view adds no second copy of them.
- The layout follows the prototype's "Work" tab: the heading "Issues and pull requests", the source note "Source: tracker and forge (Work cache) and Control events. Titles only, no body text.", the filters, then the table.
- **Filters.** The state filter is a group of toggle buttons with `aria-pressed` and a count from `counts`: All, the seven Issue states and "No issue". The type, priority and repo filters and the sort are `<select>` elements with labels. The repo filter lists "All repos" and the repos in scope from `GET /api/work/repos`. Each filter and the sort are values in the URL, next to `client`, so a link keeps them. A change of a filter or the sort starts again at the first page.
- **Values that are not valid.** The web app validates the URL values with the shared Zod schema. A value that is not valid shows "This link has a filter value that is not valid." with a link to `/work` in the same scope, and no rows. It does not drop the value in silence.
- **Table.** An HTML `<table>` with a `<caption>`, and `<th scope="col">` for Repo, Issue, Title, State, Type, Priority, PR, CI, Machine gate, Round, Risk tier and Links. The table is in a region with `tabindex="0"` and an accessible name, which scrolls sideways at narrow widths. The page itself does not scroll sideways.
- **Values.** Each Issue state, Machine gate and Risk tier value is a text label with a colour from the theme tokens. The colours pass 4.5:1 contrast for their text in the light and the dark theme. The Machine gate column header has a description: "The factory/machine-gate status of the head commit. (event): the newest gate Control event, when the forge has no status for the head commit."
- **Links.** Each link uses only the `link` field of the API, with `rel="noopener noreferrer"`. The accessible name names the item, for example "Issue 12 of acme/app in the tracker" and "Pull request 40 of acme/app in the forge".
- **Markers.** A row with `stale: true` shows "not in the last fetch". A draft pull request shows "draft".
- **Notes.** For each repo in `noControlEvents`: "No Control events in 30 days for `<owner/name>`. Round and the event Machine gate show —." When `complete` is 1 or more: "Data is not complete: N repos not connected. See Repos.", with "Repos" as a link to the Repos section of the dash in the same scope. When `state` is `not_connected`: the step 2 "not connected" text, and no table.
- **Paging and live update.** By the list conventions above. The web app updates the loaded pages each 60 seconds while `document.visibilityState` is `visible`, and after a Refresh in the header.
- Titles, labels and repo names are React text nodes, by the step 2 rules.

## Gating and rollout

- **Gating:** not required. The feature adds a view, a route, an allow-listed read command, a cache table and columns that can be empty. It changes no existing flow.
- **Rollout:** after the step 2 issues for the Work cache and its routes (issue #34) and the dash issues for the nav and the Control event reader. The issues merge one by one into the Integration branch `feature/foreman-v1` (Integrated), in the order of "Build order"; the final pull request of that branch merges into the main branch. The view works before the installed adapter has `head_sha`: the Machine gate column then uses the Control events only. A schema change needs no data migration: `pnpm reindex` empties the cache, and the next full fetch fills it again.
- **Undo:** revert the merged pull requests. The view stores nothing of its own. The new columns can stay empty, and the new table can stay.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The view shows issue and pull request titles, labels and repo names from the step 2 cache, and the round and decision of `gate` events. It adds the head sha and the two factory statuses to the cache. A commit sha is not personal data.
- The view shows no login. The status description is free text, so Foreman does not store it.
- In a client scope, the view, its counts and its repo filter hold no data of another client.

## Out of scope

- Any action or write: no change of an issue, a label, a pull request or a status. The Operator acts with `factory-next` and the factory skills.
- The bodies of issues, pull requests, comments, review threads and reviews, and the findings of a review.
- "Review scope of recent reviews". It needs the `review-scope` Control event of factory Spec #85, which no code writes yet.
- Overdue findings (`finding_overdue` events). `factory-next` shows them.
- The `deferred` gate decision and the `deferred` and `deferral_cleared` Control events of factory ADR 0018. The `control_events.py` writer does not have them yet, so the reader of the dash Spec skips and counts them.
- Cloud and CI sessions.
- The display of the `factory/release-review` status and of the Release approval. This Spec only caches the status; the Controls view shows it.
- A Release column or filter. The Controls view shows the Releases.
- The link of the final pull request of an Integrated feature (`feature/<slug>`) to its Spec issue. The slug is in the repo's `_context/features/`, which this view does not read; the pull request has its own row.
- Filters by CI, Machine gate, Round or Risk tier, and a search in titles.
- A tree of parent and child issues.
- Links from the dash pipeline strip into the Work view.
- From the prototype: the note "Foreman builds every link from the configured host and an ID". It contradicts the step 2 link rule, which takes each link from the adapter `url` field. The page shows the source note of this Spec.
- From the prototype: "blocked" as a forge Machine gate value. The forge status has no such value; the view shows "blocked (event)" only from a `gate` event.

## Risks

- **A branch name can link the wrong pull request.** A pull request from another author whose head branch starts with `12-` links to issue 12. The forge contract has no field that ties a pull request to its issue. The PR link lets the Operator check it.
- **The Control events cover 30 days.** A pull request whose last `gate` event is older shows Round "—", and an event Machine gate "—". The forge status still shows when the cache has one.
- **The event Machine gate can be older than the head commit.** After a push with no new round, the newest `gate` event belongs to an earlier commit. The text "(event)" marks it, and the forge status replaces it when the installed adapter gives `head_sha`.
- **The status step adds forge calls.** Each open pull request costs one more call in each fetch, an open release pull request one more, and a full fetch one call for each listed pull request. A rate limit then makes the repo "partial", by the step 2 rules.
- **The row count can change between pages.** A fetch that runs between two pages can move a row. The cursor keeps the order, so no row shows twice, but a row can move past the cursor. The next live update shows it.

## Build order

Each slice is one pull request into the Integration branch `feature/foreman-v1`, in this order.

1. **Status contract and allow-list.** `apps/api/src/work/contract.ts`, `apps/api/src/work/runner.ts` and their tests: the optional `head_sha`, the "every or none" rule, the `status get` shape, and the allow-list entry for the two contexts. Needs: Spec 23 runner and contract (merged).
2. **Status step and cache.** `packages/db/src/schema.ts` and a new migration (the two columns, the table `work_commit_statuses`, the indexes), `apps/api/src/work/fetch.ts`, `apps/api/src/reindex.ts` and the fetch tests in `apps/api/test/`. Needs: slice 1, and the Spec 23 fetch (#34).
3. **List conventions.** `packages/shared/src/paging.ts`, `apps/api/src/paging.ts`, `apps/web/src/list/` and their unit and component tests. When the Spec 23 routes already have a cursor codec, this slice moves it to `apps/api/src/paging.ts` and keeps their behaviour. Needs: nothing of this Spec. The paged lists of Specs 66, 67, 68, 70 and 71 need this slice.
4. **Items route.** `apps/api/src/work/gate-signals.ts`, `apps/api/src/work/items.ts`, `apps/api/src/routes/work.ts`, `packages/shared/src/work.ts` and the API tests. Needs: slices 2 and 3, and the Spec 24 Control event reader (`apps/api/src/dash/control-events`).
5. **Work page.** `apps/web/src/work/`, `apps/web/src/nav/`, `apps/web/src/App.tsx`, `e2e/work.spec.ts`. Needs: slice 4, the Spec 23 header (`apps/web/src/scope`, `apps/web/src/connection`), the Spec 24 nav, and the Spec 69 theme and format slice (`apps/web/src/theme`, `apps/web/src/format`).

## Open questions

- None.
