# Dash List panel

**Status:** Approved
**Work items:** #193

Source: the approved Specs [`24-foreman-dash.md`](24-foreman-dash.md) and [`65-work-view.md`](65-work-view.md). This Spec adds the **List panel** to the **Foreman dash**, and a dash list filter to the Work view API. Where this Spec and those Specs differ, this Spec is the master copy for the List panel, the `set` filter and the Gantt bars.

## Problem

The **Foreman dash** shows numbers: the tiles, the eight stages of the pipeline strip and the rows of Review health. To see the items behind a number, the Operator opens the **Work view** and sets filters. Most numbers have no Work view filter: G1, G2, G3, the builds of the last run, the merged builds, the first-round pass of a Risk tier, the review rounds, the Escalations and the Waivers in use. Waits for you shows only the first 20 items. The Gantt bars of Last run show the repo, the issue number and the result, with no title and no link.

In a screen share, the Operator must answer "which ones?" for each number. Today the Operator leaves the dash, and the stakeholders lose the context.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator clicks a number on the dash to see its items next to the dash, and follows a link to the tracker or the forge.
- **Stakeholders of one client**: they see the List panel only in a screen share by the Operator, in that client's **Client scope**.

Foreman targets desktop and laptop screens. It does not target phones.

## Acceptance criteria

Fixtures are synthetic: a synthetic repo list, night log, run lock, Control events, a seeded **Work cache** and the synthetic adapter of the step 2 Spec. No real issue, repo, login or run goes into the repo.

### A tile opens the List panel

- **Given** a last run with 6 builds
- **When** the Operator clicks the tile "Builds in the last run"
- **Then** the List panel shows in a right-hand column with the heading "Builds in the last run" and "6 items"
- **And** the dash reflows in the left column
- **And** the URL has `panel=builds` next to `client`
- **And** the tile has `aria-expanded="true"`, and the focus moves to the panel heading.

### The rows of the Builds panel

- **Given** the builds of the Spec 24 scenario "The slot timeline": A (01:00 to 03:00, merged), B (01:10 to 04:00, `merge-ready`), C (03:30 to 05:00, BLOCKED) and D (01:20 to the last line of the run), each with a cached issue
- **When** the Operator opens the Builds panel
- **Then** the rows come in the order A, B, D, C
- **And** each row shows on its first line the repo, the issue number as a link to the tracker and the title
- **And** on its second line the result, the start, the end and the duration, for example "merged · 01:00 to 03:00 · 2 h 0 min".

### A build with no Work cache row

- **Given** the scope "All", and a build of issue 7 in the repo folder `/synthetic/scratch`, which is not in the repo list
- **When** the Operator opens the Builds panel
- **Then** the row shows "scratch #7" and "not in the Work cache", with no title and no link.

### The Merged panel

- **Given** the builds A, B, C and D above, and a build E (02:00 to 02:30, merged)
- **When** the Operator clicks the tile "Merged in the last run"
- **Then** the panel shows E, then A, by end time, earliest first
- **And** the URL has `panel=merged`.

### The panel stays on the run of the dash

- **Given** the dash shows the run `r1`, and a new run `r2` writes its first night log line
- **When** the Builds panel asks for its rows before the dash asks again
- **Then** it asks for `set=builds&run=r1`, and the API returns the builds of `r1`
- **And** after the dash response shows `r2`, the panel asks for `set=builds&run=r2`.

### A request that fails

- **Given** a panel is open, and the API is stopped
- **When** the panel asks for its rows
- **Then** the panel shows "The list cannot be read. The API may be stopped: start it with pnpm dev, then reload this page."
- **And** the dash keeps its own error text of Spec 24.

### The Builds panel before the dash data

- **Given** the link `/?panel=builds`
- **When** the page loads, and the dash data is not there yet
- **Then** the Builds panel shows "Reading the dash." and asks for no rows
- **And** when the dash request fails, the panel shows the text of "A request that fails".

### An unreadable factory folder

- **Given** a `controls/` folder that the API cannot read
- **When** the Operator opens a Review health panel by a link
- **Then** the response has `sources.controls` `unreadable`, and the panel shows "cannot read the factory folder"
- **And** an unreadable `runs/` folder has the same effect on the Builds, Merged and Waits for you panels.

### A run that is not in the window

- **Given** a request with `set=builds` and a run ID that has no night log line in the 30-day window of the scope
- **When** the API builds the rows
- **Then** the response has no rows, and the panel shows "No builds in this run."

### The Waits for you panel

- **Given** 30 items that wait for the Operator, of the kinds of the Spec 24 scenario "Waits for you"
- **When** the Operator clicks the tile "Waits for you"
- **Then** the panel shows the 30 items in the order of Spec 24, each with its reason and its source on the second line
- **And** the URL has `panel=waits`.

### "and N more" opens the Waits for you panel

- **Given** 30 items that wait for the Operator
- **When** the Operator chooses "and 10 more" in Waits for you
- **Then** the Waits for you panel opens, as from the tile.

### A pipeline stage

- **Given** the cached issues and the pull request of the Spec 24 scenario "The pipeline strip"
- **When** the Operator clicks each of the eight stages
- **Then** each panel shows as many rows as the count of its stage
- **And** G1 Spec shows its 2 issues by priority, then `owner/name`, then number from high to low
- **And** G3 shows the pull request into `production` first, then the `merge-ready` issue
- **And** DONE shows its 5 issues by `owner/name`, then number from high to low
- **And** the URL has `panel=stage_g1`, `panel=stage_g3` and `panel=stage_done`.

### A Risk tier row of Review health

- **Given** the Spec 24 scenario "First-round pass counts each pull request once", and 2 other pull requests with a first round-1 decision `pass` in the tier `general`
- **When** the Operator clicks the row `general` of the first-round pass rates
- **Then** the panel shows the 3 pull requests, with "fail" for the first one and "pass" for the others
- **And** the URL has `panel=tier_general`.

### A round row of Review health

- **Given** pull requests with the highest rounds 1, 1, 2 and 3
- **When** the Operator clicks the row "Round 2"
- **Then** the panel shows the one pull request with the highest round 2.

### Escalations

- **Given** 3 `escalated` events: 2 for pull request 40 of `acme/app` (`general` to `sensitive`, then `sensitive` to `authority`), and 1 for pull request 41
- **When** the Operator clicks "Escalations: 3"
- **Then** the panel heading shows "3 Escalations on 2 pull requests"
- **And** the panel shows the 2 pull requests, and the row of pull request 40 shows "general → sensitive, sensitive → authority", oldest first.

### Waivers in use

- **Given** the Spec 24 scenario "Review health": 2 `waiver_used` events for the Waiver `W-1` of one repo, on pull requests 4 and 5, and 1 for `W-1` of the other repo, on pull request 9
- **When** the Operator clicks "Waivers in use: 2"
- **Then** the panel heading shows "2 Waivers on 3 pull requests"
- **And** the panel shows the 3 pull requests, each with the IDs of its Waivers.

### A counted pull request with no Work cache row

- **Given** a `gate` event for pull request 12 of `acme/app`, and no cached pull request 12
- **When** the Operator opens a Review health panel that counts it
- **Then** the panel has a row "acme/app PR #12" with "not in the Work cache", no title and no link
- **And** the panel shows as many rows as the dash number.

### A pull request that is not the Linked pull request

- **Given** issue 12 with a closed pull request 40 and an open pull request 44, and a `gate` event for pull request 40 only
- **When** the Operator opens the round panel that counts pull request 40
- **Then** the row shows issue 12 with pull request 40, not 44.

### A second stat replaces the panel

- **Given** the Builds panel is open
- **When** the Operator clicks the stage BLOCKED
- **Then** the BLOCKED panel replaces the Builds panel, and the URL has `panel=stage_blocked`
- **And** when the Operator clicks the stage BLOCKED again, the panel closes.

### Close the panel

- **Given** a panel is open, from the tile "Waits for you"
- **When** the Operator chooses the X button, or presses Escape with the focus in the panel
- **Then** the panel closes, the URL has no `panel` value, and the focus moves to the tile "Waits for you".

### A link opens the panel

- **Given** the link `/?client=acme&panel=stage_blocked`
- **When** the Operator opens it, or reloads the page
- **Then** the dash shows in the scope `acme` with the BLOCKED panel open
- **And** the browser Back button goes to the URL before, with no panel.

### A panel value that is not valid

- **Given** the link `/?panel=stage_doing`
- **When** the Operator opens it
- **Then** the dash shows with no panel, and the note "This link has a panel value that is not valid." with a link to `/` in the same scope.

### A run ID that is too long

- **Given** a last run whose run ID has 201 characters
- **When** the dash loads
- **Then** the tiles "Builds in the last run" and "Merged in the last run" are not buttons.

### A stat with no items

- **Given** a tile, a stage or a Review health row with the value 0 or "–"
- **When** the dash loads
- **Then** that value is not a button
- **And** a link with the `panel` value of that stat opens the panel with the text "No items in this scope."

### The panel in a client scope

- **Given** 2 BLOCKED issues of `acme` and 1 of `globex`
- **When** the Operator opens the BLOCKED panel in the scope `acme`
- **Then** the panel shows the 2 issues of `acme` only
- **And** a change of the scope keeps the `panel` value and shows the panel in the new scope.

### Paging in the panel

- **Given** 230 DONE issues in scope
- **When** the Operator opens the DONE panel and chooses "Show more" two times
- **Then** the panel shows 100, then 200, then 230 rows, by the list conventions of Spec 65.

### Live update

- **Given** a panel is open in a visible tab
- **When** 60 seconds pass
- **Then** the web app asks again for the dash and for the loaded pages of the panel
- **And** while the tab is hidden, it does not ask.

### Open in the Work view

- **Given** the Builds panel of the run `r1` is open in the scope `acme`
- **When** the Operator chooses "Open in the Work view"
- **Then** the Work view opens at `/work?client=acme&set=builds&run=r1`, with the same rows in the same order and all 12 columns
- **And** the Work view shows "Dash list: Builds in the last run" with a link "Show all work" to `/work` in the same scope
- **And** the filters and the sort are disabled while the `set` value is in the URL.

### Gantt bars are links with a tooltip

- **Given** a build of issue 12 of `acme/app`, "Add the export", from 01:00 to 03:00, merged, in slot 1, with a cached link
- **When** the mouse is on its bar, or the keyboard focus is on its bar
- **Then** a tooltip shows `acme/app`, `#12`, "Add the export", 01:00, 03:00, "2 h 0 min", "merged" and "slot 1"
- **And** the bar is a link to the tracker issue, which opens in a new tab, with the accessible name "Issue 12 of acme/app: merged, 01:00 to 03:00"
- **And** Escape hides the tooltip, and the tooltip stays while the mouse is on it.

### A Gantt bar with no link

- **Given** a build in a repo folder that is not in the repo list
- **When** the keyboard focus is on its bar
- **Then** the tooltip shows, with "not in the Work cache" in place of the title
- **And** the bar is not a link.

### Not connected

- **Given** no repo in scope with Work cache rows, and a last run with 3 builds
- **When** the Operator opens the Builds panel
- **Then** the panel shows the 3 builds from the night log, with no title and no link, and the step 2 "not connected" text above the rows
- **And** the tile "Waits for you" and the stages are not buttons, because the dash shows "Not connected" for them
- **And** a link with `panel=waits` or a stage value shows the panel with the step 2 "not connected" text and no rows.

### Query values that are not valid

- **Given** a running API
- **When** a request to `/api/work/items` has `set=builds` with no `run`, `run` with no `set`, `run` with `set=waits`, `set` with `issue_state`, `type`, `priority`, `repo` or `sort`, `set=stage_doing`, or a `run` of more than 200 characters
- **Then** the API rejects it with status 400.

### Titles stay plain text

- **Given** an issue title that holds HTML and Markdown
- **When** the List panel and the Gantt tooltip show it
- **Then** the page shows the text as it is, with no markup and no request to another host.

### Layout

- **Given** a window 1280 px wide
- **When** a panel is open
- **Then** the panel is 40% of the width and never below 360 px, and the page does not scroll sideways
- **And** at a narrower window, the left column uses the stacking rules of Spec 24.

### Accessibility

- **Given** each kind of panel open: Builds, Merged, Waits for you, a stage, a Risk tier, a round, Escalations and Waivers in use, with a seeded Work cache
- **When** the end-to-end test opens the dash with each panel, and with a Gantt tooltip shown
- **Then** the axe scan finds no WCAG 2.2 AA violation.

## Design

### Components

| Module | Does |
|---|---|
| `apps/api/src/work/sets` | The rows, the context and the order of each `set` value. It uses `dash/pipeline` for the stages, `dash/waits` for Waits for you, `dash/runs` for the builds, and the reduction of `dash/review-health` for the Review health sets. |
| `apps/api/src/work/items` | Takes the rows of a set in place of the filters, and pages them by the list conventions |
| `apps/api/src/routes/work.ts` | The `set` and `run` values of `GET /api/work/items` |
| `apps/api/src/dash/review-health` | Its reduction of the `gate`, `escalated` and `waiver_used` events to one record for each pull request becomes a function of its own, which the dash numbers and the review sets both use |
| `apps/api/src/dash/dash` | Adds the title and the link of each build of the last run from the Work cache |
| `packages/shared` | The `set` and `run` query values, the `context` of a row, the nullable `repoId`, and the `title` and `link` of a build |
| `apps/web/src/dash/ListPanel` | The List panel: heading, count, X button, rows, "Show more", "Open in the Work view" |
| `apps/web/src/dash/panel-url` | The `panel` URL value, validated with the shared schema |
| `apps/web/src/dash/DashPage` | The two-column layout, and the stats as buttons |
| `apps/web/src/dash/LastRun` | The bars as links, with the tooltip |
| `apps/web/src/work` | The `set` and `run` URL values, the "Dash list" note and the disabled filters |

### Sets

One `set` value names the items behind one number of the dash. The URL `panel` value of the dash and the `set` value of the API are the same word.

| `set` | Rows | Order | Second line |
|---|---|---|---|
| `builds` | The builds of the run `run` in scope, by the Spec 24 rules | Start, then `owner/name` or folder label, then number | Result, start, end, duration |
| `merged` | The builds of `builds` with the result "merged" | End, then `owner/name`, then number | As `builds` |
| `waits` | All the items of Waits for you, by the Spec 24 rules | The Spec 24 order | Reason and source |
| `stage_g1`, `stage_g2`, `stage_ready`, `stage_in_progress`, `stage_in_review`, `stage_blocked` | The issues of the stage, by the Spec 24 pipeline rules | Priority, then `owner/name`, then number from high to low | Issue state, priority, PR number with its CI result and its Machine gate |
| `stage_done` | The issues of DONE | `owner/name`, then number from high to low | As the stages above |
| `stage_g3` | The open pull requests into `production`, then the open `merge-ready` IN REVIEW issues | Pull requests by number from high to low, then issues by priority, then `owner/name`, then number | As the stages above |
| `tier_authority`, `tier_sensitive`, `tier_general`, `tier_inert`, `tier_none` | The pull requests whose first round-1 `gate` decision `pass` or `fail` has that tier | `owner/name`, then PR number from high to low | PR number as a link, "pass" or "fail" |
| `round_1`, `round_2`, `round_3` | The pull requests whose highest `gate` round is that round | As the tier sets | PR number as a link, the round |
| `escalated` | The pull requests with one or more `escalated` events | As the tier sets | PR number as a link, the **Path tier** and the **Final tier** of each event, oldest first |
| `waivers` | The pull requests with one or more `waiver_used` events | As the tier sets | PR number as a link, the Waiver IDs |

- A set uses the same module and rules as the dash number that it lists. Thus the row count of a set equals that number in the same scope and at the same time. The two exceptions are `escalated` and `waivers`: the dash counts events and distinct Waivers, and these sets list the pull requests. Their responses have `events`, and the panel heading shows "N Escalations on M pull requests" or "N Waivers on M pull requests".
- The total order of each set ends with the repo ID or the folder label, then the row kind, then the number.

### Rows of a set

- **An issue in the Work cache.** The Work view row of that issue. For the review sets, the row shows the pull request of the event, not the **Linked pull request**.
- **A pull request in the Work cache with no cached issue.** The Work view row of that pull request.
- **A build or a pull request with no Work cache row.** A row with the repo or the folder label, the number, no issue, no pull request and the marker "not in the Work cache".

### Work API changes

`GET /api/work/items` gets two query values:

| Query value | Values |
|---|---|
| `set` | A value of the Sets table |
| `run` | A run ID: a string of 1 to 200 characters. Only with `set` `builds` or `merged`, and required with them. |

- With `set`, the request must not have `repo`, `issue_state`, `type`, `priority` or `sort`. The order is the order of the set. The query schema still uses `.strict()`.
- The cursor holds the `set` and `run` values, by the list conventions of Spec 65.
- Each row gets `context`, null with no `set`, or one of these:
  - `build`: the issue number, start, end and result;
  - `wait`: the kind, the reason and the source;
  - `review`: the pull request number and link, and one of the decision (`pass` or `fail`), the round, the Path tier and the Final tier, or the Waiver IDs.
- `repoId` is null for a build of a repo folder that is not in the repo list, and for a Control event of a repo that is not in the list. Such a row shows only in the scope "All", with the folder label or the `owner/name` of the event.
- With `set`, a row can carry the Control event keys of its `context`: `tier`, `path_tier` and `waiver`, as well as `round` and `decision`. The data rule of Spec 65 holds for every response with no `set`.
- `counts` counts the rows of the set by Issue state.
- With `set`, the response has `sources`: the state of the `runs/` and the `controls/` folders, each `ok`, `missing` or `unreadable`, by the Spec 24 rules. With no `set`, `sources` is null.
- With `set=escalated`, the response also has `events`: the count of `escalated` events of the rows. With `set=waivers`, `events` is the count of distinct Waivers of the rows. With any other value, `events` is null.
- With `state` `not_connected`, the sets `builds`, `merged` and the review sets still return their rows from the local files, with no issue and no pull request. The other sets return no rows, and the panel shows the step 2 "not connected" text.

### Dash response changes

Each build of `lastRun.builds` gets `title` (a string, or null with no cached issue) and `link` (the tracker link of the cache, or null). The API reads them in one query for all the builds.

### Web app

- **Layout.** With a panel open, the dash page has two columns. The right column is the List panel, 40% of the width and never below 360 px. The left column holds the dash and uses the stacking rules of Spec 24. The page does not scroll sideways.
- **Stats.** Each stat with a value of 1 or more is a `<button>`, except the Builds and Merged tiles of a run ID with more than 200 characters, with `aria-expanded` and `aria-controls`: the tiles "Builds in the last run", "Merged in the last run" and "Waits for you"; the eight stages; the Risk tier rows, the round rows, "Escalations" and "Waivers in use"; and "and N more". The stat of the open panel shows a pressed state.
- **Panel.** An `<aside>` with the heading of its stat, the count from `counts.all`, the X button with the accessible name "Close the list", the rows, "Show more" and the link "Open in the Work view". When it opens, the focus moves to its heading. The X button, and Escape with the focus in the panel, close it and move the focus to the stat that opened it.
- **One panel.** A click on another stat replaces the panel. A click on the stat of the open panel closes it.
- **URL.** The `panel` value is next to `client`. Each open and close writes a new history entry, so Back closes or changes the panel. A reload keeps the panel. A change of the scope keeps the `panel` value. The web app validates the value with the shared schema. A value that is not valid shows "This link has a panel value that is not valid." with a link to `/` in the same scope, and no panel.
- **Errors.** A failed panel request shows "The list cannot be read. The API may be stopped: start it with pnpm dev, then reload this page." A panel whose set reads an unreadable folder shows "cannot read the factory folder".
- **Run.** The `builds` and `merged` panels show "Reading the dash." until the dash data is there. They wait for the dash data, and ask with the run ID of `lastRun`. They ask again when that run ID changes. The URL holds no run ID.
- **Rows.** Each row has two lines. The first line has the repo, the issue number as a link to the tracker and the title. The second line has the facts of the set, by the Sets table. Links use only the `link` fields, by the step 2 rules.
- **Live update.** The panel updates its loaded pages with the dash, each 60 seconds while the tab is visible and after a Refresh, by the list conventions.
- **Gantt bars.** The timeline leaves the `aria-hidden` area. Each bar with a link is an `<a>` to the tracker issue, which opens in a new tab with `rel="noopener noreferrer"`. A bar with no link has `role="img"` and `tabindex="0"`. Each bar has an accessible name, for example "Issue 12 of acme/app: merged, 01:00 to 03:00". On mouse hover and on keyboard focus, a tooltip shows the repo, the issue number, the title, the start, the end, the duration, the result and the slot. The tooltip stays while the mouse is on it, and Escape hides it. The screen reader table of Spec 24 stays.
- **Work view.** `/work` accepts the `set` and `run` URL values. With a `set`, it shows "Dash list: <name of the stat>" and a link "Show all work" to `/work` in the same scope, and it disables the filters and the sort.
- Titles, reasons, labels and Waiver IDs are React text nodes, by the step 2 rules.

## Gating and rollout

- **Gating:** not required. Foreman is one local app, and the web app and the API ship together. The change adds buttons, a panel and query values. The only change to an existing contract is the nullable `repoId` of a Work view row, which the Work view of the same release reads.
- **Rollout:** the issues merge into the main branch one by one (Incremental). The API sets come first, then the panel, then the Gantt bars and the Work view link. To undo, revert the change. The List panel stores nothing.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The panel shows the issue titles, repo names, folder labels and Waiver IDs that the dash and the Work view show today. It adds no stored data.
- The URL holds a `set` word and a run ID. Neither is personal data.
- In a client scope, the panel shows no data of other clients.

## Out of scope

- A panel for the tile "First-round pass", for the Now section and for the Repos section.
- A sort control or a filter in the panel. The Work view has them.
- A panel for a repo with no Control events.
- Any action from the panel. The Operator acts with `factory-next`.
- Phone widths.
- A tooltip on a touch screen. A tap follows the link.

## Risks

- **More reads of the factory folders.** A `builds`, `merged` or `waits` set reads the night log of 30 days on each request, and a review set reads the Control events of 30 days, as the dash does. The `waits` set reads the night log for the BLOCKED reasons. An open panel doubles these reads each 60 seconds.
- **The Work cache keeps few closed items.** Builds and review rows of older closed items show "not in the Work cache", with no title and no link.

## Open questions

- None.
