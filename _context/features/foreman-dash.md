# Foreman dash

**Status:** Approved
**Work items:** #24

Source: foreman ADR 0003, factory ADR 0007 (amended 2026-11-14), step 3 of the build order. It builds on the approved Spec [`forge-and-tracker-connection.md`](forge-and-tracker-connection.md). Layout reference: the Claude artifact "Foreman dash prototype" (https://claude.ai/artifact/PkocXnpXR2fH717xH8VTNn), tab "Foreman dash". Where the prototype and this Spec differ, this Spec is the master copy.

## Problem

The Operator runs the factory overnight on several repos for several clients. To learn what the factory did, what it does now and what waits for the Operator, the Operator runs `factory-next` or opens the tracker, the forge and the night log for each repo. Nothing shows in one place whether the factory builds in parallel, whether the reviews run and pass, or which repo is not connected.

The Operator also shows the factory to stakeholders of one client. A demo needs one page that shows the work, the parallel builds and the review health of that client only.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator opens the **Foreman dash** to check progress and control health, and to see what waits for a decision.
- **Stakeholders of one client**: they see the dash only in a screen share by the Operator, in that client's **Client scope**.

## Acceptance criteria

Fixtures are synthetic: a synthetic repo list, night log, run lock, Control events and work cache. No real issue, repo or log goes into the repo.

### The dash is the start view

- **When** the Operator opens Foreman at `/`
- **Then** Foreman shows the **Foreman dash**, with the sections Now, Waits for you, Last run, Review health and Repos, in that order
- **And** the header shows the Client scope, the connection state and the Refresh button of the step 2 Spec.

### A run in progress

- **Given** a run lock with a heartbeat 4 minutes ago, and night log lines of that run with 3 builds started and none ended
- **When** the dash loads
- **Then** Now shows "Run in progress" with the heartbeat age
- **And** Last run shows that run, with 3 open bars that end at the current time.

### A stale lock

- **Given** a run lock with a heartbeat more than 3 hours (10,800 seconds) ago
- **When** the dash loads
- **Then** Now shows "No run in progress" and "a stopped run left a stale lock".

### No run yet

- **Given** no night log file in the last 31 days, and no run lock
- **When** the dash loads
- **Then** Now shows "No run in progress"
- **And** Last run shows "No run in the last 30 days".

### An unreadable lock

- **Given** a run lock that is not valid JSON on two reads 100 ms apart
- **When** the dash loads
- **Then** Now shows "run lock unreadable", and the lock counts in `skipped`.

### No gate decision

- **Given** no `gate` event with a round 1 decision `pass` or `fail` in 30 days
- **When** the dash loads
- **Then** the tile shows "First-round pass: no gate decision in 30 days".

### Tiles

- **Given** a last run with 6 builds, of which 2 merged, at most 4 at one time, 5 items that wait for the Operator, and 10 pull requests with a first-round `gate` decision in 30 days, of which 7 passed
- **When** the dash loads
- **Then** the tiles show "Builds in the last run: 6, peak 4 at one time", "Merged in the last run: 2", "Waits for you: 5" and "First-round pass: 70% of 10 pull requests, last 30 days"
- **And** a rate of 2 of 3 shows as 67%.

### The pipeline strip

- **Given** open cached issues: 2 TODO without `spec-approved`, 1 TODO with `spec-approved` and without `issues-approved`, 1 TODO with `issues-approved`, 1 TODO with `finding`, 3 READY, 2 IN PROGRESS, 2 IN REVIEW of which 1 has `merge-ready`, and 1 BLOCKED; closed cached issues: 5 DONE of which 1 has `merge-ready`, and 2 with no state label; and 1 open pull request into `production`
- **When** the dash loads
- **Then** the strip shows G1 Spec 2, G2 Issues 1, READY 3, IN PROGRESS 2, IN REVIEW 1, BLOCKED 1, DONE 5 and G3 2
- **And** the closed issues with no state label, the TODO issue with `issues-approved` and the TODO issue with `finding` show in no stage.

### Builds in a client scope

- **Given** a run in progress, 2 running builds of `acme` and 2 of `globex` in enabled repos, and 1 IN PROGRESS issue in a repo with `enabled` false
- **When** the dash loads with the scope `acme`
- **Then** Now shows "2 builds running" with no count of the 5 slots
- **And** with the scope "All", it shows "4 of 5 build slots in use".

### Builds between runs

- **Given** no run in progress, and 2 leaf issues in IN PROGRESS in enabled repos
- **When** the dash loads with the scope "All"
- **Then** Now shows "2 builds wait for the next run" and no slot count.

### Waits for you

- **Given** open issues: a BLOCKED issue with priority `high`, a BLOCKED issue with priority `low`, an IN REVIEW issue with `merge-ready`, a TODO issue without `spec-approved` with priority `medium`, and a TODO issue with `spec-waived`; and an open pull request into `production`
- **When** the dash loads
- **Then** Waits for you lists the two BLOCKED issues first, highest priority first, then the release pull request as "Release to perform", then the `merge-ready` issue, then the TODO issues with the next steps "Spec and G1" and "make it READY" by priority
- **And** each item has its repo, its number, its title as plain text, its reason, its source and its link.

### The reason of a BLOCKED issue

- **Given** a BLOCKED issue, and a night log line for it with `to` BLOCKED and the reason "auto mode refused the migration"
- **When** the dash loads
- **Then** the item shows that reason with the source "night log"
- **And** a BLOCKED issue with no such line shows "see the comment in the tracker".

### Many items wait

- **Given** 30 items that wait for the Operator
- **When** the dash loads
- **Then** Waits for you shows the first 20 in the order above, and "and 10 more"
- **And** the tile shows 30.

### Nothing waits

- **Given** no item that waits for the Operator in the scope
- **When** the dash loads
- **Then** Waits for you shows "Nothing waits for you in this scope."

### The slot timeline

- **Given** a run with leaf issues A (01:00 to 03:00, merged), B (01:10 to 04:00, `merge-ready`), C (03:30 to 05:00, BLOCKED) and D (01:20 to the last line of the run, with no end line)
- **When** the dash loads
- **Then** Last run shows lanes 1 to 3: A and then C in lane 1, B in lane 2, D in lane 3
- **And** the results are "merged", "merge-ready", "blocked" and "stopped at run end", each with a text label and a colour
- **And** a table with the same builds, their times and results is available to a screen reader.

### Skips in the last run

- **Given** 9 night log lines of the last run with `from` and `to` both READY and a reason from `factory-run`, for example "blocked by #3"
- **When** the dash loads
- **Then** Last run shows "9 skips" and no bar for them.

### A build that a stopped run left

- **Given** a run whose only line for issue 12 is IN REVIEW to DONE with the reason "merged #40"
- **When** the dash loads
- **Then** Last run shows a build for issue 12 from the start of the window to that line, with the result "merged".

### Blocked at selection

- **Given** a line for issue 15 from READY to BLOCKED, with no earlier line for issue 15 in the run
- **When** the dash loads
- **Then** Last run shows "1 blocked at selection" and no bar for it
- **And** the Builds tile does not count it.

### A parent issue in the night log

- **Given** night log lines for an issue that has children in the Work cache
- **When** the dash loads
- **Then** those lines make no bar and no build.

### The last run in a client scope

- **Given** a newest run with builds of `globex` only, and an older run in the 30 days with builds of `acme` in lanes 2 and 4 of that run
- **When** the dash loads with the scope `acme`
- **Then** Last run shows the older run, with a window from the first to the last `acme` line
- **And** the `acme` builds are in lanes 1 and 2, with no gap for other builds.

### Review health

- **Given** Control events in the last 30 days for 2 repos in scope: `gate` events for 10 pull requests with their rounds and tiers, some with `matrix` and some without it, 3 `escalated` events, and 2 `waiver_used` events for the Waiver `W-1` of one repo and 1 for `W-1` of the other repo
- **When** the dash loads
- **Then** Review health shows the first-round pass rate for each Risk tier and for "no tier"
- **And** the rounds per pull request, from the highest round of each pull request
- **And** "Escalations: 3" and "Waivers in use: 2".

### First-round pass counts each pull request once

- **Given** a pull request with a round 1 `gate` event `wait`, then a round 1 event `fail` with the tier `general`, then a round 2 event `pass` with the tier `sensitive`
- **When** the first-round pass rate is calculated
- **Then** the pull request counts once, as not passed, in the tier `general`
- **And** pull request 7 of one repo and pull request 7 of another repo count as two pull requests.

### A repo with no Control events

- **Given** a connected repo with no Control event in 30 days, and 4 cached pull requests whose author is a login in `FOREMAN_FACTORY_LOGINS`, of which 3 have a review by such a login, and 1 pull request by the Operator
- **When** the dash loads
- **Then** Review health shows the repo with "no Control events in 30 days", "3 factory pull requests reviewed by the Factory identity" and "1 factory pull request with no Factory identity review"
- **And** the Operator's pull request is in neither count.

### No Factory identity login

- **Given** no `FOREMAN_FACTORY_LOGINS` value, or a value that is empty or only spaces, and a repo with no Control events in 30 days
- **When** the dash loads
- **Then** Review health shows "Factory identity login not set" for that repo, and no review counts.

### Repos

- **Given** 3 repos in scope, of which 1 is "not connected: no token" and 1 has no Control events
- **When** the dash loads
- **Then** Repos shows each repo with its `owner/name`, its client, its connection state, its "data as of" time, and the time of its last night log line and its last Control event.

### A log line for a repo outside the list

- **Given** a night log line whose repo folder is not in the repo list
- **When** the dash loads with the scope `acme`
- **Then** the line has no effect on the dash
- **And** with the scope "All", its builds show with the last part of the folder path as the label.

### A malformed line

- **Given** a night log file with one line that is not valid JSON and a last line with no line end, and a Control event file with one event of an unknown kind
- **When** the dash loads
- **Then** the dash uses all valid lines and ignores the last line with no line end
- **And** the dash response counts 1 skipped night log line and 1 skipped Control event, and the log shows the file name and the counts, with no line content.

### Missing factory folders

- **Given** no `runs/` folder and no `controls/` folder
- **When** the dash loads
- **Then** Now, Last run and Review health show no data, with no error
- **And** when the API cannot read a folder, Now and Review health show "cannot read the factory folder".

### A time in the future

- **Given** a heartbeat and a night log line with a time 2 minutes in the future
- **When** the dash loads
- **Then** each counts as now, and the heartbeat age shows "0 minutes".

### Live update

- **Given** the dash is open in a visible tab
- **When** 60 seconds pass
- **Then** the web app asks for the dash data again
- **And** while the tab is hidden, it does not ask.

### Some repos not connected

- **Given** 3 repos in scope, of which 1 has no cache rows because it has no token
- **When** the dash loads
- **Then** the pipeline strip and Waits for you use the cache rows of the 2 connected repos
- **And** each shows "Data is not complete: 1 repo not connected. See Repos."

### Not connected

- **Given** no token for any repo in scope
- **When** the dash loads
- **Then** Now, Last run and Review health show the local data from the night log, the lock and the Control events
- **And** the pipeline strip, Waits for you and the Factory identity counts show "Not connected. Add the Foreman token to the Keychain, then run `pnpm local:up`."

### Titles stay plain text

- **Given** an issue title that holds HTML and Markdown
- **When** the dash shows it in Waits for you
- **Then** the page shows the text as it is, with no markup and no request to another host.

### Accessibility

- **Given** each fixture set of the scenarios "A run in progress", "A stale lock", "No run yet", "Many items wait", "Nothing waits", "Some repos not connected" and "Not connected", loaded from synthetic files and a seeded Work cache
- **When** the end-to-end test opens the dash with each set
- **Then** the axe scan finds no WCAG 2.2 AA violation
- **And** each result in the timeline and the pipeline strip has a text label as well as a colour.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/dash/night-log` | Reads the night log files of the last 30 days and the run lock |
| `apps/api/src/dash/control-events` | Reads the Control event files of the last 30 days |
| `apps/api/src/dash/runs` | The last run, its builds, their results and their lanes |
| `apps/api/src/dash/waits` | The items that wait for the Operator |
| `apps/api/src/dash/review-health` | The first-round pass rate, the rounds, the escalations, the Waivers in use and the Factory identity counts |
| `apps/api/src/dash/dash` | One dash response for one Client scope |
| `apps/api/src/routes/dash.ts` | The dash route |
| `packages/shared` | The Zod schema of the dash response |
| `apps/web/src/dash` | The dash page: tiles, pipeline strip, Waits for you, slot timeline, Review health, Repos |
| `apps/web/src/nav` | The view links in the header. A link shows only for a view that exists. |

### Configuration

| Variable | Default | Use |
|---|---|---|
| `FOREMAN_FACTORY_LOGINS` | none | The forge logins of the Factory identity, comma-separated, for example `bebopaloo-factory[bot]`. Each login matches `^[A-Za-z0-9-]+(\[bot\])?$`; the API trims spaces and stops at start-up on an invalid login. An empty value is no setting. |

### Local sources

All are below `<FOREMAN_CLAUDE_DIR>/factory/`, which the local runtime mounts read-only. The API reads them on each dash request, with no index.

- **The window.** The API reads the files whose UTC date is in the last 31 days, and uses the lines whose `time` is in the last 30 × 24 hours. A run that crosses midnight UTC is in two files. A time in the future counts as now.
- **Night log:** `runs/<YYYY-MM-DD>.jsonl`. Each line has exactly `run_id` (a non-empty string), `repo` (the repo folder, a string), `issue` (a positive integer), `from` and `to` (Issue states), `reason` (a string of at most 500 characters) and `time` (`YYYY-MM-DDTHH:MM:SSZ`).
- **Run lock:** `run.lock`, with `run_id` (a string) and `heartbeat` (a number of epoch seconds, not always whole). A lock with a heartbeat more than 3 hours (10,800 seconds) ago is stale, as in `factory_run.py`. The factory writes the lock in place, so the API reads a lock that is not valid JSON once more after 100 ms. If it is still not valid, Now shows "run lock unreadable", and the lock counts in `skipped`.
- **Control events:** `controls/<YYYY-MM-DD>.jsonl`. Every event has `kind`, `repo` (`owner/name`) and `time`. The other keys of each kind:

  | Kind | Keys |
  |---|---|
  | `gate` | `pr` (integer), `issue` (integer or null), `tier` (a Risk tier or null), `round` (1 to 3), `decision` (`pass`, `fail`, `wait` or `blocked`), `counts`, `categories`, `refs`, `waived`, and the optional `matrix` |
  | `escalated` | `pr`, `issue`, `path_tier`, `tier`, `paths`, `evidence` |
  | `waiver_used` | `pr`, `waiver`, `finding` |
  | `merged` | `pr`, `issue`, `base`, `tier` |
  | `finding_overdue` | `issue`, `due` (or null), `source` (or null) |

  An event of an unknown kind is skipped and counted. The keys are part of the factory-Foreman source contract.
- Each line is validated with a strict Zod schema. A line that is not valid JSON or fails the schema is skipped and counted. The API ignores a last line with no line end and does not count it, because the factory can be in the middle of a write. A file larger than 50 MB is skipped and counted.
- A missing `runs/` or `controls/` folder means no data. A folder that the API cannot read shows "cannot read the factory folder" in Now and Review health.
- A night log line belongs to the repo list entry whose `path` equals its `repo`. A Control event belongs to the entry whose `repo` equals its `repo`, in lower case. Each one gets the client of that entry. With no entry, or an entry with no repo ID, it shows only in "All", with the last part of its folder path as the label.

### Last run

- In the scope "All", the last run is the `run_id` of the newest night log line. In a client scope, it is the newest `run_id` with one or more lines of that client's repos, and the run uses only those lines.
- The window runs from the first line to the last line that the run uses, or to now while the lock holds that `run_id` and is not stale.
- A line with `from` and `to` both READY is a skip. It counts in "skips" and makes no bar.
- A build is one leaf issue of one repo with one or more lines in the run that are not skips. A leaf issue has no children in the Work cache; with no cache row, the issue counts as a leaf. The lines of a parent issue make no bar.
- A build starts at its first line with `to` IN PROGRESS. A build with no such line in the run, for example one that a stopped run left, starts at the start of the window.
- A line from READY to BLOCKED with no earlier line for that issue in the run is "blocked at selection". It has its own count, makes no bar, and does not count in the Builds tile.
- A build ends at its first line, from its start on, with one of these:

  | Line | Result |
  |---|---|
  | `to` DONE, reason starts with `merged` | merged |
  | `to` IN REVIEW, reason starts with `merge-ready` | merge-ready |
  | `to` BLOCKED | blocked |
  | `to` CANCELLED | cancelled |

  With no such line, the result is "in review" when its last line has `to` IN REVIEW, else "stopped at run end". It then ends at the end of the window. In a run in progress, it is "running" and ends at now.
- Lanes: the builds in order of start time, each in the lowest lane that is free at its start. In the scope "All", more than 5 lanes means more than 5 builds at one time, and the dash shows the lanes that the data needs.
- The tiles count the builds of the last run in scope, the merged builds, and the peak count of builds at one time.

### Now

- The run state from the lock: "Run in progress" with the heartbeat age, "No run in progress", or "No run in progress" with "a stopped run left a stale lock".
- The running builds: the open cached issues in IN PROGRESS or IN REVIEW without `merge-ready` and without children, in scope, in repos whose repo list entry has `enabled` true. The dash reads `enabled` from the repo list on each request.
- With a run in progress, in the scope "All", the dash shows "N of 5 build slots in use". In a client scope, it shows "N builds running" and no slot count, so that the load of other clients does not show. With no run in progress, it shows "N builds wait for the next run".
- The pipeline strip, from the cached issues in scope. Each stage other than DONE uses only open issues. An open TODO issue goes to the stage of the first rule that applies: with `finding`, no stage; with `issues-approved`, no stage; with `spec-waived`, no stage; without `spec-approved`, G1 Spec; else G2 Issues.

  | Stage | Issues |
  |---|---|
  | G1 Spec | open TODO, by the rules above |
  | G2 Issues | open TODO, by the rules above |
  | READY | READY |
  | IN PROGRESS | IN PROGRESS |
  | IN REVIEW | open IN REVIEW without `merge-ready` |
  | BLOCKED | BLOCKED |
  | DONE | the Issue state DONE |
  | G3 | open IN REVIEW issues with `merge-ready`, plus open pull requests whose base is `production` |

### Waits for you

The items, in this order, from the Work cache, as `factory-next` orders them. Only open issues count.

1. BLOCKED issues. The reason is the reason of the newest night log line for that issue with `to` BLOCKED, with the source "night log". With no such line: "see the comment in the tracker", with the source "tracker".
2. Open pull requests whose base is `production`: "Release to perform", with the source "forge".
3. IN REVIEW issues with `merge-ready`: "merge-ready, waits for G3", with the source "tracker".
4. TODO issues, with the next step from the first rule that applies: with `finding`, no item; with `issues-approved`, no item; with `spec-waived`, "make it READY"; without `spec-approved`, "Spec and G1"; else "G2". The source is "tracker".

Within a group, the order is priority (highest first), then the number, then `owner/name`. Waits for you does not show overdue findings or a Release to prepare, because the Work cache has no issue body and no release plan; `factory-next` shows them.

The dash shows the first 20 items and "and N more". The tile shows the total. Each item has the repo, the number, the title, the reason, the source and the link from the cache. The section has the note "run `factory-next` to act".

### Review health

From the Control events of the last 30 days, in scope:

- A pull request is its `repo` and its `pr`. A Waiver is its `repo` and its `waiver`.
- **First-round pass rate.** For each pull request, the first `gate` event of round 1 whose decision is `pass` or `fail`. The rate is the share with `pass`, rounded to a whole percent. The tier of the pull request is the `tier` of that event. The dash shows the rate in the tile, and for each Risk tier and "no tier" in a table, each with its count of pull requests. The label is always "first-round pass". With no such event: "no gate decision in 30 days".
- **Rounds per pull request.** The highest `round` of the `gate` events of each pull request: counts for round 1, round 2 and round 3.
- **Escalations.** The count of `escalated` events.
- **Waivers in use.** The count of distinct Waivers in `waiver_used` events.
- **Repos with no Control events.** For each connected repo in scope with no Control event in 30 days: "no Control events in 30 days", the count of its cached pull requests whose author is a login in `FOREMAN_FACTORY_LOGINS` and that have one or more reviews by such a login, and the count of those pull requests with no such review. With no setting: "Factory identity login not set".

### Repos

Each repo in scope: `owner/name`, client, connection state and "data as of" time from the step 2 status, and the time of its last night log line and its last Control event.

### Dash API

`GET /api/dash`, with the optional `client` value of the step 2 Spec. The query schema uses `.strict()`. The route is `public: true` for the reason in the Usage ingest Spec. It returns one document:

| Part | Holds |
|---|---|
| `run` | The run state, the heartbeat time, the stale flag |
| `tiles` | Builds, merged, peak, waits total, first-round pass rate and its count |
| `running` | The count of running builds, and the slot limit only in the scope "All" |
| `pipeline` | The count of each stage, or the state "not connected" |
| `waits` | Up to 20 items and the total, or the state "not connected" |
| `lastRun` | The run ID, the window, the builds with repo ID or folder label, issue, start, end, result and lane, the skip count and the count of issues blocked at selection |
| `reviewHealth` | The pass rates by tier, the rounds, the escalations, the Waivers in use, and the repos with no Control events |
| `repos` | The repos in scope with their states and times |
| `skipped` | The counts of skipped night log lines, Control events, files and an unreadable lock |
| `complete` | For the forge sections, the count of repos in scope with no cache rows or a fetch error |

All times are UTC, in ISO 8601. The web app shows them in the browser's time zone. The response holds no issue body, no review body and no Control event text other than the keys above.

### Web app

- This Spec owns `/`, which shows the dash. The Usage view (Spec B) is at `/usage`.
- The layout follows the prototype's "Foreman dash" tab: the tiles in one row, then the sections in the order of this Spec. At phone width the tiles and sections stack.
- The web app asks for `/api/dash` on load and each 60 seconds while `document.visibilityState` is `visible`.
- Titles, reasons, labels and logins are React text nodes, by the step 2 rules. Links use only the `link` field.
- Each result and stage has a text label and a colour. The colours pass 4.5:1 contrast for their text. The timeline has a table with the same data for screen readers.
- The pipeline strip, Waits for you and the Factory identity counts use the Work cache rows of the repos in scope. When one or more repos in scope have no cache rows or a fetch error, each of these sections shows "Data is not complete: N repos not connected. See Repos." When no repo in scope has cache rows, each shows the step 2 "not connected" text. The local sections still show.

## Gating and rollout

- **Gating:** not required. The dash adds a view and a route, and changes no existing flow: the web app has only a health page today, and the Usage view is at `/usage`.
- **Rollout:** after the step 2 Spec is built. The issues merge into the main branch one by one (Incremental). The local sections work with no token. To undo, revert the change; the dash stores nothing.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The dash shows issue titles, forge logins and repo names from the step 2 cache, and repo folder names from the night log. It adds no stored data.
- In a client scope, the dash hides the data of other clients, also the count of the 5 build slots, which would show their load.

## Out of scope

- The Controls data: Waivers from the repo, Waivers that expire, the Risk map, the Release records, the `factory/machine-gate` status, and which repos have `control_events` off (step 4).
- The last-gate pass rate, the Security findings by severity, the findings by category and ref, and the merges by tier (the Controls view, step 4).
- The session timeline and the sub-agent spans of a build (step 5).
- A Work view with every issue and pull request.
- Any action from the dash. The Operator acts with `factory-next`.
- Usage and limit numbers on the dash. The Usage view has them.

## Risks

- **The night log reasons are text that the factory writes.** The results "merged" and "merge-ready" depend on the reason prefixes that `factory-run` documents. A change of those words in the factory breaks the results, so the factory and Foreman share them as part of the source contract.
- **The cache and the lock can disagree.** The running builds come from a Work cache up to 15 minutes old, and the run state comes from the live lock.
- **The cache has no "updated" time.** The DONE count is all cached DONE issues, not the DONE issues of a period.

## Open questions

- None.
