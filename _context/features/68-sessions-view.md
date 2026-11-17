# Sessions view

**Status:** Approved
**Work items:** #68

Source: foreman ADR 0003 ("Session history"), factory ADR 0007 (amended 2026-11-14), step 5 of the build order: the session timeline. It builds on the approved Specs [`5-usage-ingest.md`](5-usage-ingest.md), [`23-forge-and-tracker-connection.md`](23-forge-and-tracker-connection.md) and [`24-foreman-dash.md`](24-foreman-dash.md). It needs the **Skill attribution** of issue #16 and the user message times of issue #15. Layout reference: the Claude artifact "Foreman dash prototype", tab "Sessions". Where the prototype and this Spec differ, this Spec is the master copy.

This Spec changes two rules of the approved Usage ingest Spec, and names each sentence that it replaces: the refresh schedule (section "Refresh schedule") and the path rules of a Project (section "Usage index changes"). It also owns the definition of an **Agent span**, which the Reviews view Spec uses.

## Problem

The Operator runs Attended sessions by day and the Unattended loop by night. One night run starts tens of sub-agents in several repos. The Usage view shows the totals by **Project**, model, **Agent type** and skill, but it does not show the order of the work in one session. The Operator cannot see which agent worked on which work item at what time, how long a review round took, or where the tokens of one session went.

The Operator also shows the factory to stakeholders of one client. A demo needs a view of one night run that shows only the agents that worked on that client's repos.

Foreman needs a **Session timeline**: for one day, the list of sessions, and for one session its **Agent spans** on a time axis. It uses metadata from the **Usage index** only, and never shows a prompt, a reply, a tool input or a tool output.

## Users

- **The Operator**: the one person who runs the factory and Foreman on this Mac. The Operator opens the Sessions view to check a night run or an Attended session.
- **Stakeholders of one client**: they see the view only in a screen share by the Operator, in that client's **Client scope**.

## Acceptance criteria

Fixtures are synthetic: synthetic transcripts in the public transcript format, a synthetic repo list and a seeded **Work cache**. No real transcript, repo or issue goes into the repo. Unless a scenario says otherwise, the time zone is `UTC`, the day is 2026-11-14, and the repo list has `/synthetic/acme/app` as `acme/app` of the client `acme`.

### Sessions of one day

- **Given** 3 sessions with **Turns** on 2026-11-14, and 1 session with Turns only on 2026-11-13
- **When** the web app asks for `/api/sessions?day=2026-11-14&tz=UTC`
- **Then** the response has the 3 sessions, newest start first, and `total` 3
- **And** each session has its ID, name, kind, start and end, Projects, tokens, turns and the count of messages from the Operator.

### Today by default

- **Given** the browser time zone `Europe/London` and the browser date 2026-11-15
- **When** the Operator opens `/sessions` with no `day` value
- **Then** the page asks for the day 2026-11-15 in `Europe/London`, and the heading is "Sessions today"
- **And** with `day=2026-11-13`, the heading is "Sessions on 13 Nov 2026"
- **And** the "Next day" button is disabled on today, and the date field does not offer a later day.

### A day in the time zone of the browser

- **Given** a session with Turns from 2026-11-14 23:30 UTC to 2026-11-14 23:50 UTC
- **When** the web app asks for `day=2026-11-15&tz=Europe/Berlin`
- **Then** the session is in the list, with the start 00:30 and the end 00:50 local time.

### A session across midnight

- **Given** a session with 4 Turns of 1,000 tokens each, at 23:30 and 23:50 on 2026-11-13 and at 00:10 and 00:40 on 2026-11-14
- **When** the web app asks for the day 2026-11-14
- **Then** the session shows the start 00:10, the end 00:40, 2,000 tokens and "continues from the day before"
- **And** for the day 2026-11-13, it shows 23:30 to 23:50, 2,000 tokens and "continues on the next day".

### Session name and kind

- **Given** session A, whose main conversation calls `factory-core:factory-run` and then `factory-core:to-code`; session B, whose first user message is the slash command `/factory-core:factory-next`; and session C with no skill call
- **When** the web app asks for the day
- **Then** A has the name `factory-core:factory-run` and the kind "Unattended loop"
- **And** B has the name `factory-core:factory-next` and the kind "Attended loop"
- **And** C has no name, the page shows "No skill", and the kind is "Session".

### Spans of the main conversation

- **Given** a session whose main conversation has 2 Turns with no skill at 09:00 and 09:05, a user message with the slash command `/review-spec` at 09:06, 4 Turns at 09:07 to 09:20, a real user message at 09:25, and 2 Turns with no skill at 09:26 and 09:30
- **When** the web app asks for that session
- **Then** the timeline has 3 spans: "main" from 09:00 to 09:05 with 2 turns, "main · review-spec (estimate)" from 09:07 to 09:20 with 4 turns, and "main" from 09:26 to 09:30 with 2 turns.

### Spans of sub-agents

- **Given** a session where the main conversation calls `to-code`, which starts a `software-developer` sub-agent with 10 Turns from 09:08 to 09:40, and 2 `review-finder` sub-agents with Turns from 09:41 to 09:50
- **When** the web app asks for that session
- **Then** the timeline has one span for each sub-agent, in order of start time
- **And** the `software-developer` span shows "software-developer · to-code", 10 turns, 09:08 to 09:40, its models and its tokens
- **And** each `review-finder` span is a row of its own.

### A sub-agent with no meta file

- **Given** a sub-agent with no meta file
- **When** the web app asks for its session
- **Then** its span shows the **Agent type** "sub-agent (unknown)".

### Models of a span

- **Given** a span with 6 Turns of `claude-sonnet-4-5`, 2 Turns of `claude-opus-4-1` and 1 fast-mode Turn of `claude-opus-4-1`
- **When** the web app asks for that session
- **Then** the span lists the models `claude-sonnet-4-5` (6), `claude-opus-4-1` (2) and `claude-opus-4-1 (fast)` (1), in that order.

### Ambiguous skill

- **Given** a main-conversation span whose Turns have the skill "(ambiguous)"
- **When** the web app asks for that session
- **Then** the span shows "main · (ambiguous) (estimate)".

### Work item from a worktree folder

- **Given** sub-agent Turns whose working folder is `/synthetic/acme/app.worktrees/212-add-refunds/src` and whose branch is `HEAD`, and a cached issue `acme/app` #212 with the title "Add refunds" and a link
- **When** the web app asks for that session
- **Then** the span shows the work item `acme/app #212` and "Add refunds" as plain text, with the link of the cached issue.

### Work item from a branch

- **Given** main-conversation Turns in `/synthetic/acme/app` with the branch `209-fix-totals`
- **When** the web app asks for that session
- **Then** the span shows the work item `acme/app #209`.

### No work item

- **Given** Turns with the branches `main`, `HEAD`, `feature/foreman-v1`, `release/0.1` and `0-draft`, and Turns in `/synthetic/acme/app/.claude/worktrees/brave-otter`
- **When** the web app asks for that session
- **Then** their spans have no work item.

### The worktree folder comes before the branch

- **Given** Turns in `/synthetic/acme/app.worktrees/212-add-refunds` with the branch `209-fix-totals`
- **When** the web app asks for that session
- **Then** the span shows the work item #212.

### A work item that is not in the Work cache

- **Given** a span with the work item #212 of `acme/app`, and no cached issue #212; and a span with the work item #7 in a Project that matches no repo list entry
- **When** the web app asks for that session
- **Then** the first span shows `acme/app #212` with no title and no link
- **And** the second span shows `#7` with no title and no link.

### A sub-agent with two work items

- **Given** a sub-agent with Turns in the worktrees `212-add-refunds` and `213-fix-rounding` of `acme/app`
- **When** the web app asks for that session
- **Then** its span shows "2 work items" with no link.

### A main span changes with the work item

- **Given** main-conversation Turns with the skill `to-code` in the worktree `212-add-refunds` at 09:00 and 09:05, then in the worktree `213-fix-rounding` at 09:10
- **When** the web app asks for that session
- **Then** the timeline has two main spans, one for #212 and one for #213.

### Messages from the Operator

- **Given** a session with 3 real user messages, 2 user messages with only tool results, and a sub-agent with a task prompt
- **When** the web app asks for that session
- **Then** the list shows "3 messages from you"
- **And** the timeline shows 3 marks on the "You" lane, at the times of the 3 messages.

### A session in a client scope

- **Given** a session whose main conversation is in a Project with no repo list entry, with 3 real user messages there, and whose 2 sub-agents have Turns of 1,000 tokens each in `/synthetic/acme/app.worktrees/212-add-refunds`
- **When** the web app asks for the day and for that session with `client=acme`
- **Then** the list shows the session with 2,000 tokens and "0 messages from you"
- **And** the timeline shows the 2 sub-agent spans and no main span
- **And** with `client=globex`, the list does not have the session, and the session route returns status 404.

### The kind in a client scope

- **Given** the session of the scenario before, whose main conversation calls `factory-core:factory-run` and then `factory-core:to-code`, and whose 2 sub-agents start in the span of `factory-core:to-code`
- **When** the web app asks for the day with `client=acme`
- **Then** the session has the kind "Unattended loop" and the name `factory-core:to-code`, the skill of its first Turn in scope.

### An unknown session

- **Given** no session `s9` with Turns on 2026-11-14
- **When** the Operator opens `/sessions?day=2026-11-14&session=s9`
- **Then** the session route returns status 404
- **And** the page shows "No session s9 on this day in this scope." and the list of the day.

### Paging of sessions

- **Given** 120 sessions on one day
- **When** the web app asks for the list with no `limit`, and then with each `nextCursor`
- **Then** the responses have 50, 50 and 20 sessions, and the last `nextCursor` is null
- **And** a request with `limit=201`, `limit=0` or a cursor that is not valid gets status 400.

### Paging of spans

- **Given** a session with 650 spans on one day
- **When** the web app asks for the session with no `limit`, and then with each `nextCursor`
- **Then** the responses have 200, 200, 200 and 50 spans, and `spanTotal` is 650
- **And** a request with `limit=501` gets status 400.

### An invalid query

- **Given** a running API
- **When** a request has the day `2026-02-30`, an unknown `tz`, an unknown `client`, an unknown query key, or a session ID of 65 characters
- **Then** the API rejects it with status 400.

### No session on the day

- **Given** no Turn on 2026-11-12
- **When** the Operator opens `/sessions?day=2026-11-12`
- **Then** the page shows "No sessions on this day in this scope."

### Data as of and refresh state

- **Given** a usage refresh that runs and has read 1,240 of 3,100 files, and a last good refresh at 2026-11-14 06:00
- **When** the page loads
- **Then** it shows "Usage data as of 06:00" and "Reading the history: 1,240 of 3,100 files", by the usage status module of the Usage view Spec
- **And** after a failed refresh with the reason "The database is not available.", it shows "The last usage refresh failed. The database is not available. The page shows the data as of 14 Nov 2026, 06:00."

### Usage refresh each 15 minutes

- **Given** a running API with no `FOREMAN_USAGE_REFRESH_MINUTES` value, and a last refresh that ended at 10:00
- **When** the clock reaches 10:15
- **Then** a usage refresh starts, and it reads only the new lines of each file
- **And** with `FOREMAN_USAGE_REFRESH_MINUTES=60`, the next refresh starts at 11:00
- **And** with the value `0`, `1441` or `ten`, the API stops at start-up with a message that names the variable.

### Some repos not connected

- **Given** spans with work items in `acme/app` and `acme/web`, of which `acme/web` has no cache rows because it has no token
- **When** the page loads with `client=acme`
- **Then** the `acme/web` work items show their numbers with no title and no link
- **And** the timeline shows "Data is not complete: 1 repo not connected. See Repos."

### Not connected

- **Given** no token for any repo in scope
- **When** the page loads
- **Then** the sessions and the spans still show, from the **Usage index**
- **And** the work items show their numbers only, and the timeline shows "Not connected. Add the Foreman token to FOREMAN_TOKENS_JSON in the .env file, then restart pnpm dev."

### Metadata only

- **Given** a synthetic transcript whose prompt, reply, thinking, tool input, tool output and sub-agent task description each hold the text `CANARY-7f3e`
- **When** a refresh runs and the web app asks for the list and the session
- **Then** no response and no page has `CANARY-7f3e`
- **And** no column of the **Usage index** holds it.

### Titles stay plain text

- **Given** a cached issue title `<img src="https://evil.example/t.png"> **Fix** [this](https://evil.example)` for a work item of a span
- **When** the page shows the span
- **Then** the page shows the title text as it is, with no image, no bold and no link
- **And** the browser makes no request to `evil.example`.

### Token format

- **Given** spans with 812, 5,340 and 1,940,000 tokens
- **When** the page shows them
- **Then** the page shows `812`, `5.3K` and `1.9M`, by the format module of the Usage view Spec
- **And** the table for screen readers shows `812`, `5,340` and `1,940,000`.

### Worktree path in the local runtime

- **Given** the Project key `/synthetic/acme/app` is known, and Turns whose working folder `/synthetic/acme/app.worktrees/212-add-refunds` does not exist
- **When** a refresh runs
- **Then** the Turns have the Project key `/synthetic/acme/app` and the worktree name `212-add-refunds`.

### Live update

- **Given** the view is open on today in a visible tab
- **When** 60 seconds pass
- **Then** the web app asks for the loaded pages of the list and of the selected session again
- **And** while the tab is hidden, or when the view shows an earlier day, it does not ask.

### The view link

- **When** the Operator opens any Foreman page
- **Then** the header nav has the link "Sessions" to `/sessions`, and the link keeps the `client` value.

### Accessibility

- **Given** each fixture set of the scenarios "Sessions of one day", "Spans of sub-agents", "A session in a client scope", "No session on the day", "Some repos not connected" and "Not connected"
- **When** the end-to-end test opens the view with each set, in the light theme and in the dark theme
- **Then** the axe scan finds no WCAG 2.2 AA violation
- **And** at a width of 375 pixels the page has no horizontal page scroll
- **And** each span has its **Agent type** as text as well as a colour
- **And** a table with the same spans, their times, models, work items, turns and tokens is available to a screen reader.

## Design

### Components

| Module | Does |
|---|---|
| `packages/db` schema and a new migration | Gains the column `worktree_name` on `turns` (below) |
| `apps/api/src/usage/projects` | Gains the path rule for a sibling worktree folder, and the worktree name of a working folder |
| `apps/api/src/usage/ingest` | Writes the worktree name of each Turn |
| `apps/api/src/usage/refresh` and `apps/api/src/config.ts` | The refresh interval from `FOREMAN_USAGE_REFRESH_MINUTES` (below) |
| `apps/api/src/sessions/work-items` | The issue number of a Turn, and the work item of a span from the **Work cache** |
| `apps/api/src/sessions/spans` | The **Agent spans** of one session on one day. It also exports `subAgentSpansInWindow`: the whole sub-agent spans of a time window, which the Reviews view uses |
| `apps/api/src/sessions/sessions` | The sessions of one day: name, kind, times, Projects, counts |
| `apps/api/src/routes/sessions.ts` | The sessions API |
| `packages/shared` | The Zod schemas of the sessions API |
| `apps/web/src/sessions` | The Sessions page: the day choice, the session list, the timeline and its table |
| `apps/web/src/theme` (Usage view Spec) | Gains the colour tokens of five Agent types (below) |
| `apps/web/src/nav` | Gains the link "Sessions" |
| `e2e/sessions.spec.ts` | The end-to-end tests with the axe scan |

The page uses the `format`, `theme` and `usage-status` modules of the Usage view Spec, and the list conventions of the Work view Spec (`limit`, `cursor`, `nextCursor` and "Show more"). It does not define them again.

### Configuration

| Variable | Default | Use |
|---|---|---|
| `FOREMAN_USAGE_REFRESH_MINUTES` | `15` | The time between two usage refreshes while the API runs. An integer from 1 to 1,440. The API stops at start-up on another value. |

The other variables of the Usage ingest Spec and of the step 2 Spec do not change.

### Data sources

All data comes from the **Usage index** of the Usage ingest Spec, with the additions of issue #15, issue #16 and this Spec, and from the **Work cache** of the step 2 Spec. The view reads no transcript file at request time.

| Value | Source |
|---|---|
| Session, its day and its times | `turns`: session ID and time |
| Tokens and turns | `turns`: the four token counts, counted once for each Turn |
| Model | `turns`: model and speed flag, shown as in the model rows of the breakdown, for example `claude-opus-4-1 (fast)` |
| **Project** | `turns`: Project key, labelled by the Project rules |
| **Agent type** and agent | `turns`: Agent type and agent ID; `agents` for the sub-agents |
| Skill | `turns`: skill name and skill basis (issue #16); `skill_calls` of the main conversation for the kind |
| Messages from the Operator | `user_messages`: session ID, time and Project key (issue #15) |
| Work item | `turns`: worktree name (this Spec) and branch; `work_issues` and `work_repos` of the Work cache for the repo, the title and the link |
| Data as of | `GET /api/usage/status` of the Usage ingest Spec |

### Usage index changes

- `turns` gains the column `worktree_name` (text, or none). The ingest takes it from the raw working folder of the record, before the Project rules map the folder to a Project key. It is the folder name directly below a part `<folder>.worktrees/`, `.worktrees/` or `.claude/worktrees/`. For `/synthetic/acme/app.worktrees/212-add-refunds/src` it is `212-add-refunds`. A working folder with no such part has none.
- The path rules of the Usage ingest Spec gain one rule: a path with a part `<repo folder>.worktrees/<name>`, where `<repo folder>` is a folder name that is not empty, maps to `<repo folder>`. This Spec replaces the Usage ingest sentence "a path with a `.claude/worktrees/<name>` or `.worktrees/<name>` part maps to the path before that part" with: "a path with a `.claude/worktrees/<name>` or `.worktrees/<name>` part maps to the path before that part, and a path with a `<repo folder>.worktrees/<name>` part maps to `<repo folder>`". Factory ADR 0016 puts each build worktree at `<repo folder>.worktrees/<branch>`, next to the repo folder. Today the path rules match only `.worktrees/<name>` below the repo folder, so in the local runtime a factory worktree becomes a Project of its own, and its Turns fall out of the Client scope.
- `user_messages` already has an index on the session ID and on the time (issue #15). This Spec adds no index.
- The migration adds a column that can be empty. Old Turns get their worktree name after `pnpm reindex`. The rollout runs `pnpm reindex` once.

### Refresh schedule

- The usage refresh runs when the API starts, then each `FOREMAN_USAGE_REFRESH_MINUTES` minutes (default 15) while it runs, and on `POST /api/usage/refresh`. This Spec replaces the Usage ingest sentence "The API starts a refresh when it starts, then each 24 hours while it runs, and on `POST /refresh`." The Usage ingest scenarios "Refresh on start, daily and on demand" and "A refresh while a refresh runs" then read "each 15 minutes" for "daily" and "the timer" for "the daily timer".
- The refresh is the same incremental refresh: it reads only the new lines of each file, by the cursor rules of the Usage ingest Spec. Only `pnpm reindex` reads all files again.
- The timer waits the interval after the end of the last refresh, so two refreshes never overlap. While a refresh holds the lock, the timer skips, by the Usage ingest rules.
- Thus "Sessions today" is at most 15 minutes old, plus the time of one refresh.

### Sessions and days

- A session is one session ID in `turns`. The Turns of its sub-agents carry the same session ID.
- The day is the `day` value (`YYYY-MM-DD`) in the `tz` value (an IANA name from the browser), as in the Usage API. A Turn is on the day when its local date in `tz` is the day.
- A session is on the day when it has one or more Turns on the day in scope. All numbers of the list and the timeline use only the Turns on the day in scope.
- The session has "continues from the day before" when it has Turns in scope before the day, and "continues on the next day" when it has Turns in scope after the day.
- The start and the end of a session are the times of its first and last Turn on the day in scope.
- Tokens are the sum of input, output, cache write and cache read tokens, as in the sort of the breakdown route.

### Name and kind

- **Name.** The skill name of the first Turn on the day in scope that has a skill and whose skill is not "(ambiguous)", with its plugin prefix, for example `factory-core:factory-run`. With no such Turn, the session has no name, and the page shows "No skill". The name never comes from a transcript title or a summary, because Claude Code makes those from the prompt text.
- **Kind.** From the skill calls of the main conversation of the session, on all days and in all Projects, by the first rule that applies. The part of the skill name after the last `:` is compared.

  | Skill call in the main conversation | Kind |
  |---|---|
  | `factory-run` | Unattended loop |
  | `factory-next` | Attended loop |
  | none of these | Session |

  The kind uses all skill calls of the main conversation, also outside the scope, because it names the factory loop, not data of a client. The `factory-run` skill is the Unattended loop and `factory-next` is the Attended loop (factory ADR 0013).

### Agent spans

An **Agent span** is the time from the first to the last **Turn** of one agent in one session: of one sub-agent (one agent ID), or of one run of main-conversation Turns with the same skill, skill basis, Project and issue number. Every Spec uses this definition. The Sessions view cuts each span to the Turns on the chosen day in scope; the Reviews view uses the sub-agent spans as they are.

- A sub-agent span is all Turns of one agent ID on the day in scope. Its label is the **Agent type**, and the skill of its Turns when they have one, for example "software-developer · to-code". By the Skill attribution rules, all Turns of one sub-agent have the same skill and basis, so a sub-agent span has one skill or none.
- A main span is a run of main-conversation Turns on the day in scope, in time order, with the same skill name, skill basis, Project key and issue number. A Turn where one of them changes starts a new main span. Its label is "main", with " · <skill> (estimate)" when its Turns have an estimated skill.
- The start and the end of a span are the times of its first and last Turn. A span with one Turn has the same start and end, and the bar shows with a width of 4 px.
- The models of a span are its distinct models, each with its count of Turns, most Turns first, then by name.
- The Project of a span is the Project of most of its Turns, then the first by key.
- Spans sort by start time, then by span key. The span key of a sub-agent span is `a:` and its agent ID; of a main span, `m:` and the turn key of its first Turn.
- The timeline does not group agents of the same type into one row, and it does not nest a sub-agent below the span that started it.

### Work items

- The issue number of a Turn comes from the first of these that matches `^([1-9][0-9]{0,8})-`:
  1. the worktree name of the Turn;
  2. the branch of the Turn.

  The worktree name comes first, because in a linked worktree Claude Code can write the branch as `HEAD`. Factory ADR 0016 names each build branch and its worktree `<issue>-<slug>`.
- A Turn whose worktree name and branch do not match has no issue number. Thus `main`, `HEAD`, `feature/foreman-v1`, `release/0.1`, `0-draft` and a Claude Code worktree name such as `brave-otter` give no work item.
- The repo of a Turn is the repo list entry whose `path` equals its Project key, by the step 2 rule for the client of a Project. With no entry, the work item has the number only.
- The work item of a span is the issue number of its Turns. When its Turns have no issue number, the span has no work item. When they have two or more different numbers, the span shows "N work items" with no link. A main span has at most one, by the rule of main spans.
- The title and the link come from the cached issue with that repo ID and number. With no cached issue, the work item has its repo and number, and no title and no link. The link follows the link rules of the step 2 Spec.

### Client scope

- With a `client` value, the view uses only the Turns, the skill calls and the user messages whose Project key belongs to that client, by the step 2 rules. With no value, it uses all of them.
- A Project with no repo list entry shows only in "All". In a client scope, the main conversation of a night run is often outside the scope: the view then shows only the sub-agent spans of the client's repos.
- A session with no Turn in scope on the day is not in the list, and its session route returns status 404, as for an unknown session. The response does not show that the session exists.
- The kind is the one exception to these rules, by the section "Name and kind".

### Sessions API

All routes are below `/api/sessions`, and their schemas are in `packages/shared`. Query schemas use `.strict()`. The routes are `public: true` for the reason in the Usage ingest Spec. The `Host` check of the Usage ingest Spec applies.

Common query values:

| Value | Rule |
|---|---|
| `day` | A calendar date `YYYY-MM-DD`. Required. |
| `tz` | An IANA time zone name, by the rule of the Usage API. Required. |
| `client` | The optional client, by the step 2 rules |
| `limit` | The page size, by route (below) |
| `cursor` | The `nextCursor` of the response before: an opaque base64url value of the last sort key. A cursor that is not valid gets status 400. |

| Route | Returns |
|---|---|
| `GET /` | The sessions of the day in scope, newest start first, then by session ID. `limit` is 1 to 200, default 50. |
| `GET /:sessionId` | One session of the day in scope, its time window, the times of the messages from the Operator and a page of its spans, by start time. `limit` is 1 to 500, default 200. A session ID matches `^[A-Za-z0-9_-]{1,64}$`; other values get status 400. A session with no Turn on the day in scope gets status 404. |

The list response:

| Part | Holds |
|---|---|
| `sessions` | For each session: `id`, `name` (or null), `kind` (`unattended-loop`, `attended-loop` or `session`), `start`, `end`, `continuesBefore`, `continuesAfter`, `projects` (up to 3, with `id` and `label`, most tokens first), `projectCount`, `tokens`, `turns`, `userMessages` (the count) |
| `total` | The count of sessions of the day in scope |
| `nextCursor` | The cursor of the next page, or null |

The session response:

| Part | Holds |
|---|---|
| `session` | The session, with the fields of a list item |
| `window` | The start and the end of the time axis: the first and the last Turn or user message of the session on the day in scope |
| `userMessages` | Up to 1,000 times of the messages from the Operator, in time order, and `userMessageTotal` |
| `spans` | For each span: `key`, `kind` (`main` or `sub-agent`), `agentType`, `skill` (or null), `skillBasis` (`exact`, `estimate` or null), `models` (each with `model` and `turns`), `project` (`id` and `label`), `workItem`, `start`, `end`, `turns`, `inputTokens`, `outputTokens`, `cacheWriteTokens`, `cacheReadTokens`, `tokens` |
| `spanTotal` | The count of spans of the session on the day in scope |
| `nextCursor` | The cursor of the next page of spans, or null |
| `complete` | The count of repos in scope with no cache rows or a fetch error, and the state "not connected" when no repo in scope has cache rows |

`workItem` is one of:

| `kind` | Fields |
|---|---|
| `none` | none |
| `one` | `repoId` (or null), `fullName` (`owner/name`, or null), `number`, `title` (or null), `link` (or null) |
| `several` | `count` |

All times are UTC, in ISO 8601. The web app shows them in the browser's time zone. The responses hold no prompt, reply, thinking, tool input, tool output, task description, transcript title or summary, and no working folder path. A Project shows only by its Project ID and label.

The list query reads the Turns of the day with the index on the Turn time. The names, the kinds and the message counts of one page come from one query each, with `inArray` on the session IDs of the page, not one query for each session.

### Web app

- This Spec owns `/sessions`. The page follows the prototype's "Sessions" tab: the session list on the left and the timeline of the selected session on the right. At phone width the list is above the timeline.
- **URL.** `day`, `session` and `client` are URL values, and every link inside the view keeps them. With no `day`, the page uses today in the browser time zone. With no `session`, it selects the first session of the list. A `day` that is not a calendar date shows "Not a valid day." and no data.
- **Day choice.** The heading is "Sessions today" for today, else "Sessions on" and the date, for example "Sessions on 13 Nov 2026". Next to it are a "Previous day" button, a date field and a "Next day" button. The date field has today as its maximum, and "Next day" is disabled on today.
- **Session list.** Each session is a link to its `session` value, with `aria-current="true"` on the selected one. It shows the name (or "No skill") and the first 8 characters of the session ID, the kind and the times, the first Project label with "+N" for more Projects, the tokens, and "N messages from you". It shows "continues from the day before" and "continues on the next day" when they apply. "Show more sessions" loads the next page, and shows only while `nextCursor` is not null.
- **Timeline.** The heading has the session name and the times, and the kind. Below it is the note "Metadata only. Foreman shows no prompt, reply, tool input or tool output. Skill attribution for main-conversation turns is an estimate." The first lane is "You", with one mark for each message from the Operator. Each span is one row: its label, its models and its work item on the left, its bar on the time axis, and its tokens on the right. "Show more spans" loads the next page.
- **Time axis.** The axis runs from the start to the end of `window`. A window of less than 10 minutes shows as 10 minutes from its start. The ticks use the smallest step of 5, 10, 15, 30, 60, 120 or 180 minutes that gives at most 8 ticks.
- **Drawing.** The timeline is HTML elements that CSS places on the time axis. It is not a chart of `apps/web/src/charts`, because it has one bar for each row and no axis values to plot.
- **Colours.** `main`, `software-developer`, `review-finder`, `review-verifier` and `review-resolver` each have a colour token in `apps/web/src/theme`, with a light and a dark value, and every other **Agent type** has one neutral token. Each bar has 3:1 contrast against its lane in both themes. The legend lists the Agent types of the loaded spans. The text label of each row carries the Agent type, so the colour is never the only carrier.
- **Table.** A table with the same spans, their start and end, Agent type, skill, models, work item, turns and full token counts is available to a screen reader. The timeline graphic is `aria-hidden`.
- **Formats.** Tokens, times and dates use the format module of the Usage view Spec, in the browser's time zone. The table shows the full numbers with thousands separators.
- **Data as of.** The page shows the usage status module of the Usage view Spec: "Usage data as of" and the time, the refresh progress, and the failed state. The header shows the Client scope, the connection state and the Refresh button of the step 2 Spec.
- **Work cache state.** When one or more repos in scope have no cache rows or a fetch error, the timeline shows "Data is not complete: N repos not connected. See Repos.", and "Repos" links to the Repos section of the **Foreman dash**. When no repo in scope has cache rows, it shows the step 2 "not connected" text, and the work items show their numbers only.
- **Live update.** While the view shows today and `document.visibilityState` is `visible`, the web app asks for the loaded pages of the list and of the selected session again each 60 seconds, and after a Refresh in the header. The data changes only after a usage refresh or a fetch.
- Titles, skill names, Agent types, model names and Project labels are React text nodes, by the step 2 rules. Links use only the `link` field.

## Gating and rollout

- **Gating:** not required. The view adds a page, two routes and one column. The path rule change moves the Turns of sibling worktrees to their repo's Project, which is the behaviour that git already gives when the folder exists. No other component reads the new column. The shorter refresh interval has its own variable: `FOREMAN_USAGE_REFRESH_MINUTES=1440` gives the old daily schedule back with no code change.
- **Rollout:** the issues merge into the Integration branch `feature/foreman-v1` (Integrated), in the order of the section "Build order". The Usage index change merges first. After it reaches the local runtime, the Operator runs `pnpm reindex` once, so that old Turns get their worktree name and their Project. To undo, revert the change; the view stores nothing, and `pnpm reindex` rebuilds the index.

## Data and compliance

- `.claude/factory.json` names no compliance regime.
- The view shows session IDs, skill names, Agent types, model IDs, Project labels, issue titles from the Work cache, and the times of the Operator's own messages. The new column holds worktree folder names, which are branch names, and the index already holds branch names.
- The view shows no text of a transcript. The parser drops all text fields, and the responses have no field that can hold one.
- All data stays on this Mac. In a client scope, the view hides the Turns, the spans and the message times of other clients' repos and of Projects with no client.

## Out of scope

- The exclusions of every Foreman v1 view: "Review scope of recent reviews" (it needs the `review-scope` Control event of factory Spec #85, which no code writes yet), overdue findings, the deferred finding events of factory ADR 0018, any action or write other than the refresh request, and cloud and CI sessions.
- Every prompt, reply, thinking block, tool input, tool output and sub-agent task description (foreman ADR 0003, "Session history").
- A session name from the transcript title or summary records. Claude Code makes them from the prompt text.
- The review round of a span, for example "round 1" in the prototype. No field of the **Usage index** gives it, and a join with the time of `gate` Control events would be a guess.
- One row for several agents of the same type, for example "review-finder ×5" in the prototype. The index does not keep the message that started an agent, so Foreman cannot tell which agents started together.
- Work item text that the prototype takes from the conversation, for example "night report" or "G2, 6 issues". No field gives it.
- The permission mode of a session, for example "auto mode" in the prototype. The parser does not read it, and the Usage ingest Spec does not list the field.
- The Project label "all enabled repos" of the prototype. The list shows the real Projects of the Turns.
- The pull request links that Claude Code records in a session. They are not in the field list of the Usage ingest Spec, and they link the whole session, not a span.
- A **List-price estimate** in this view. The Usage view has it.
- A range of more than one day, and a search for a session by ID across days.
- Nested spans: a sub-agent below the span that started it.

## Risks

- **The branch field in a worktree.** A field check on the Operator's machine showed the branch `HEAD` for the Turns in linked worktrees. The worktree name rule handles this. When an agent works in a worktree only by paths and its working folder stays the main checkout, its span has no work item.
- **The transcript format is not a stable public API.** A change to the working folder or the branch field can stop the work item link. The view then shows spans with no work item, and the counts stay right.
- **Skill attribution for main-conversation Turns is an estimate.** The main spans and the session name use it. The page labels each estimated span, and the note above the timeline says so.
- **The data is as new as the last usage refresh.** The usage refresh runs at start, each 15 minutes and on a Refresh in the header. Thus "Sessions today" can miss the last 15 minutes. The page shows "Usage data as of" so that the Operator sees the age.
- **A refresh each 15 minutes costs file reads.** Each refresh checks the cursor of each transcript file and reads only new lines. A refresh that reads nothing new ends in seconds. A refresh that runs when `pnpm reindex` starts makes the reindex stop with its message, by the Usage ingest rules; the Operator runs it again.
- **A large night run.** One run can have hundreds of spans. The span pages and the "Show more spans" button keep each response small.

## Build order

Each slice is one PR-sized issue. A slice of another Spec that it needs is named with its Spec number.

1. **68-1 Worktree Projects and the worktree name.** `packages/db` schema and migration, `apps/api/src/usage/projects`, `apps/api/src/usage/ingest`, with their tests. The scenarios "Worktree path in the local runtime" and "The worktree folder comes before the branch" (at the ingest layer). Needs: none.
2. **68-2 Usage refresh each 15 minutes.** `apps/api/src/usage/refresh`, `apps/api/src/config.ts`, with their tests. The scenario "Usage refresh each 15 minutes". Needs: none.
3. **68-3 Sessions list route.** `apps/api/src/sessions/sessions`, `apps/api/src/routes/sessions.ts` (`GET /`), `packages/shared`, `apps/api/test/`. The scenarios of the list, the name and the kind, the client scope of the list, paging of sessions and invalid queries. Needs: 68-1; Spec 23 issue #35 (the client of a Project).
4. **68-4 Session route, spans and work items.** `apps/api/src/sessions/spans`, `apps/api/src/sessions/work-items`, `apps/api/src/routes/sessions.ts` (`GET /:sessionId`), `packages/shared`. The span, work item, paging of spans and metadata scenarios. Needs: 68-3; Spec 23 issues #31 and #34 (the Work cache).
5. **68-5 Sessions page.** `apps/web/src/sessions`, `apps/web/src/theme` (the Agent type tokens), `apps/web/src/nav`. The day choice, the list, the timeline, the table, the states and the live update. Needs: 68-4; Spec 69 slices 69-1 and 69-2 (theme, format, usage status); Spec 24 issue #40 (the nav); Spec 23 issue #36 (the header).
6. **68-6 Sessions end-to-end tests.** `e2e/sessions.spec.ts` with the axe scan over the fixture sets of the scenario "Accessibility". Needs: 68-5.

## Open questions

- None. The usage refresh runs each 15 minutes, as a change to the Usage ingest Spec (section "Refresh schedule"). An incremental refresh reads only new lines, so it is cheap, and "Sessions today" is then at most 15 minutes old.
