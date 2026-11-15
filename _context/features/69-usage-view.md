# Usage view

**Status:** Approved
**Work items:** #69

Source: the clean-room brief `2026-11-13-foreman-usage-brief.md` (13 Nov 2026), section 8 (Spec B), with sections 6 and 7. Foreman ADR 0002 (the **List-price estimate**). It builds on the approved Specs [`5-usage-ingest.md`](5-usage-ingest.md) (the usage API), [`23-forge-and-tracker-connection.md`](23-forge-and-tracker-connection.md) (the **Client scope** and the header) and [`24-foreman-dash.md`](24-foreman-dash.md) (the header nav). Layout reference: the prototype tab "Usage". Where the prototype, the brief and this Spec differ, this Spec is the master copy.

## Problem

The Usage ingest Spec builds a **Usage index** and a usage API, but Foreman has no page that shows them. The Operator cannot see which **Project**, model, **Agent type** or skill uses the tokens, how the use changes over time, or how close the plan came to each **Limit window**.

The Operator also shows Foreman to stakeholders of one client. A screen share in that client's **Client scope** must show only that client's usage. The **Limit windows** belong to the whole plan and hold the load of every client, so the view shows them only in the scope "All", with a clear note.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator reads the Usage view to plan limit use and to compare Projects, models and skills.
- **Stakeholders of one client**: they see the Usage view only in a screen share by the Operator, in that client's **Client scope**.

## Acceptance criteria

Fixtures are synthetic: a seeded **Usage index**, a synthetic repo list and synthetic **Limit readings**. No real transcript, repo or reading goes into the repo. In the examples, the browser time zone is `Europe/London` and the current time is 15 Nov 2026, 12:00.

### The view and its defaults

- **When** the Operator opens `/usage` with no other URL value
- **Then** the page shows the last 14 days (2 to 15 Nov 2026), the grain "day", the metric "Tokens" and the tab "Project"
- **And** the URL holds `range=14d`, `grain=day`, `metric=tokens` and `tab=project`, with no new history entry
- **And** the header nav marks "Usage" as the current view.

### The summary tiles

- **Given** turns in the last 14 days with 1,200,000 input, 300,000 output, 500,000 cache write and 10,400,000 cache read tokens, and a **List-price estimate** of $41.27
- **When** the page loads
- **Then** the first tile shows "Tokens, last 14 days" and "12.4M"
- **And** under it, "List-price estimate $41.27" and the note "List-price estimate: what this usage costs at the public API prices. It is not what your subscription charges."

### Unpriced turns

- **Given** 3 turns of the model `synthetic-model-x`, which no price table row matches, in the range
- **When** the page loads with the metric "List-price estimate"
- **Then** the estimate tile and the "Usage over time" panel show "3 turns unpriced (model synthetic-model-x)".

### The latest Limit readings

- **Given** a latest **Limit reading** at 09:41 with 62% for the 5-hour window, which resets at 13:00, and 48% for the 7-day window, which resets on Thu 19 Nov at 09:00
- **When** the page loads
- **Then** the 5-hour tile shows "62%", "resets 13:00" and "latest reading 09:41, 2 hours ago"
- **And** the 7-day tile shows "48%", "resets Thu 19 Nov, 09:00" and the same reading time
- **And** each tile shows the note "Plan-wide: all clients and Projects".

The scenarios of the limit tiles and the Limit history use the scope "All".

### A window that reset after its latest reading

- **Given** a latest 5-hour reading at 07:10 with 81%, which reset at 09:00
- **When** the page loads at 12:00
- **Then** the 5-hour tile shows "The window reset at 09:00. No reading since." and no percentage.

### No limit reading

- **Given** no **Limit reading**
- **When** the page loads
- **Then** each limit tile and each Limit history chart shows "No reading"
- **And** the other panels show their data.

### Limit history

- **Given** the range "last 12 weeks", and 12 past 7-day windows with the peaks 35, 52, 64, 71, 88, 90, 93, 60, 97, 45, 91 and 69%
- **When** the page loads
- **Then** the 7-day chart shows 12 bars with lines at 70% and 90%
- **And** the summary shows "4 of the last 12 7-day windows reached 90% or more"
- **And** each bar has a state word as well as a colour: "under 70%", "70% or more" or "90% or more".

### The window that runs now

- **Given** a 5-hour window whose reset time is later today
- **When** the Limit history shows it
- **Then** its bar has the label "in progress" and shows the peak so far.

### Limit windows in a client scope

- **Given** the scope `acme`, and Limit readings that show in the scope "All"
- **When** the page loads
- **Then** the page shows no limit tile and no Limit history panel
- **And** the tiles row shows the note "Limit windows are plan-wide. They show only in the scope All."
- **And** the web app sends no request to `/api/usage/limits`.

### Usage in a client scope

- **Given** turns of 8.0M tokens in the Project `payments-api` of `acme`, 3.0M in `foreman` of `bebopaloo`, and 0.4M in `spike-cli`, which matches no repo list entry
- **When** the page loads with the scope `acme`
- **Then** the tokens tile shows "8.0M", and the By Project table and every chart use only the `acme` turns
- **And** with the scope "All", the tile shows "11.4M" and the table lists `spike-cli` with the client "Unassigned".

### By Project

- **Given** the turns of the scenario above, and the scope "All"
- **When** the page loads
- **Then** the tab "Project" lists `payments-api`, `foreman` and `spike-cli`, sorted by tokens
- **And** each row has the share, the client, the input, output, cache write and cache read tokens, the turns and the **List-price estimate**
- **And** the table has a totals row and the caption "Usage by Project".

### A Project row opens the Project page

- **Given** the By Project table
- **When** the Operator selects the row `payments-api`
- **Then** Foreman opens `/usage/projects/<Project ID>` with the same range, grain, metric and scope
- **And** a row of any other tab, and a bar of any chart, is not a link and does not react to a click.

### The Project page

- **Given** the Project page of `payments-api`
- **When** the page loads
- **Then** the page heading shows `payments-api` and its client `acme`
- **And** it shows the same panels as `/usage` for that Project only, with the tabs Model, Agent type, Skill, Branch and Session, and the tab Model first.

### A Project outside the scope

- **Given** the scope `acme`
- **When** the Operator opens the Project page of the `bebopaloo` Project `foreman`, or of a Project ID that matches no Project
- **Then** the page shows "No such Project in this scope." and no usage data
- **And** the web app sends no request to `/api/usage/breakdown` or `/api/usage/series` for that Project ID.

### Metric switch

- **Given** the page with the metric "Tokens"
- **When** the Operator chooses "Turns", then "List-price estimate"
- **Then** the "Usage over time" chart, the share column and the activity calendar use that metric each time
- **And** the URL holds `metric=turns`, then `metric=estimate`.

### Browser Back

- **Given** the Operator changed the range to "last 30 days", then the tab to "Model"
- **When** the Operator selects the browser Back button twice
- **Then** the page shows the tab "Project" with the range "last 30 days", and then the range "last 14 days".

### An invalid URL value

- **Given** the URL `/usage?range=0d&grain=hour&metric=cost`, or `from=2026-11-20&to=2026-11-01`
- **When** the page loads
- **Then** the page uses the default of each invalid value
- **And** it shows "The link has a value that is not valid. The page shows the defaults for it."

### An absolute range

- **Given** the Operator chooses the dates 1 Oct 2026 and 31 Oct 2026
- **When** the page loads
- **Then** the URL holds `from=2026-10-01&to=2026-10-31` and no `range`
- **And** the first tile shows "Tokens, 1 Oct 2026 to 31 Oct 2026".

### Skill tab

- **Given** the skill `factory-core:to-code` with 4 calls, 120 exact turns and 30 estimated turns
- **When** the Operator opens the tab "Skill"
- **Then** the row shows 4 calls, 120 exact turns and 30 estimated turns in separate columns
- **And** the tab shows "Estimated turns are an estimate: the turns of the main conversation from a skill call to your next message."

### Session tab

- **Given** 40 sessions in the range
- **When** the Operator opens the tab "Session"
- **Then** the table shows the 25 sessions with the most tokens, each with its Project label and its first and last turn time
- **And** the note "Top 25 of 40 sessions. The totals include all 40 sessions."

### Sort a table

- **Given** the tab "Model" with 3 rows
- **When** the Operator selects the header "Turns"
- **Then** the rows sort by turns from high to low, and the header has `aria-sort="descending"`
- **And** a second selection sorts from low to high
- **And** the totals row stays last.

### Usage over time

- **Given** the range "last 14 days", the grain "day", and no turns on 4 and 8 Nov
- **When** the page loads
- **Then** the chart "Tokens by day" shows 14 bars, with zero bars on 4 and 8 Nov
- **And** a table with the same values is available to a screen reader.

### Activity calendar

- **Given** the range "last 14 days"
- **When** the page loads
- **Then** the activity calendar shows the 26 weeks up to today, with weeks that start on Monday
- **And** it says "Last 26 weeks. This panel ignores the date range."
- **And** each day cell has an accessible name, for example "13 Nov 2026: 1.2M tokens".

### Cache efficiency

- **Given** turns in the range with 100,000 input, 50,000 cache write and 850,000 cache read tokens
- **When** the page loads
- **Then** the panel shows "Cache hit ratio 85%" and "850K input tokens came from the cache".

### Month outlook

- **Given** a **List-price estimate** of $30.00 from 1 to 15 Nov 2026
- **When** the page loads
- **Then** the panel shows "$30.00 so far this month" and "Projection to 30 Nov: $60.00"
- **And** it says "The projection takes the average per day so far this month, times the days of the month. This panel ignores the date range."

### Refresh progress

- **Given** a usage refresh that runs, with 1,240 of 3,100 files read
- **When** the page loads
- **Then** it shows "Reading the history: 1,240 of 3,100 files" with `role="status"`
- **And** it asks `/api/usage/status` each 2 seconds while the state is "running"
- **And** when the state becomes "idle", it loads the panels again and shows the new "Usage data as of" time.

### A failed refresh

- **Given** a usage refresh in the state "failed" with the reason "The database is not available.", and a last good refresh at 09:42
- **When** the page loads
- **Then** it shows "The last usage refresh failed. The database is not available. The page shows the data as of 15 Nov 2026, 09:42."

### Live status

- **Given** the page is open in a visible tab
- **When** 60 seconds pass
- **Then** the web app asks `/api/usage/status` again
- **And** it loads the panels again only when the "data as of" time changed
- **And** while the tab is hidden, it does not ask.

### No usage in the range

- **Given** no turn in the range in scope
- **When** the page loads
- **Then** each usage panel shows one sentence, for example "No usage in this range in this scope."
- **And** in the scope "All", the limit tiles still show the latest readings.

### A panel fails

- **Given** an API that returns status 500 for `/api/usage/breakdown` and valid data for the other routes
- **When** the page loads
- **Then** the "Usage by dimension" panel shows one status line with `role="status"`, for example "This panel cannot load the data. Try Refresh."
- **And** the other panels show their data.

### No usage data yet

- **Given** a usage status with no "data as of" time, because no refresh has ended
- **When** the page loads
- **Then** the filter bar shows "No usage data yet" in place of "Usage data as of"
- **And** each usage panel shows "No usage in this range in this scope."

### Loading

- **Given** an API that has not answered yet
- **When** the page loads
- **Then** each panel shows a skeleton in its own shape, and the page does not move when the data arrives.

### Formats

- **Given** an estimate of $0.004, a missing estimate, 1,234,567 tokens and a reading 6 hours ago
- **When** the page shows them
- **Then** they show as "<$0.01", "—", "1.2M" and "6 hours ago"
- **And** the footer shows "Times in Europe/London".

### Compact token numbers

- **Given** the token counts 812, 5,340, 850,000, 999,960, 1,000,000 and 12,400,000
- **When** the format module formats them
- **Then** they show as "812", "5.3K", "850K", "1M", "1M" and "12.4M".

### The client of a Project in the API

- **Given** a Project whose key equals the `path` of a repo list entry with the client `acme`, and a Project that matches no entry
- **When** the web app asks `/api/usage/breakdown?dimension=project` and `/api/usage/projects`
- **Then** the first Project has `client: "acme"` in both responses
- **And** the second has `client: null`.

### Theme

- **Given** the theme "auto" and a browser in dark mode
- **When** the Operator selects the theme button three times
- **Then** the page shows the light theme, then the dark theme, then "auto" again, with the dark theme
- **And** the accessible name of the button is "Theme: light", then "Theme: dark", then "Theme: auto (dark)"
- **And** when the browser storage cannot be read, the theme is "auto".

### Accessibility

- **Given** each fixture set of the scenarios "The summary tiles", "No limit reading", "Limit windows in a client scope", "Usage in a client scope", "The Project page", "Refresh progress", "No usage in the range" and "A panel fails"
- **When** the end-to-end test opens the page with each set, in the light theme and in the dark theme
- **Then** the axe scan finds no WCAG 2.2 AA violation
- **And** at a width of 375 pixels the page has no horizontal page scroll.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/routes/usage.ts` | Adds `client` to the Project rows of `/breakdown` and to `/projects` |
| `packages/shared` | The `client` field in `UsageProject` and in the Project rows of `BreakdownResponse` |
| `apps/web/src/usage` | The Usage page and the Project page, with the panels below |
| `apps/web/src/usage/url-state` | Reads, checks and writes the range, the grain, the metric and the tab in the URL |
| `apps/web/src/charts` | Shared by all views. The bar chart, the limit chart and the activity calendar, each with its text equivalent |
| `apps/web/src/thresholds` | The limit cut-offs, 70% and 90%, and the state word of each band |
| `apps/web/src/format` | Shared by all views. Token, number, money, date, time and relative time formats, locale `en-GB`, in the browser's time zone |
| `apps/web/src/theme` | Shared by all views. The theme button and the colour tokens, light and dark |
| `apps/web/src/usage-status` | Shared by the views that read the **Usage index**. "Usage data as of", the refresh progress, the failed state and the status checks (section "Refresh and live status") |
| `apps/web/src/nav` | Gains the link "Usage" |
| `apps/web/package.json` | Gains `recharts` at an exact version that is 7 days old or more |
| `e2e/usage.spec.ts` | The end-to-end tests with the axe scan, in both themes |

The Sessions view, the Engagement ledger and the other views use `theme`, `format` and `charts`, and the Sessions view and the Engagement ledger use `usage-status`. They do not define them again.

### Configuration

No new variable. The view uses the variables of the Usage ingest Spec and of the step 2 Spec.

### Data sources

The view reads only the usage API of the Usage ingest Spec, with the `client` value of the step 2 Spec. All its data comes from the **Usage index**, which Foreman builds from local files.

| Panel | Route and values |
|---|---|
| Summary tile, Usage by dimension, Cache efficiency | `GET /api/usage/breakdown` with `from`, `to`, `tz`, `dimension`, `client`, `project` and `limit` |
| Usage over time | `GET /api/usage/series` with `from`, `to`, `tz`, `grain`, `client` and `project` |
| Activity calendar | `GET /api/usage/series` with the grain `day`, from the Monday 25 weeks before the Monday of this week to today |
| Month outlook | `GET /api/usage/series` with the grain `day`, from the first day of this month to today |
| Limit tiles, Limit history | `GET /api/usage/limits` with `from`, `to` and `tz`, never with `client`, and only in the scope "All" |
| Project page heading | `GET /api/usage/projects` with `client` and `limit=1000` |
| Refresh progress, "Usage data as of" | `GET /api/usage/status` |

The view needs no token. Its panels never show the "not connected" text or the "Data is not complete" text of the dash Spec, because no panel uses the **Work cache**. The header still shows the connection state of the step 2 Spec.

### Usage API changes

The routes of the Usage ingest Spec (`/breakdown`, `/series`, `/projects`, `/limits` and `/status`) and the `client` value of the step 2 Spec (#35) stay as they are, with one addition:

- Each row of `GET /api/usage/breakdown?dimension=project` and each Project of `GET /api/usage/projects` gets `client`: the client of the repo list entry whose `path` equals the Project key, or `null`. The rules are those of the step 2 section "Client scope". Rows of other dimensions have no `client` field.
- A Project with no matching entry, or whose entry has no `client`, has `client: null`. The web app shows it as "Unassigned".

The step 2 rule stands: `/api/usage/limits` takes no `client` value, a request with one gets status 400, and the Usage view hides the limit panels in a client scope.

The `/limits` response gives, for each **Limit window**: the windows whose reset time is between `from` and `to`, each with its reset time and its peak used percentage; and the latest reading, with its time, its used percentage and its reset time. This is the shape of the Usage ingest Spec, which issue #18 builds; issue #18 must return the used percentage and the reset time of the latest reading as well as its time.

To show the window that runs now, the page asks `/limits` with `to` set to 7 days after the end of the range when the range ends today. A window whose reset time is after now is then in the list.

### Pages and URL values

| Route | Shows |
|---|---|
| `/usage` | All Projects in the scope. Tabs: Project, Model, Agent type, Skill, Branch, Session. |
| `/usage/projects/<Project ID>` | One Project. Tabs: Model, Agent type, Skill, Branch, Session. |

URL values, all optional:

| Value | Allowed | Default |
|---|---|---|
| `range` | `<N>d`, `<N>w` or `<N>m`, with `N` from 1 to 365 | `14d` |
| `from`, `to` | dates `YYYY-MM-DD`, with `from` not after `to`; both or neither | none |
| `grain` | `day`, `week`, `month` | `day` |
| `metric` | `tokens`, `turns`, `estimate` | `tokens` |
| `tab` | a tab of the page | `project` on `/usage`, `model` on a Project page |
| `client` | the scope of the step 2 Spec | the step 2 rules |

- `<N>d` is the N days that end today. `<N>w` is the 7 × N days that end today. `<N>m` starts on the day after the same date N months before today and ends today. All dates are in the browser's time zone.
- With `from` and `to`, the page ignores `range`. A range that needs more than 3,700 buckets for its grain uses the grain `month`, and the page says so.
- On load, the page replaces invalid values with their defaults in the URL, with no new history entry, and shows "The link has a value that is not valid. The page shows the defaults for it."
- Each change by the Operator adds one history entry, so the browser Back button undoes it.
- Every link inside the page keeps the `client` value, by the step 2 rules.
- `url-state` reads `location.search`, writes it with `history.pushState` for a change by the Operator and with `history.replaceState` for a fix on load, and reads it again on `popstate`. The pages use the routes of `apps/web/src/nav` (dash Spec); this Spec adds no router library.
- A range that needs more than 3,700 buckets for its grain shows "The range is too long for this grain. The page shows months."

### Layout

The layout follows the prototype tab "Usage", with the panels of the brief below it. At phone width, the tiles and panels stack, and wide tables scroll inside their own box.

1. **Filter bar** (sticky): the range (relative or two dates), the grain, the metric, and "Usage data as of <time>" from `/api/usage/status`.
2. **Tiles**: the tokens tile, and in the scope "All" the 5-hour tile and the 7-day tile.
3. **Usage over time**: a bar chart of the active metric for each bucket. The title names the metric and the grain, for example "Tokens by day".
4. **Usage by dimension**: the tabs and the table.
5. **Limit history**: one chart for each **Limit window**, only in the scope "All".
6. **Activity calendar**.
7. **Cache efficiency**.
8. **Month outlook**.

Each panel has one short sentence that says what it shows. The prototype's "source" lines become these sentences, for example "From the Usage index. Limit windows are plan-wide."

### Tiles

- **Tokens.** The label is "Tokens, last 14 days" for `range=14d`, and names the range in the same way for every other range. The value is the total tokens of the range in scope: input, output, cache write and cache read tokens together, as the Usage ingest Spec sorts them. Under it: the **List-price estimate** of the range, the estimate note, and the unpriced turns of each model.
- **5-hour window** and **7-day window.** Only in the scope "All". The used percentage of the latest reading, its reset time, and the reading time with its age. When the reset time of the latest reading is in the past, the tile shows "The window reset at <time>. No reading since." and no percentage. With no reading: "No reading". Each tile has the note "Plan-wide: all clients and Projects".
- In a client scope, the tiles row has the tokens tile and the note "Limit windows are plan-wide. They show only in the scope All." The page sends no request to `/limits`, so the load of other clients does not show.
- A reset time on today shows as the time, for example "resets 13:00". A reset time on another day shows the weekday, the date and the time, for example "resets Thu 19 Nov, 09:00".
- The limit tiles show text only, with no meter bar. The brief asks for no live meter, and a bar of an old reading looks like one.

### Usage by dimension

- The web app asks `/breakdown` with `limit=500` for each tab, and with `limit=25` for the tab Session.
- Columns: the dimension label, the share, the input, output, cache write and cache read tokens, the turns and the **List-price estimate**. The tab Project adds the client after the label. The tab Skill adds the calls, the exact turns and the estimated turns, and the estimate note of the brief. The tab Session adds the first and the last turn time.
- The share is the row's value of the active metric divided by the totals row's value, as a whole percent. With the metric "List-price estimate" and an unpriced row, the share is "—".
- The headers sort the rows that the API returned, in the browser. The first sort of a column is from high to low. The totals row is the API's totals row and stays last.
- When `rowCount` is more than the rows returned, the tab shows "Top N of M. The totals include all M." for the tab Session, and "Top 500 of M by tokens" for the other tabs.
- Only a row of the tab Project is a link, to its Project page. No other row and no chart bar reacts to a click.
- The tables have a caption and header cells with `scope`.

### Limit history

- One bar chart for each **Limit window**: one bar for each past window in the range, at its reset time, with the height of its peak used percentage. Lines at 70% and 90%.
- A window whose reset time is after now has the label "in progress" and shows its peak so far.
- The summary: "N of the last M 5-hour windows reached 90% or more", and the same for the 7-day windows. M is the count of windows in the range, the window in progress included.
- With no reading in the range: "No reading in this range".
- The panel has the plan-wide note of the tiles. In a client scope, the page has no Limit history panel.

### Thresholds

One module holds the cut-offs and the state words, for the tiles and the charts:

| Used percentage | State word |
|---|---|
| below 70 | under 70% |
| 70 to below 90 | 70% or more |
| 90 or more | 90% or more |

A state always shows its word as well as its colour.

### Activity calendar

- A grid of the days of the last 26 weeks, one column for each week from Monday to Sunday, up to today. It ignores the date range and says so.
- A day with no usage has level 0. Another day has level 1 to 4 by its share of the largest day in the grid: up to 25%, up to 50%, up to 75%, or more. The active metric sets the values.
- Each cell has an accessible name with the date and the value. The grid has a legend with the levels.

### Cache efficiency

- Over the range in scope, from the totals row of `/breakdown`.
- **Cache hit ratio**: cache read tokens divided by the sum of input, cache write and cache read tokens, as a whole percent.
- **Tokens from the cache**: the cache read tokens, as "<N> input tokens came from the cache".
- With no input of any kind: "No input tokens in this range."

### Month outlook

- The **List-price estimate** so far this month: the sum of the `/series` buckets from the first day of the month to today, in the browser's time zone.
- The projection: the amount so far, divided by the count of days so far with today included, times the days of the month. The panel says this in one sentence.
- It ignores the date range and says so. With unpriced turns, it shows the unpriced note. With no estimate: "—".

### Refresh and live status

These rules belong to `apps/web/src/usage-status`, which the Sessions view and the Engagement ledger use as they are.

- The header Refresh button of the step 2 Spec starts the usage refresh. The Usage view adds no second button.
- The page asks `/api/usage/status` on load and each 60 seconds while `document.visibilityState` is `visible`. When the "data as of" time changed, it loads the panels again.
- While the state is "running", the page asks each 2 seconds and shows "Reading the history: <read> of <total> files". When the state becomes "idle", it loads the panels again.
- In the state "failed", the page shows "The last usage refresh failed. <reason> The page shows the data as of <date and time>." The reason is the short reason of `/status`, as the API writes it.
- With no "data as of" time, the page shows "No usage data yet".

### States

- **Loading**: a skeleton in the shape of each panel, with the final size, so the page does not move.
- **Empty**: one sentence for each panel.
- **Error**: one status line for each panel, with `role="status"`. The other panels still show.

### Formats

- Locale `en-GB`. Dates look like "13 Nov 2026". Times use the 24-hour clock.
- Tokens are compact. Below 1,000: the whole number. Else the value in thousands (`K`) or, from 999,950 on, in millions (`M`), rounded to one decimal, with no trailing `.0`: "5.3K", "850K", "1M", "1.2M", "12.4M". The format module writes `K` and `M` itself, because the `en-GB` compact notation of the browser writes `k` and `m`.
- Full numbers have thousands separators: "1,940,000".
- Durations: "<H> h <M> min" in whole minutes, for example "2 h 40 min" and "0 h 0 min". The Engagement ledger and the Reviews view use this format.
- Relative times: "just now" below 1 minute, "N minutes ago" below 1 hour, "N hours ago" below 1 day, else "N days ago", with "1 minute", "1 hour" and "1 day" in the singular. N is rounded down.
- Estimates look like "$1.23", or "<$0.01" for an amount above 0 and below one cent.
- A missing value is "—".
- All grouping by day, week or month uses the browser's time zone, sent as `tz`. Weeks start on Monday. The footer shows "Times in <time zone>".

### Charts

- One chart library for all of Foreman, bundled in the build: Recharts, pinned to an exact version that is at least 7 days old. It loads no script, font or style from another host, and it works under the content security policy of the step 2 Spec.
- The charts use the colour tokens of the theme, so they change with the theme.
- Each chart has a text equivalent: a table with the same values, available to a screen reader.

### Theme

- The header has a theme button that cycles "auto", "light" and "dark". "auto" follows `prefers-color-scheme`.
- The web app stores the choice in browser storage. Each read and write is in a `try`/`catch`; a failure means "auto".
- Foreman has its own colour tokens, with light and dark values. Text and state colours pass 4.5:1 contrast in both themes. Foreman uses system fonts only.
- The theme applies to every view.

### Look

- The layout is dense, and the tables have ruled rows.
- Titles, labels, branch names and skill names are React text nodes, by the step 2 rules.

## Gating and rollout

- **Gating:** not required. The view adds two pages and one field to two existing responses. A client that ignores the field gets the same result as before.
- **Rollout:** the issues merge into the Integration branch `feature/foreman-v1` (Integrated), in the order of the section "Build order". The shared web modules merge first, because the other views use them. The final pull request into the main branch waits until Foreman shows real data, as the brief says. The worktree path rule of the Sessions view Spec (slice 68-1) maps the factory's sibling worktrees to their repo's Project, so the By Project table shows real data correctly only after it.
- **Undo:** revert the change. The view stores nothing other than the theme choice in browser storage.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The view shows Project labels, branch names, skill names, session times and token counts from the **Usage index**. It adds no stored data.
- In a client scope, the view hides the usage of other clients, and it hides the limit panels, because their plan-wide percentage includes the use of all clients.

## Out of scope

- The exclusions of every Foreman v1 view: "Review scope of recent reviews" (it needs the `review-scope` Control event of factory Spec #85, which no code writes yet), overdue findings, the deferred finding events of factory ADR 0018, any action or write other than the refresh request, and cloud and CI sessions.
- The 5-hour block grain, a drill into single turns, a transcript viewer, and CSV or JSON export (left out of v1 by the brief).
- Filter chips and multi-value filters (the brief).
- A live limit meter. The view shows the latest reading with its age.
- The prototype's `owner/name` labels in the By Project table. The table shows the Project label of the Usage ingest Spec, because the glossary names a **Project** by its main checkout folder.
- Usage and limit numbers on the **Foreman dash** (the dash Spec).

## Risks

- **Recharts and the content security policy.** A chart library that adds a `style` element would break under the policy of the step 2 Spec. The chart slice checks the built page under the `Caddyfile` policy, with no policy error in the browser console.
- **The skill attribution of the main conversation is an estimate.** The tab Skill shows the exact turns and the estimated turns apart, and labels the estimate.
- **The month projection is rough** early in a month, because it uses few days. The panel says how it calculates.
- **A Project whose key differs from its repo list `path`** shows as "Unassigned" and only in "All" (the step 2 risk).

## Build order

Each slice is one PR-sized issue. A slice of another Spec that it needs is named with its Spec number or issue.

1. **69-1 Theme and format modules.** `apps/web/src/theme` (tokens, the theme button in the header), `apps/web/src/format`, with their tests. The scenarios "Theme", "Formats" (without the footer) and "Compact token numbers". Needs: Spec 23 issue #36 (the header).
2. **69-2 Usage status module.** `apps/web/src/usage-status`, with its tests. The scenarios "Refresh progress", "A failed refresh", "No usage data yet" and "Live status" at the component layer. Needs: 69-1.
3. **69-3 Charts module.** `apps/web/src/charts` (the bar chart with its table), `apps/web/package.json` (`recharts`). Needs: 69-1.
4. **69-4 The client of a Project in the API.** `apps/api/src/routes/usage.ts`, `packages/shared`, `apps/api/test/`. The scenario "The client of a Project in the API". Needs: Spec 23 issue #35.
5. **69-5 Usage page, filter bar, tokens tile and Usage over time.** `apps/web/src/usage`, `apps/web/src/usage/url-state`, `apps/web/src/nav`. The scenarios of the defaults, the summary tiles, unpriced turns, the metric switch, Browser Back, the URL values, Usage over time, the states and the client scope. Needs: 69-2, 69-3, 69-4; Spec 24 issue #40 (the nav).
6. **69-6 Usage by dimension and the Project page.** `apps/web/src/usage`. The tab, sort, Skill, Session, By Project and Project page scenarios. Needs: 69-5.
7. **69-7 Limit tiles and Limit history.** `apps/web/src/usage`, `apps/web/src/thresholds`, `apps/web/src/charts` (the limit chart). The limit scenarios. Needs: 69-5; issue #18 (`/api/usage/limits`).
8. **69-8 Activity calendar, Cache efficiency and Month outlook.** `apps/web/src/usage`, `apps/web/src/charts` (the calendar). Needs: 69-5.
9. **69-9 Usage end-to-end tests.** `e2e/usage.spec.ts` with the axe scan in both themes and the 375-pixel check. Needs: 69-6, 69-7, 69-8.

## Open questions

- None. The limit panels show only in the scope "All", as the step 2 Spec rules.
