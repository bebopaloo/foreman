# Reviews view

**Status:** Approved
**Work items:** #66

Source: foreman ADR 0003, factory ADR 0007 (amended 2026-11-14), factory ADR 0014 and the factory record `_context/architecture/control-events.md` (the metrics for the Controls view), step 4 of the build order. It builds on the approved Specs [`5-usage-ingest.md`](5-usage-ingest.md), [`23-forge-and-tracker-connection.md`](23-forge-and-tracker-connection.md) and [`24-foreman-dash.md`](24-foreman-dash.md). It uses the list conventions of the Work view ([`65-work-view.md`](65-work-view.md)), the **Agent spans** and the work item rule of the Sessions view ([`68-sessions-view.md`](68-sessions-view.md)), the Control modules of the Controls view ([`67-controls-view.md`](67-controls-view.md)), and the theme, format and chart modules of the Usage view ([`69-usage-view.md`](69-usage-view.md)). The Controls view is the other half of step 4. Layout reference: the Claude artifact "Foreman dash prototype", tab "Reviews". Where the prototype and this Spec differ, this Spec is the master copy.

## Problem

The factory reviews each pull request in up to 3 rounds, gives it a **Risk tier**, and can escalate the tier when a finding shows risk that the paths do not show. The **Foreman dash** shows only the first-round pass rate, the rounds and the count of escalations. The Operator cannot see whether the **Risk map** gives the right tier, which tiers take the most rounds, where the Security findings are, or how much of the build time the reviews take.

An auditor of a regulated client tests whether the controls operate over time. The Operator needs one page that shows the review results of one client across 30 days, from the **Control events**, with links out to the forge.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator opens the Reviews view to tune the Risk map, to find slow reviews and to prepare an audit.
- **Stakeholders and auditors of one client**: they see the Reviews view only in a screen share by the Operator, in that client's **Client scope**.

## Acceptance criteria

Fixtures are synthetic: a synthetic repo list, night log, Control events, Work cache and **Usage index**. No real event, repo, log or transcript goes into the repo. In the scenarios, the repo `acme/app` has the repo list `path` `/src/acme-app`, and its Turns have that Project key.

### The Reviews view

- **When** the Operator opens `/reviews`
- **Then** Foreman shows the tiles, then the sections Risk tier results, Rounds to settle, Security findings and Review time against build time, in that order
- **And** the header shows the Client scope, the connection state and the Refresh button of the step 2 Spec, and the nav marks "Reviews".

### Tiles

- **Given** `gate` events in the last 30 days for 10 pull requests in 2 repos, of which 8 have a Risk tier and 2 of those 8 have an `escalated` event, 7 of the 10 passed their first round 1 decision, and 4 timed builds with a build end from an Agent span, with build times that add up to 120 minutes and Review cycles that add up to 80 minutes
- **When** the view loads
- **Then** the tiles show "Pull requests reviewed: 10, last 30 days", "First-round pass: 70% of 10 pull requests", "Escalation rate: 25% of 8 pull requests with a tier" and "Review share of total time: 40% of 4 builds".

### No gate decision

- **Given** no `gate` event in 30 days in the scope
- **When** the view loads
- **Then** the tiles show "Pull requests reviewed: 0", "First-round pass: no gate decision in 30 days" and "Escalation rate: no tier in 30 days"
- **And** Risk tier results, Rounds to settle and Security findings show "No Control events in this scope."

### The final tier is the highest tier

- **Given** pull request 40 with a round 1 `gate` event with the tier `general`, an `escalated` event with `path_tier` `general` and `tier` `authority`, and a round 2 `gate` event with the tier `authority`
- **When** the view loads
- **Then** pull request 40 counts once in "Pull requests by final tier", as `authority`
- **And** in "Path tier against final tier", it counts in the row `general` and the column `authority`, with the label "escalated".

### A pull request with no escalation

- **Given** pull request 41 with `gate` events with the tier `sensitive` and no `escalated` event
- **When** the view loads
- **Then** pull request 41 counts in the row `sensitive` and the column `sensitive`.

### A pull request with no tier

- **Given** 2 pull requests whose `gate` events all have the tier null
- **When** the view loads
- **Then** "Pull requests by final tier" shows them as "no tier: 2"
- **And** "Path tier against final tier" leaves them out, with the note "2 pull requests with no tier".

### Merges by base and tier

- **Given** `merged` events: 3 with the base `main` and the tier `general`, 1 with the base `feature/export` and the tier `authority`, 1 with the base `feature/ledger` and the tier `authority`, and 1 with the base `main` and the tier null
- **When** the view loads
- **Then** "Merges by base and tier" shows `main`: general 3, no tier 1, and `feature/*`: authority 2.

### Rounds to settle

- **Given** 5 pull requests with the final tier `sensitive`: A passes in round 1; B fails in round 1 and passes in round 2; C fails in rounds 1 and 2 and gets `blocked` in round 3; D fails in round 1 and has no later event; E has only a round 1 `wait` event
- **When** the view loads
- **Then** the row `sensitive` shows "5 pull requests: round 1: 1, round 2: 1, round 3: 0, BLOCKED: 1, not settled: 2"
- **And** it shows "last-gate pass: 50% of 4", because E has no decision other than `wait`.

### Security findings in round 1 and at settle

- **Given** pull request 42 with the final tier `sensitive`, a round 1 `gate` event `fail` whose `matrix` has `"Security": {"major": 1, "minor": 2}`, and a round 2 `gate` event `pass` whose `matrix` has `"Security": {"minor": 1}`
- **When** the Operator chooses "Found in round 1"
- **Then** the column `sensitive` shows major 1 and minor 2
- **And** with "Left at settle", it shows minor 1 and major 0, and the URL has `mode=settle`.

### A wait event does not count

- **Given** pull request 43 with a round 1 `gate` event `wait` whose `matrix` has a Security `major`, then a round 1 event `fail` whose `matrix` has no Security row
- **When** the Operator chooses "Found in round 1"
- **Then** pull request 43 adds no Security finding.

### Events with no matrix

- **Given** 3 pull requests whose first round 1 decision event has no `matrix`
- **When** the Operator chooses "Found in round 1"
- **Then** the table shows "3 pull requests with no matrix: not counted"
- **And** no cell counts them as zero findings.

### Findings by category and severity

- **Given** pull request 44 with a round 1 `fail` event with `categories` `{"Correctness": 2, "Security": 1}` and `counts` `{"major": 2, "minor": 1}`, and pull request 45 with a round 1 `pass` event with `categories` `{"Testing": 1}` and `counts` `{"minor": 1}`
- **When** the Operator chooses "Found in round 1"
- **Then** "Findings by category" shows Correctness 2, Security 1 and Testing 1
- **And** "Findings by severity" shows major 2 and minor 2.

### Most frequent refs

- **Given** `CWE-639` in the `refs` of 3 pull requests, of which one has it in two rounds, and `CWE-79` in the `refs` of 2 pull requests, and 11 other refs in 1 pull request each
- **When** the view loads, in either mode
- **Then** "Most frequent refs" shows `CWE-639`: 3 pull requests, then `CWE-79`: 2 pull requests, then 8 refs with 1 pull request in the order of their names
- **And** it shows 10 refs and "and 3 more".

### Security findings in a general or inert pull request

- **Given** pull request 46 with the final tier `general` and a round 2 Security `minor` in its `matrix`, pull request 47 with the final tier `inert` and only a Security `info`, pull request 48 with the final tier `sensitive` and a Security `major`, and pull request 49 with the tier null and a Security `major`
- **When** the view loads
- **Then** the signal list shows only pull request 46, with "general · 1 minor Security finding" and its link from the Work cache.

### Build end from an Agent span

- **Given** night log lines of one run for issue 12 of `acme/app`: 01:00 to IN PROGRESS, and 02:30 to DONE with the reason `merged #40`
- **And** a `software-developer` Agent span from 01:02 to 01:35 whose Turns have the Project key `/src/acme-app` and the worktree name `12-add-export`
- **When** the view loads
- **Then** the row of pull request 40 has a build time of 35 minutes and a **Review cycle** of 55 minutes, with the build end source "agent span".

### Build end from the first gate event

- **Given** the night log lines of the scenario above, no linked `software-developer` Agent span, and `gate` events for pull request 40 of `acme/app` at 01:50 and 02:20
- **When** the view loads
- **Then** the row of pull request 40 has a build time of 50 minutes and a Review cycle of 40 minutes, with the build end source "first gate event"
- **And** the build counts in no median and not in the review share.

### No build end

- **Given** a build with a settle, no linked `software-developer` Agent span and no `gate` event of its pull request in the build window
- **When** the view loads
- **Then** its row shows the total time from the build start to the settle, and "no build end"
- **And** the build counts in no median and not in the review share.

### The pull request of a build

- **Given** a build of issue 12 of `acme/app` that settles with `to` BLOCKED, and `gate` events in its build window for issue 12 of `acme/app`: pull request 40 at 01:50 and pull request 41 at 02:10
- **When** the view loads
- **Then** the build has the row of pull request 41, the newest
- **And** a build of issue 13 with no `merged #<n>` or `merge-ready #<n>` reason and no `gate` event for issue 13 in its window has no row, and counts in "N builds with no pull request".

### The split of a Review cycle

- **Given** a Review cycle from 01:40 to 02:30, `review-finder` Agent spans from 01:40 to 01:50 and from 01:42 to 01:55, a `review-verifier` span from 01:55 to 02:00, and a `review-resolver` span from 02:05 to 02:15, all with the Project key and the work item of the build
- **When** the view loads
- **Then** the row shows review agents 20 minutes, resolver 10 minutes and other 20 minutes.

### An Agent span with no work item

- **Given** a `review-finder` Agent span in the build window whose Turns have the branch `HEAD` and no worktree name, and a `review-verifier` span whose Turns have the worktree names `12-add-export` and `13-fix-total`
- **When** the view loads
- **Then** neither span links to a build
- **And** the section shows "2 review agent spans not linked: no single work item".

### Medians by tier

- **Given** 3 timed builds with a build end from an Agent span and the final tier `sensitive`, with build times of 30, 40 and 60 minutes and Review cycles of 20, 50 and 80 minutes
- **When** the view loads
- **Then** the row `sensitive` shows 3 pull requests, a median build of 40 minutes, a median Review cycle of 50 minutes and a review share of 54%.

### A build in two runs

- **Given** a build of issue 15 whose run ends with the result "in review", and a later run whose first line for issue 15 is IN REVIEW to DONE with the reason `merged #52`
- **When** the view loads
- **Then** neither part has a row, because the first has no settle and the second has no build start
- **And** the section shows "1 build not timed: its start or its settle is in another run".

### A repo with Control events off

- **Given** the repo `globex/portal`, whose cached `.claude/factory.json` at its default branch does not list `control_events` (Controls view), and 2 timed builds of it in the night log
- **When** the view loads with the scope "All"
- **Then** the page shows "Control events are off in `globex/portal`. Its pull requests show only in Review time against build time, from the night log and the Usage index."
- **And** its builds show with "no tier" and "rounds unknown"
- **And** the page shows its Factory identity review counts by the rule of the dash Spec.

### A repo with no events and no module data

- **Given** a connected repo with no Control event in 30 days and no cached `.claude/factory.json`
- **When** the view loads
- **Then** the page shows "no Control events in 30 days" for that repo, with the Factory identity counts of the dash Spec.

### Reviews in a client scope

- **Given** `gate` events, night log lines and Agent spans of `acme` and `globex` repos
- **When** the view loads with the scope `acme`
- **Then** every tile, section and row uses only the data of `acme` repos
- **And** a request to `/api/reviews/pull-requests` with `client=acme` and the repo ID of a `globex` repo gets status 400.

### Pull request rows in pages

- **Given** 120 pull request rows in the scope
- **When** the web app asks `/api/reviews/pull-requests` with no `limit`, and then with the `nextCursor`
- **Then** the first page has the 50 rows with the longest total time, and the second page has the next 50
- **And** a request with `limit=201`, `limit=0`, `tier=extreme`, an unknown query key or a cursor that is not valid gets status 400.

### Some repos not connected

- **Given** 3 repos in scope, of which 1 has no Work cache rows
- **When** the view loads
- **Then** the tiles and every section show the data of all 3 repos
- **And** the signal list and the pull request list show "Data is not complete: 1 repo not connected. See Repos.", and the rows of that repo have no link.

### Not connected

- **Given** no token for any repo in scope
- **When** the view loads
- **Then** the tiles and every section show the data from the Control events, the night log and the Usage index, with no links
- **And** the signal list and the pull request list show "Not connected. Add the Foreman token to the Keychain, then run `pnpm local:up`."

### Malformed events

- **Given** a Control event file with one line that is not valid JSON and one `gate` event with the round 4
- **When** the view loads
- **Then** the view uses the other events
- **And** the response counts 2 skipped Control events, by the reader of the dash Spec.

### Refs stay plain text

- **Given** a `gate` event whose `refs` has `<img src="https://evil.example/t.png">`
- **When** the view shows "Most frequent refs"
- **Then** the page shows the text as it is, with no image
- **And** the browser makes no request to `evil.example`.

### Links from the cache only

- **Given** a signal for pull request 46, whose cached `link` is `https://github.com/acme/app/pull/46`, and a signal for pull request 50 with no cached row
- **When** the view shows the signals
- **Then** pull request 46 has a link with `rel="noopener noreferrer"`
- **And** pull request 50 has no link.

### Live update

- **Given** the view is open in a visible tab
- **When** 60 seconds pass
- **Then** the web app asks for the Reviews data again, and the loaded pages of the pull request list by the list conventions of the Work view Spec
- **And** while the tab is hidden, it does not ask.

### Accessibility

- **Given** each fixture set of the scenarios "Tiles", "No gate decision", "A repo with Control events off", "Some repos not connected" and "Not connected", loaded from synthetic files, a seeded Work cache and a seeded Usage index
- **When** the end-to-end test opens `/reviews` with each set, in the light theme and in the dark theme
- **Then** the axe scan finds no WCAG 2.2 AA violation
- **And** each cell of the two matrices, each bar and each part of a time bar has a text value as well as a colour
- **And** each chart has a table with the same values for screen readers.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/dash/control-events` | The Control event reader of the dash Spec. This view uses it as it is. |
| `apps/api/src/dash/night-log` | The night log reader of the dash Spec. This view uses it as it is. |
| `apps/api/src/dash/runs` | The build rules of the dash Spec. It gains the export `runsInWindow`: each run of the window in one scope, with its builds, their start, end, result and lane, its skips, its count blocked at selection and its peak. The last run of the dash is its newest run. The Factory health Spec (71) uses the same export. |
| `apps/api/src/dash/review-health` | The first-round pass rate and the Factory identity counts of the dash Spec. This view uses them as they are. |
| `apps/api/src/controls/modules` | The Control modules of each repo, from the Controls view Spec. This view reads only the `control_events` state. |
| `apps/api/src/sessions/spans` | The Agent spans and the work item rule of the Sessions view Spec. This view adds the export `subAgentSpansInWindow`: the sub-agent spans of one time window in one scope, by the same rules. |
| `apps/api/src/reviews/pr-records` | One record for each pull request from the Control events: final tier, path tier, rounds, outcome, the round 1 and settle events |
| `apps/api/src/reviews/tier-results` | Pull requests by final tier, path tier against final tier, merges by base and tier |
| `apps/api/src/reviews/rounds` | Rounds to settle and the last-gate pass rate by final tier |
| `apps/api/src/reviews/findings` | Security findings by severity and tier, findings by category and severity, refs, signals |
| `apps/api/src/reviews/times` | The pull request of a build, the build end, the settle, the Review cycle and its split |
| `apps/api/src/reviews/reviews` | One Reviews response for one Client scope |
| `apps/api/src/routes/reviews.ts` | The Reviews routes |
| `packages/shared` | The Zod schemas of the Reviews query and responses |
| `apps/web/src/reviews` | The Reviews page: tiles, Risk tier results, Rounds to settle, Security findings, Review time against build time |
| `apps/web/src/nav` | Gains the link "Reviews" |
| `e2e/reviews.spec.ts` | The end-to-end tests with the axe scan |

The page uses `apps/web/src/theme`, `apps/web/src/format`, `apps/web/src/charts` and `apps/web/src/usage-status` (for the Usage "data as of" text) of the Usage view Spec, and `apps/web/src/list` and `apps/api/src/paging` of the Work view Spec. It does not define its own tokens, formats, charts or paging.

### Configuration

No new variable. The variables of the Usage ingest Spec, the step 2 Spec and the dash Spec do not change.

### Dependencies on the factory

None. The view uses the night log reasons and the Control events that the factory writes today. The factory writes no night log line when a build opens its pull request, so the build end comes from the Agent spans, else from the first `gate` event (below).

### Sources

- **Control events:** the reader of the dash Spec, with its window of 30 days, its strict schemas, its skip counts and its repo and client mapping. The keys are those of `control_events.py` in factory-core: `gate` (`pr`, `issue`, `tier`, `round`, `decision`, `counts`, `categories`, the optional `matrix`, `refs`, `waived`), `escalated` (`pr`, `issue`, `path_tier`, `tier`, `paths`, `evidence`) and `merged` (`pr`, `issue`, `base`, `tier`). This view does not use `waiver_used` and `finding_overdue`.
- **Night log:** the reader of the dash Spec, and the export `runsInWindow` for each run in the window.
- **Work cache:** the cached pull requests of the step 2 Spec, for the link only, and the cached issues, for the leaf rule of the dash Spec.
- **Usage index:** the sub-agent Turns of the Usage ingest Spec: agent ID, **Agent type**, time, Project key, branch and worktree name (Sessions view Spec). The index holds no text.
- **Control modules:** the `control_events` state of each repo from the Controls view Spec.

### Pull request records

- A pull request is its `repo` and its `pr`.
- A decision event is a `gate` event whose decision is `pass`, `fail` or `blocked`. A `wait` event means that the checks still run; it is never a decision event.
- **Round 1 event:** the first `gate` event of round 1 whose decision is `pass` or `fail`, as in the dash Spec.
- **Settle event:** the last decision event, when its decision is `pass` or `blocked`. A pull request whose last decision event is `fail`, or that has no decision event, is "not settled".
- **Final tier:** the highest tier in the `tier` of all its `gate` and `escalated` events. A tier only goes up, because the factory never removes a `risk:*` label. With no tier, the pull request is "no tier".
- **Path tier:** the `path_tier` of its first `escalated` event. A pull request with no `escalated` event has the path tier equal to its final tier.
- **Escalated:** the pull request has one or more `escalated` events. The **Escalation rate** is the share of escalated pull requests among the pull requests with a final tier.
- **Rounds:** the highest `round` of its `gate` events, as in the dash Spec.

### Tiles

| Tile | Value |
|---|---|
| Pull requests reviewed | The count of pull requests with one or more `gate` events in 30 days |
| First-round pass | The rate of the dash Spec, with its label and its count |
| Escalation rate | The share of escalated pull requests among the pull requests with a final tier. With no such pull request: "no tier in 30 days". |
| Review share of total time | The sum of the Review cycles over the sum of the build times and the Review cycles, for the timed builds whose build end source is "agent span", with their count. With no such build: "no timed build in 30 days". |

Rates are whole percents, rounded, as in the dash Spec.

### Risk tier results

- **Pull requests by final tier:** a bar and a count for `authority`, `sensitive`, `general`, `inert` and "no tier".
- **Path tier against final tier:** a 4 × 4 table. The rows are path tiers and the columns are final tiers, from `authority` to `inert`. A cell on the diagonal means that the Risk map gave the tier. A cell off the diagonal holds escalated pull requests and has the label "escalated". Pull requests with no tier are not in the table; a note gives their count.
- **Merges by base and tier:** the count of `merged` events by base and tier. A base that starts with `feature/` counts as `feature/*`. Each other base shows as it is.
- The note: "A path that escalates again and again shows a wrong Risk map. The Controls view lists the paths."

### Rounds to settle

For each final tier with one or more pull requests, and for "no tier":

- the count of pull requests;
- the counts of the outcomes: settled in round 1, 2 or 3 (a settle event `pass` in that round), BLOCKED (a settle event `blocked`), and not settled;
- **last-gate pass:** the share of `pass` among the last decision events, with the count of pull requests that have a decision event.

### Security findings

- **Mode:** "Found in round 1" uses the round 1 event of each pull request. "Left at settle" uses the settle event of each settled pull request. The default is "Found in round 1". The mode is the query value `mode` of the API and of the page URL: `round1` or `settle`. The page leaves `mode` out of the URL for the default.
- **By severity and tier:** the `Security` row of the `matrix` of the chosen events, summed by severity (`blocker`, `major`, `minor`, `info`) and final tier, with a total for each severity. A chosen event with no `matrix` adds nothing, and the table shows the count of such pull requests as "N pull requests with no matrix: not counted". A `matrix` with no `Security` row adds zero.
- **Findings by category** and **findings by severity:** the sums of `categories` and of `counts` of the chosen events, in all categories.
- **Most frequent refs:** for each ref, the count of distinct pull requests that have it in the `refs` of one or more `gate` events, in any round. The mode does not change it. The 10 highest counts show, in order of the count from high to low, then of the ref name. The rest shows as "and N more". With the `security_criteria` module on, the factory gives refs, such as CWE and ASVS IDs, to Security findings.
- **Signals:** each pull request whose final tier is `general` or `inert` and whose decision events have one or more Security findings of severity `blocker`, `major` or `minor` in a `matrix`. For each severity, the count is the highest count in one decision event. The list shows the first 20 by repo ID and number, and "and N more". The note: "A Security finding in a low tier can show a path that the Risk map misses."

### Agent spans

- This view uses the **Agent spans** of the Sessions view Spec. A sub-agent span is whole: all Turns of one agent ID, from its first to its last Turn. The Sessions view cuts it to the day in scope; this view does not cut it.
- The Agent types that the view uses: `software-developer`, `review-finder`, `review-verifier` and `review-resolver`, with or without the prefix `factory-core:`.
- **The repo of a span:** the repo list entry whose `path` equals the Project key of the span, by the Project rule of the Sessions view Spec (a sibling worktree `<repo>.worktrees/<name>` counts as its repo).
- **The work item of a span:** by the work item rule of the Sessions view Spec, from the worktree name, else the branch, of its Turns. A span with no work item, or with two or more, links to no build. The section counts the spans of the three review Agent types in scope that link to no build for this reason, as "N review agent spans not linked: no single work item".
- **The link to a build:** a span links to a build when the repo and the work item of the span equal the repo and the issue of the build. The first Turn of the span must also be in the build window, from the build start to the settle. The builds of one repo and issue are in different runs, so their windows do not overlap. Thus a span links to at most one build.
- The Usage index updates on its own schedule (each 15 minutes, by the Sessions view Spec). The section shows the Usage "data as of" time. A span after that time is not yet in the index.

### Review time against build time

- **The builds.** The builds of each run in the window, from `runsInWindow`, by the build rules of the dash Spec. A build of a parent issue has no row, as in the dash Spec.
- **Build start:** the first line of the build with `to` IN PROGRESS, as in the dash Spec.
- **Settle:** the end line of the build with the result `merged`, `merge-ready` or `blocked`, by the table of the dash Spec.
- **Timed build:** a build with a build start and a settle in the same run. A build with the result `cancelled` has no row. Every other build with no build start or no settle in its run has no row, and counts in "N builds not timed: its start or its settle is in another run". A build that the factory resumes in a later run is in two runs, and thus not timed.
- **The pull request of a build**, by the first rule that applies: the number in the reason `merged #<n>` or `merge-ready #<n>` of a line of the build; else the `pr` of the newest `gate` event of that repo with that `issue` whose time is in the build window. A timed build with no pull request has no row, and counts in "N builds with no pull request".
- **Build end**, by the first rule that applies, with its source:
  1. "agent span": the last Turn of the last `software-developer` span that links to the build;
  2. "first gate event": the time of the first `gate` event of the pull request of the build in the build window;
  3. else "no build end".

  A build end outside the build window is not used.
- **Build time:** from the build start to the build end. **Review cycle:** from the build end to the settle. **Total:** from the build start to the settle.
- **Split of a Review cycle:** "review agents" is the time in the cycle that one or more linked `review-finder` or `review-verifier` spans cover. "Resolver" is the time in the cycle that linked `review-resolver` spans cover and no review agent span covers. "Other" is the rest: CI waits, gate steps and pushes. With no linked span of these three types, the cycle has no split.
- **Aggregates.** The medians, the review share and the tile use only the timed builds whose build end source is "agent span". The first gate event comes after the first review round, so a Review cycle from it leaves out that round; such a row shows its source, and counts in no aggregate.
- **By tier:** for each final tier and "no tier": the count of rows, the median build time, the median Review cycle, the mean rounds (or "—" with no `gate` event), and the review share. The median of an even count is the mean of the two middle values, rounded to a whole minute.
- **Each pull request:** a row with the repo, the number, the final tier, the rounds, the build time, the build end source, the Review cycle and its split, and the total, in pages, longest total first.
- Times show in whole minutes, as "N min" or "H h M min", by `apps/web/src/format`.

### Repos with no Control events

- A repo in scope whose cached Control modules do not list `control_events` shows the note of the scenario "A repo with Control events off".
- A repo in scope with no Control event in 30 days and no cached Control modules shows "no Control events in 30 days".
- Both show the Factory identity counts of the dash Spec, with its texts for "Factory identity login not set" and "not connected".

### Reviews API

All routes are below `/api/reviews`, and their schemas are in `packages/shared`. Query schemas use `.strict()`. The routes are `public: true` for the reason in the Usage ingest Spec. Each route takes the optional `client` value of the step 2 Spec.

`GET /api/reviews` takes the optional `mode` (`round1` or `settle`, default `round1`) and returns one document:

| Part | Holds |
|---|---|
| `tiles` | The four tiles, each with its value and count, or its "no data" state |
| `tierResults` | The counts by final tier, the path tier against final tier table, the count with no tier, and the merges by base and tier |
| `rounds` | For each final tier: the count, the outcome counts and the last-gate pass rate with its count |
| `findings` | For the mode: the Security table by severity and tier with its totals, the count with no matrix, the findings by category and by severity. For all modes: the 10 refs with the count of the rest, and up to 20 signals with the total. |
| `times` | The rows by tier, the count of builds with no build end, the count of builds not timed, the count of builds with no pull request, the count of review agent spans not linked, and the Usage "data as of" time |
| `eventsOff` | The repos with Control events off or with no Control events, with the Factory identity counts |
| `skipped` | The skip counts of the Control event and night log readers |
| `complete` | The count of repos in scope with no cache rows or a fetch error |
| `state` | `ok`, or `not_connected` when no repo in scope has cache rows |

`GET /api/reviews/pull-requests` takes the optional `repo` (a repo ID) and `tier` (a Risk tier or `none`), and `limit` (default 50, maximum 200) and `cursor`, by the list conventions of the Work view Spec. It returns the rows of "Each pull request": repo ID or folder label, number, issue, final tier, path tier, escalated flag, rounds, outcome, build time, build end source, Review cycle, split, total and link, and `nextCursor`. The order is the total time from high to low, then the repo ID, then the number. A repo ID outside the `client` gets status 400.

All times are UTC, in ISO 8601, and all durations are whole seconds. The responses hold no title, no body, no finding text, no `evidence`, no `paths` and no `waived` value.

### Web app

- This Spec owns `/reviews`. The nav shows the link "Reviews".
- The layout follows the prototype's "Reviews" tab: the tiles in one row, then Risk tier results and Rounds to settle side by side, then Security findings, then Review time against build time. At phone width, they stack.
- The mode buttons "Found in round 1" and "Left at settle" are toggle buttons with `aria-pressed`. A change sets `mode` in the URL and asks for `/api/reviews` with the new `mode`.
- The list of pull requests uses `apps/web/src/list`: the first page, and "Show more" for the next page.
- The web app asks for `/api/reviews` on load and each 60 seconds while `document.visibilityState` is `visible`, and updates the loaded pages of the list by the list conventions.
- The bars use `apps/web/src/charts`, and each chart has a table with the same values for screen readers. Each matrix is a table with row and column headers. Each cell shows its count as text. The colour scale uses the theme tokens and passes 4.5:1 contrast for the text in each cell, in the light and the dark theme. Each time bar has a text with each part in minutes, and the legend names "build", "review agents", "resolver" and "other".
- Repo names, refs and tiers are React text nodes. Links use only the `link` field, with `rel="noopener noreferrer"`.
- The signal list and the pull request list use the Work cache rows for their links. When one or more repos in scope have no cache rows or a fetch error, each shows "Data is not complete: N repos not connected. See Repos." The words "See Repos" link to the Repos section of the dash, because this page has no Repos section. When `state` is `not_connected`, each shows the step 2 "not connected" text above its rows. The numbers still show, because they come from local sources.

## Gating and rollout

- **Gating:** not required. The view adds a page and two routes, and changes no existing flow. The change to `apps/api/src/dash/runs` adds an export and keeps the dash result.
- **Rollout:** after the dash Spec is built, because this view uses its readers. The issues merge one by one into the Integration branch `feature/foreman-v1` (Integrated), in the order of "Build order"; the final pull request of that branch merges into the main branch. The note for a repo with Control events off needs the Control modules of the Controls view; until that slice merges, such a repo shows "no Control events in 30 days". Until the Agent span slice of the Sessions view merges, every build end comes from the first gate event, and the aggregates show "no timed build in 30 days". To undo, revert the change; the view stores nothing.
- **Field check:** before the Operator merges the Agent span slice of this Spec, the Operator checks the Turns of one real factory run on this Mac. The Turns of the `software-developer` and review agents must have the work item of the issue, in the worktree name or the branch, and the Project of the repo. No real transcript goes into the repo or the pull request. If they do not have it, the split shows for no row, and every build end comes from the first gate event.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The view shows repo names, pull request numbers, issue numbers, tiers, refs, counts and times. It shows no title, no finding text and no login, other than the Factory identity counts of the dash Spec.
- The Agent spans are times, Project keys, branch names and worktree names from the Usage index. The view does not show the Usage numbers of a Project.
- In a client scope, the view hides the data of other clients. A span links only to a build in scope.

## Out of scope

- "Review scope of recent reviews". It needs the `review-scope` Control event of factory Spec #85, which no code writes yet.
- From the prototype: "CI wait" as its own part of a time bar. No source has the start and end of a CI run; the time is in "other".
- From the prototype: the window "last 4 weeks". The Control event reader of the dash Spec has a window of 30 days.
- A night log line when a build opens its pull request. The factory does not write one, and this Spec asks for no factory change.
- The `factory/machine-gate` status of each pull request. The Work view Spec reads it.
- The `deferred` gate decision and the `deferred` and `deferral_cleared` Control events of factory ADR 0018. The `control_events.py` writer does not have them yet. Until a Foreman change adds them, the reader skips and counts them.
- Waivers in use and overdue findings. The Controls view shows the Waivers; `factory-next` shows the overdue findings.
- The text of a finding, its `evidence`, its file and the review threads.
- Builds outside the night log, for example a build in the Operator's own session.
- The times of a build that is in two runs.
- Cloud and CI sessions.
- Any action or write.

## Risks

- **A person can raise the tier with a `risk:*` label.** The view then shows the pull request on the diagonal, because no `escalated` event exists. The path tier is exact only for escalations by the review.
- **The Agent span link depends on the worktree name or the branch of a Turn.** The review agents can run in the folder of the `factory-run` session. Their Turns then have no work item of the issue, and the split does not show. The field check finds this before the slice merges.
- **The build end from an Agent span is an estimate.** The last `software-developer` Turn comes before the push and the open of the pull request, so the build time is a little short.
- **Merges before the switch-over have no `merged` event.** Before the switch-over to Releases, the Operator merges into the main branch, and the factory writes no `merged` event. "Merges by base and tier" then shows mostly `feature/*` bases.
- **An event older than 30 days is not read.** A pull request whose round 1 is older than 30 days and whose settle is newer shows only its newer events. Its round 1 event is then missing.
- **The night log reasons are text that the factory writes.** The pull request of a build comes from the prefixes `merged #<n>` and `merge-ready #<n>`, as in the dash Spec.

## Build order

Each slice is one pull request into the Integration branch `feature/foreman-v1`, in this order.

1. **Runs in the window.** `apps/api/src/dash/runs.ts` gains `runsInWindow`, and the dash uses its newest run; unit tests. Needs: the Spec 24 runs slice. The Spec 71 runs slice needs this slice.
2. **Pull request records and Risk tier results.** `apps/api/src/reviews/pr-records.ts`, `tier-results.ts`, `rounds.ts` and their unit tests. Needs: the Spec 24 Control event reader.
3. **Findings.** `apps/api/src/reviews/findings.ts` and its unit tests. Needs: slice 2.
4. **Build times.** `apps/api/src/reviews/times.ts` and its unit tests: the timed builds, the pull request of a build, the build end from the first gate event, the counts. Needs: slices 1 and 2.
5. **Agent span link and split.** `apps/api/src/reviews/times.ts` gains the Agent span link, the build end from an Agent span and the split; unit tests and an API test with a seeded Usage index. It also adds `subAgentSpansInWindow` to `apps/api/src/sessions/spans.ts`. Needs: slice 4, and the Spec 68 slices for `turns.worktree_name`, the Project rule and `apps/api/src/sessions/spans`. The field check runs before this slice merges.
6. **Reviews routes.** `apps/api/src/reviews/reviews.ts`, `apps/api/src/routes/reviews.ts`, `apps/api/src/app.ts`, `packages/shared/src/reviews.ts` and the API tests in `apps/api/test/`. Needs: slices 3 and 4, the Spec 65 list conventions slice, and for `eventsOff` the Spec 67 Control modules slice (until then, `eventsOff` lists only the repos with no Control events).
7. **Reviews page.** `apps/web/src/reviews/`, `apps/web/src/nav/`, `apps/web/src/App.tsx`, `e2e/reviews.spec.ts`. Needs: slice 6, the Spec 24 nav, the Spec 65 list conventions slice, and the Spec 69 theme, format, charts and usage status slices (69-2 for `usage-status`).

## Open questions

- None.
