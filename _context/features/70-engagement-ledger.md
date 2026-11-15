# Engagement ledger

**Status:** Approved
**Work items:** #70

Source: factory ADR 0007 (the **Engagement ledger** view: "Operator's interactive time and usage per client repo per day"), factory ADR 0005 (the **Solo build**: all Claude work runs under the Operator's own subscription), the factory glossary entry **Engagement ledger**, foreman ADR 0001 (the index keeps the times of the Operator's own messages for the ledger), foreman ADR 0004 (the **Interactive time** rule and its defaults), and the clean-room brief `2026-11-13-foreman-usage-brief.md` (13 Nov 2026), section 4. It builds on the approved Specs [`5-usage-ingest.md`](5-usage-ingest.md) (the user message times, issue #15), [`23-forge-and-tracker-connection.md`](23-forge-and-tracker-connection.md) (the **Client scope**) and [`24-foreman-dash.md`](24-foreman-dash.md) (the header nav). Layout reference: the prototype tab "Engagement ledger". Where the prototype and this Spec differ, this Spec is the master copy.

## Problem

In a **Solo build**, the Operator delivers for a client alone, and all Claude work runs under the Operator's own subscription. To invoice the client or to fill a timesheet, the Operator needs evidence of the time spent on each client repo on each day.

The factory works in two ways. In attended sessions, the Operator writes messages and reads the replies. In the **Unattended loop** and in long sub-agent runs, agents work alone. Only the first kind is the Operator's time. Today nothing shows the Operator's time per client repo per day, and nothing keeps it apart from the time that agents worked alone.

The **Usage index** already keeps the time of each real user message, with no text. Foreman needs a rule that turns these times into **Interactive time**, and a view that shows it per day and client repo, with the sessions and the tokens.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator reads the ledger to write invoices and timesheets.
- **Stakeholders of one client**: they can see the ledger in a screen share by the Operator, in that client's **Client scope**, as evidence for an invoice.

## Acceptance criteria

Fixtures are synthetic: a seeded **Usage index** with synthetic turns and user message times, and a synthetic repo list. No real transcript or message goes into the repo. Unless a scenario says otherwise, the ledger time zone is `Europe/London`, the idle cut-off is 15 minutes, the lead-in is 2 minutes, and the Operator's previous message is more than 2 hours before the first message of the scenario.

### Interactive time from message times

- **Given** real user messages in a session of the **Project** of `acme/payments-api` on 12 Nov 2026 at 09:00, 09:10, 09:20, 10:00 and 10:05
- **When** the web app asks for the ledger of 12 Nov
- **Then** the row of 12 Nov and `acme/payments-api` has 29 minutes of **Interactive time** and 5 messages
- **And** the page shows "0 h 29 min".

The five messages add 2, 10, 10, 2 and 5 minutes: the gap before 10:00 is 40 minutes, which is more than the idle cut-off.

### Agents that work alone

- **Given** a real user message at 14:00 that starts a build, sub-agent turns from 14:01 to 15:50, and the next real user message at 16:00, in the same Project on 12 Nov
- **When** the web app asks for the ledger
- **Then** these two messages add 4 minutes of **Interactive time**
- **And** the tokens of the row include all turns of the day in that Project, the sub-agent turns included.

### A day with no message

- **Given** a day on which a Project has turns of 1.5M tokens from sub-agents and no real user message
- **When** the web app asks for the ledger
- **Then** the row of that day has "0 h 0 min", 0 messages, 0 sessions and 1.5M tokens.

### A message in a sibling worktree

- **Given** the Project of `acme/payments-api` at `/synthetic/acme/payments-api`, and real user messages at 09:00 in that folder and at 09:05 in `/synthetic/acme/payments-api.worktrees/212-add-refunds`, which does not exist in the local runtime
- **When** a refresh runs and the web app asks for the ledger
- **Then** the `acme/payments-api` row of that day has 7 minutes and 2 messages, by the worktree path rule of the Sessions view Spec.

### Messages that do not count

- **Given** a session with 2 real user messages, 3 user records with only tool results, 1 record marked as meta, and a sub-agent transcript with a task prompt
- **When** the web app asks for the ledger
- **Then** the row has 2 messages
- **And** only these 2 messages add **Interactive time**.

### Two client repos at one time

- **Given** real user messages at 09:00 in `acme/payments-api`, at 09:05 in `globex/portal` and at 09:12 in `acme/payments-api`
- **When** the web app asks for the ledger in the scope "All"
- **Then** the `acme/payments-api` row has 9 minutes and the `globex/portal` row has 5 minutes
- **And** the sum of 14 minutes is the 12 minutes from 09:00 to 09:12 plus the lead-in of 2 minutes, so no minute counts twice.

### The scope does not change the time

- **Given** the messages of the scenario above
- **When** the web app asks for the ledger with the scope `acme`
- **Then** the response has only the `acme/payments-api` row
- **And** that row still has 9 minutes.

### A gap equal to the idle cut-off

- **Given** real user messages at 09:00 and 09:15, and in another session at 11:00 and 11:15:01
- **When** the web app asks for the ledger
- **Then** the message at 09:15 adds 15 minutes
- **And** the message at 11:15:01 adds 2 minutes.

### The first message

- **Given** a **Usage index** whose first real user message is at 08:30 on 12 Nov
- **When** the web app asks for the ledger
- **Then** that message adds 2 minutes.

### A gap across midnight

- **Given** real user messages at 23:55 on 11 Nov and at 00:05 on 12 Nov, in `Europe/London`
- **When** the web app asks for the ledger of 11 and 12 Nov
- **Then** the message at 00:05 adds 10 minutes to the row of 12 Nov
- **And** the gap does not start a new lead-in at midnight.

### The day of a message in the ledger time zone

- **Given** a real user message at `2026-07-01T23:30:00Z`
- **When** the web app asks for the ledger with the ledger time zone `Europe/London`
- **Then** the message is in the row of 2 Jul 2026, because it is 00:30 in British Summer Time
- **And** a turn at the same time counts in the tokens of 2 Jul.

### The clock change

- **Given** real user messages at `2026-10-25T00:55:00Z` (01:55 British Summer Time) and `2026-10-25T01:05:00Z` (01:05 Greenwich Mean Time)
- **When** the web app asks for the ledger
- **Then** the second message adds 10 minutes to the row of 25 Oct 2026.

### Rounding

- **Given** three rows whose messages add 89 seconds, 29 seconds and 30 seconds
- **When** the web app asks for the ledger
- **Then** the rows show 1 minute, 0 minutes and 1 minute
- **And** the totals row shows 2 minutes, the sum of the rounded rows.

### Sessions

- **Given** a session with real user messages on 12 and 13 Nov in `acme/payments-api`, and a second session with real user messages on 13 Nov in the same Project
- **When** the web app asks for the ledger of 12 and 13 Nov
- **Then** the row of 12 Nov has 1 session and the row of 13 Nov has 2 sessions
- **And** the summary of `acme/payments-api` has 2 sessions.

### Summary by client repo

- **Given** `acme/payments-api` rows with 29 minutes on 12 Nov, 1 h 2 min on 13 Nov and 0 minutes on 14 Nov, with 1.0M, 2.0M and 1.5M tokens
- **When** the page loads with the range 12 to 14 Nov
- **Then** the table "By client repo" shows `acme/payments-api` with "1 h 31 min", 2 days with interactive time and 4.5M tokens
- **And** the table has a totals row over all client repos in scope.

### A Project outside the repo list

- **Given** real user messages in the Project `spike-cli`, which matches no repo list entry
- **When** the web app asks for the ledger with no scope, and with the scope `acme`
- **Then** the first response has a `spike-cli` row with the label `spike-cli` and the client "Unassigned"
- **And** the second response has no `spike-cli` row
- **And** the `spike-cli` messages still count on the Operator's timeline in both.

### The label of a client repo

- **Given** a repo list entry with `repo` `acme/payments-api` and a `path` that equals a Project key, and an entry with no `repo` whose `path` equals the key of the Project `old-site`
- **When** the web app asks for the ledger
- **Then** the rows of the first Project have the label `acme/payments-api`
- **And** the rows of the second have the label `old-site`.

### The default range

- **Given** today is 15 Nov 2026 in the ledger time zone
- **When** the web app asks for the ledger with no `from` and no `to`
- **Then** the response has the range 1 to 15 Nov 2026
- **And** the page shows "This month" as the selected range.

### Pages of rows

- **Given** 130 ledger rows in the range
- **When** the web app asks for the ledger, then asks again with the `nextCursor` of the response
- **Then** the first response has 100 rows, `rowCount` 130 and a `nextCursor`
- **And** the second response has 30 rows and the `nextCursor` null
- **And** both responses have the same summary and totals.

### An invalid query

- **Given** a running API
- **When** a request to `/api/ledger` has a `from` date after its `to` date, only one of `from` and `to`, a range of more than 366 days, a `limit` of 0 or 501, a cursor that is not valid, an unknown client or an unknown query value such as `tz`
- **Then** the API rejects it with status 400.

### The rules come from the configuration

- **Given** the messages of the scenario "Interactive time from message times", and `FOREMAN_LEDGER_IDLE_MINUTES=45`
- **When** the API starts and the web app asks for the ledger
- **Then** the row has 67 minutes
- **And** the page shows "Each of your messages adds the time since your previous message, when that time is 45 minutes or less. Else it adds 2 minutes. Days are in Europe/London."

### An invalid configuration

- **Given** `FOREMAN_LEDGER_TIME_ZONE=Mars/Base`, or `FOREMAN_LEDGER_IDLE_MINUTES=0`, or `FOREMAN_LEDGER_LEAD_IN_MINUTES=20` with an idle cut-off of 15
- **When** the API starts
- **Then** it stops with a message that names the variable.

### The page

- **Given** ledger rows in the range
- **When** the Operator opens `/ledger`
- **Then** the page shows the table "By client repo", then the table "By day" with the columns Day, Client repo, Interactive time, Messages, Sessions and Tokens, sorted by day from new to old
- **And** it shows "From the times of your own messages. It never counts agents that worked alone." and "Evidence for invoices and timesheets in a Solo build. It is an estimate from message times, not a record of hours worked."
- **And** the header nav marks "Engagement ledger" as the current view.

### Show more rows

- **Given** 130 rows in the range
- **When** the Operator selects "Show more"
- **Then** the table "By day" shows all 130 rows, and the button is no longer there.

### Range and Back

- **Given** the page with "This month"
- **When** the Operator selects "Last month", then the browser Back button
- **Then** the URL holds `from=2026-10-01&to=2026-10-31`, then no range values, and the page shows "This month" again.

### An invalid URL value

- **Given** the URL `/ledger?from=2026-11-20&to=2026-11-01`
- **When** the page loads
- **Then** the page uses "This month" and shows "The link has a value that is not valid. The page shows this month."

### Nothing in the range

- **Given** no real user message and no turn in the range in scope
- **When** the page loads
- **Then** each table shows "No messages and no usage in this range in this scope."

### Refresh and live status

- **Given** the page is open in a visible tab
- **When** a usage refresh runs, ends, or 60 seconds pass
- **Then** the page shows the refresh progress and the "Usage data as of" time with the usage status module of the Usage view Spec
- **And** it loads the tables again only when the "data as of" time changed.

### No message text

- **Given** a ledger response
- **When** the test reads it
- **Then** it holds no message text and no single message time, only the sums of each day and client repo.

### Accessibility

- **Given** each fixture set of the scenarios "The page", "Show more rows", "A Project outside the repo list" and "Nothing in the range"
- **When** the end-to-end test opens the page with each set, in the light theme and in the dark theme
- **Then** the axe scan finds no WCAG 2.2 AA violation
- **And** at a width of 375 pixels the page has no horizontal page scroll.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/ledger/interactive-time` | The **Interactive time** rule: from a sorted list of message times, the seconds that each message adds. A pure function. |
| `apps/api/src/ledger/ledger` | One ledger response: the messages, the turns, the Project clients and labels, the rows, the summary and the totals |
| `apps/api/src/routes/ledger.ts` | The ledger route, in its own plugin |
| `apps/api/src/config.ts` | The three ledger variables |
| `packages/shared` | The Zod schemas of the ledger query and response |
| `apps/web/src/ledger` | The ledger page: the range control, the two tables and the notes |
| `apps/web/src/nav` | Gains the link "Engagement ledger" |
| `e2e/ledger.spec.ts` | The end-to-end tests with the axe scan, in both themes |

The page uses the `format`, `theme` and `usage-status` modules of the Usage view Spec, and the list conventions of the Work view Spec (`limit`, `cursor`, `nextCursor` and "Show more"). It does not define them again.

### Configuration

| Variable | Default | Use |
|---|---|---|
| `FOREMAN_LEDGER_TIME_ZONE` | `Europe/London` | The IANA time zone of the ledger days and of the default range. The API stops at start-up on an unknown zone. |
| `FOREMAN_LEDGER_IDLE_MINUTES` | `15` | The idle cut-off: the longest gap between two messages that counts in full. An integer from 1 to 120. |
| `FOREMAN_LEDGER_LEAD_IN_MINUTES` | `2` | The lead-in: what a message after a longer gap adds. An integer from 0 to the idle cut-off. |

No source sets these numbers. This Spec chooses them:

- **15 minutes** is long enough to read a reply and write the next message, and short enough that a break or an agent run of more than 15 minutes does not count.
- **2 minutes** is a short time to read the context and write the first message after a break. Without a lead-in, a single message after a break would add nothing.
- **A fixed time zone** keeps the days of an invoice the same on every machine and browser. The Usage view groups by the browser's zone; the ledger does not, so a day total can differ from the Usage view when the two zones differ.

The lead-in cannot be longer than the idle cut-off. Then the times that two messages add never overlap.

### Data sources

The ledger reads only the **Usage index** and the repo list. It needs no token, so it never shows the "not connected" text or the "Data is not complete" text of the dash Spec. The header still shows the connection state of the step 2 Spec.

| Value | Source |
|---|---|
| Message times | `user_messages` of the Usage ingest Spec (issue #15): the record ID, the session ID, the time and the Project key of each real user message, with the indexes on the time and the session ID that issue #15 adds. A real user message is a user record in the main session file that is not marked as meta and that has content other than `tool_result` blocks. A sub-agent transcript never has one. |
| Tokens | `turns`: input, output, cache write and cache read tokens, the time and the Project key of each **Turn**, main and sub-agent turns together |
| Client and label | The repo list entry whose `path` equals the Project key, by the step 2 section "Client scope" |
| "Usage data as of" | `GET /api/usage/status` |

### Interactive time

**Interactive time** is the time that the Operator spent in sessions, estimated from the times of the Operator's own real user messages.

1. Put all real user messages of the **Usage index** on one timeline, in order of time, then of record ID. The timeline has the messages of every Project and every session, also of Projects outside the scope and outside the repo list.
2. For each message, the gap is the time since the message before it on the timeline. The first message of the index has no gap.
3. A message whose gap is equal to the idle cut-off or shorter adds the gap. Any other message adds the lead-in.
4. The time that a message adds belongs to the message's Project and to the day of the message in the ledger time zone. A gap that crosses midnight belongs in full to the day of the later message.
5. Time after the last message of a stretch never counts. Time that agents worked alone counts only when the Operator wrote again within the idle cut-off.

The rule uses UTC times for the gaps, so a clock change adds or removes no time. The time that each message adds ends at the message and starts after the message before it, so no second counts twice and the total is never more than the clock time plus one lead-in for each stretch.

The rule works in whole seconds. Each row rounds its seconds to whole minutes, with 30 seconds and more rounded up. The summary and the totals add the rounded rows, so the totals equal the sum of the rows that the Operator sees.

Foreman calculates the ledger when it reads, and never stores it. A change to a ledger variable changes all of the history after the API restarts. The page shows the rule with the values in force.

### Rows

- A row is one Project on one day in the ledger time zone. It exists when the Project has one or more real user messages or one or more turns on that day.
- **Interactive time**: the minutes of the row, by the rule above.
- **Messages**: the count of real user messages.
- **Sessions**: the count of distinct sessions with one or more real user messages in that Project on that day. A session that has only sub-agent turns, for example a build of the **Unattended loop**, does not count.
- **Tokens**: the sum of input, output, cache write and cache read tokens of all turns of that Project on that day. This includes the turns of agents that worked alone, because the tokens measure the usage, not the Operator's time.
- **Client repo**: the `repo` (`owner/name`) of the matching repo list entry. When the entry has no `repo`, or no entry matches, the label is the Project label of the Usage ingest Spec.
- **Client**: the client of the matching entry, or none, which the page shows as "Unassigned".
- In a client scope, the response has only the rows of that client's Projects. The scope never changes the time of a row, because the timeline always holds all messages.

### Summary by client repo

- One line for each Project in the rows of the range in scope, with its `projectId`: the client repo, the client, the sum of the row minutes, the count of days with more than 0 minutes, the count of distinct sessions over the range, and the sum of the tokens.
- Sorted by the client, with "Unassigned" last, then by the label, then by the Project ID. The response has at most 500 lines; more lines are cut and counted.

### Ledger API

`GET /api/ledger`. The query schema uses `.strict()`. The route is `public: true` for the reason in the Usage ingest Spec. The route has no `tz` value: the ledger time zone comes from the configuration.

Query values, all optional:

- `from` and `to`: dates `YYYY-MM-DD` in the ledger time zone, both included, both or neither. With neither, the range is the first day of the current month to today. A `from` date after its `to` date, only one of the two, or a range of more than 366 days with both days counted, gets status 400.
- `client`: the scope of the step 2 Spec. An unknown client gets status 400.
- `limit`: the rows of one page, default 100, maximum 500.
- `cursor`: the `nextCursor` of an earlier response. It is an opaque base64url value of the last sort key. A cursor that is not valid gets status 400.

The response:

| Part | Holds |
|---|---|
| `rules` | `timeZone`, `idleMinutes` and `leadInMinutes` in force |
| `range` | `from` and `to` |
| `rows` | Up to `limit` rows, each with `day`, `projectId`, `repoId` (or null), `label`, `client` (or null), `interactiveMinutes`, `messages`, `sessions` and `tokens` |
| `rowCount` | The count of rows in the range in scope |
| `nextCursor` | The cursor of the next page, or null |
| `repos` | The summary by client repo: up to 500 lines, each with `projectId`, `repoId` (or null), `label`, `client` (or null), `interactiveMinutes`, `days`, `sessions` and `tokens`; and `cut`, the count of lines that were cut |
| `totals` | `interactiveMinutes`, `messages`, `sessions` (distinct over the range) and `tokens` over all rows in scope |

Order of the rows: the day from new to old, then the label, then the Project ID. The summary and the totals cover all rows, not only the rows of the page.

`projectId` is the Project ID of the Usage ingest Spec, and `repoId` is the repo ID of the step 2 Spec. The response holds no path, no message text and no single message time.

The API reads the messages from the start of the range back to the message before it, and the turns of the range, in two queries. It computes the rows in memory; a range has at most 366 days.

### Web app

- Route `/ledger`. URL values: `from` and `to`, and the `client` of the step 2 Spec. With no range values, the page asks for the default range.
- The range control: "This month", "Last month" and two dates. Each change adds one history entry. An invalid range in the URL falls back to "This month", with no new history entry, and the page shows "The link has a value that is not valid. The page shows this month."
- From the top: the heading "Engagement ledger", the source sentence, the evidence sentence, the rule sentence with the values from `rules`, the table "By client repo", the table "By day" with "Show more", and the note "Days are in <time zone>, the ledger's time zone, not the browser's."
- The table "By day" loads more rows with `nextCursor` when the Operator selects "Show more".
- Formats: the format module of the Usage view Spec. **Interactive time** uses its duration format, for example "2 h 40 min" and "0 h 0 min". Days look like "13 Nov 2026". A ledger day is a `YYYY-MM-DD` value in the ledger time zone, so the page formats it as a date with no time zone change.
- Labels are React text nodes, by the step 2 rules. The rows are not links.
- The tables have a caption and header cells with `scope`. At phone width, the tables scroll inside their own box.
- Refresh and live status: as in the Usage view Spec. The page asks `/api/usage/status` on load and each 60 seconds while visible, and loads the ledger again when the "data as of" time changed.
- States: a skeleton while loading, one sentence when empty, one status line with `role="status"` on an error.

## Gating and rollout

- **Gating:** not required. The ledger adds a route and a page, and reads data that the Usage index already holds.
- **Rollout:** the issues merge into the Integration branch `feature/foreman-v1` (Integrated), in the order of the section "Build order". The ledger shows correct real data only after issue #15 and the worktree path rule of the Sessions view Spec (slice 68-1) reach the local runtime and the Operator runs `pnpm local:reindex` once: an index from before issue #15 has no message times, and an index from before slice 68-1 puts the messages of a sibling worktree in a Project of its own, outside the Client scope.
- **Undo:** revert the change. The ledger stores nothing.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The ledger shows the Operator's own working pattern: the minutes, messages and sessions of each day. This is personal data of the Operator. It stays on this Mac, and in a client scope the page shows only that client's rows.
- The ledger adds no stored data. The **Usage index** already holds the message times, with no text.

## Out of scope

- The exclusions of every Foreman v1 view: "Review scope of recent reviews" (it needs the `review-scope` Control event of factory Spec #85, which no code writes yet), overdue findings, the deferred finding events of factory ADR 0018, any action or write other than the refresh request, and cloud and CI sessions.
- A money column, a rate or an invoice. The ledger is evidence for the Operator's invoice, not the invoice.
- The **List-price estimate**. On a page for invoices, a reader can take it for a charge (ADR 0002).
- CSV or JSON export, and a print layout.
- A change, a note or a lock on a ledger row, and a frozen copy of a month. The ledger is read-only and calculated on read.
- The Engagement mode of each repo. The repo list has no such field. The Controls view caches `.claude/factory.json`, which has `engagement_mode`, but that cache needs a token and a fetch, and the ledger reads only local data.
- Time from other sources: calendars, commits, reviews on the forge web site, and reading or meetings outside Claude Code.
- The time of the client's own engineers in a **Team build**. Foreman reads only the Operator's config folder.
- Sessions in another config folder.
- A per-browser time zone for the ledger.

## Risks

- **Interactive time is an estimate.** It does not count reading or thinking for more than the idle cut-off with no message, for example a long review of a Spec. It counts up to the idle cut-off when the Operator was away and came back. The page says that it is an estimate, and the Operator adds time from other sources on the timesheet.
- **A change to a ledger variable changes the past.** A month that the Operator invoiced can show other minutes after the change. The page shows the rule in force. The Operator keeps the numbers of each invoice in the invoice.
- **Some user records are not the Operator's typing.** A Claude Desktop scheduled task starts its session with a prompt that the transcript records as a user message. The ledger counts it as one message: one lead-in, in the Project where the task runs. The fields that the Usage ingest Spec reads cannot tell them apart.
- **A Project whose key differs from its repo list `path`** shows as "Unassigned" and only in "All" (the step 2 risk). Its time then does not show in the client's scope.

## Build order

Each slice is one PR-sized issue. A slice of another Spec that it needs is named with its Spec number or issue.

1. **70-1 The Interactive time rule and its configuration.** `apps/api/src/ledger/interactive-time`, `apps/api/src/config.ts`, with unit tests. The scenarios of the rule (message times, agents that work alone, the idle cut-off, the first message, midnight, the time zone, the clock change, rounding) and "An invalid configuration". Needs: none.
2. **70-2 The ledger route.** `apps/api/src/ledger/ledger`, `apps/api/src/routes/ledger.ts`, `packages/shared`, `apps/api/test/`. The scenarios of the rows, the sessions, the summary, the labels, the scope, paging, the default range, invalid queries, "The rules come from the configuration" (API part), "A message in a sibling worktree" and "No message text". Needs: 70-1; issue #15; Spec 23 issue #35 (the client of a Project); Spec 68 slice 68-1 for the sibling worktree scenario.
3. **70-3 The ledger page.** `apps/web/src/ledger`, `apps/web/src/nav`. The page, range, Back, invalid URL, empty, Show more and live status scenarios. Needs: 70-2; Spec 69 slices 69-1 and 69-2; Spec 24 issue #40 (the nav); Spec 23 issue #36 (the header).
4. **70-4 Ledger end-to-end tests.** `e2e/ledger.spec.ts` with the axe scan in both themes and the 375-pixel check. Needs: 70-3.

## Open questions

- None. The rule and its defaults (15 minutes idle, 2 minutes lead-in, `Europe/London`) stand, and foreman ADR 0004 records them.
