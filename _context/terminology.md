# Terminology

The words this project uses for its domain. Entry format: [README.md](README.md#terminology-entry).

## Language

### Project
The repo that a session works in, identified by the path of its main checkout. Work in any worktree of the repo counts toward the same Project.\
_Avoid_: workspace, folder, cwd

### Turn
One reply of the model in a session that carries token usage. Foreman counts each Turn once.\
_Avoid_: request, call, message

### Agent type
The kind of sub-agent that did a **Turn**, for example `software-developer`. A Turn in the main conversation has the agent type "main".\
_Avoid_: subagent name, role

### Skill attribution
How Foreman links **Turns** to a skill. It is exact for skill calls and for the sub-agents that a skill starts, and it is an estimate for Turns of the main conversation.\
_Avoid_: skill cost, skill usage

### Transcript archive
Compressed copies of finished session transcripts, which the factory keeps so that the history survives when Claude Code deletes old transcripts. It is the store of record for usage.\
_Refs:_ **Usage index**\
_Avoid_: durable store, backup, data lake

### Usage index
The database that Foreman builds from the **Transcript archive** and the live transcripts. Foreman can rebuild it at any time.\
_Refs:_ **Transcript archive**\
_Avoid_: store, cache

### Price table
The data file in this repo that holds the public per-token API price of each model, with its source and date.\
_Refs:_ **List-price estimate**\
_Avoid_: rate card, pricing config

### List-price estimate
What a set of **Turns** costs at the public per-token API prices. It is an estimate, not an invoice.\
_Refs:_ **Price table**\
_Avoid_: cost, spend, API cost, bill

### Limit window
One of the plan's usage limits and its period: the 5-hour window or the 7-day window.\
_Avoid_: quota, block, rate limit

### Limit reading
One record of the used percentage and the reset time of each **Limit window**, taken from the statusline.\
_Parent:_ **Limit window**\
_Avoid_: snapshot, sample

### Foreman dash
The start view of Foreman. For the **Client scope**, it shows the factory's progress, the builds that run in parallel, the review and control health, and the items that wait for the Operator, with links into the other views.\
_Refs:_ **Client scope**\
_Avoid_: dashboard, home page, mission control

### Client scope
The one client whose repos Foreman shows, or "All". Each repo in the factory's repo list names its client. With one client in scope, every view shows only the data of that client's repos, and the header shows the scope. A repo with no client is "Unassigned" and shows only in "All".\
_Refs:_ **Project**\
_Avoid_: tenant, workspace, filter, demo mode

### Work cache
The copy of the tracker and forge work state that Foreman keeps in its database: issues, pull requests, reviews and Releases, with titles and structured fields only. Foreman fills it with read commands of the adapters, and the forge and the tracker stay the record.\
_Refs:_ **Usage index**, **Client scope**\
_Avoid_: snapshot, mirror, index

### Session
One Claude Code conversation on this machine, with one session ID. The **Turns** of its sub-agents belong to it. A session can do Turns in more than one **Project**.\
_Refs:_ **Turn**, **Session timeline**\
_Avoid_: conversation, chat, run

### Agent span
The time from the first to the last **Turn** of one agent in one **Session**. The agent is one sub-agent, or one run of main-conversation Turns in a row with the same skill, **Project** and work item.\
_Refs:_ **Agent type**, **Skill attribution**, **Session timeline**\
_Avoid_: segment, bar, step, agent run

### Session timeline
The view of one **Session** on one day: its **Agent spans** on a time axis, and the times of the Operator's own messages. It shows metadata only, never the text of the conversation.\
_Refs:_ **Session**, **Agent span**\
_Avoid_: trace, transcript view

### Work view
The Foreman view that lists every cached issue with its **Linked pull request**, its CI result, its Machine gate decision, its review round and its Risk tier, for the **Client scope**.\
_Refs:_ **Work cache**, **Client scope**\
_Avoid_: issue list, backlog, board

### Linked pull request
The pull request of an issue: a pull request in the same repo whose branch name starts with the issue number and a hyphen, as the factory names its branches. When an issue has more than one, the open one with the highest number counts, else the one with the highest number.\
_Refs:_ **Work view**\
_Avoid_: issue PR, attached PR, closing PR

### Forge file
A file that Foreman reads from a client repo at its default branch through the forge adapter, for example the repo config, the Waiver register or a Repo rule. Foreman keeps only its parsed fields in the **Work cache**.\
_Parent:_ **Work cache**\
_Avoid_: repo file, remote file, artefact

### Path tier
The Risk tier that the Risk map gives a pull request from the paths that it changes, before any **Escalation**.\
_Refs:_ **Final tier**, **Escalation**\
_Avoid_: base tier, map tier

### Final tier
The highest Risk tier that a pull request had in its review rounds: the **Path tier**, or a higher tier from an **Escalation**. It never goes down.\
_Refs:_ **Path tier**\
_Avoid_: effective tier, current tier

### Escalation
A review round raises the Risk tier of a pull request above its **Path tier**, because a finding shows a risk that the paths do not show.\
_Refs:_ **Path tier**, **Final tier**\
_Avoid_: upgrade, bump, re-tier

### Review cycle
The time of one factory build from the end of the build to the settle of its pull request: the review rounds, the fixes of the resolver and the waits between them.\
_Refs:_ **Agent span**\
_Avoid_: review time, cycle time, PR time

### Engagement ledger
A record, for each client repo and day, of the Operator's own **Interactive time** and the Claude usage, from the **Usage index**. It is evidence for invoices and timesheets. It never counts time that agents worked alone.\
_Refs:_ **Interactive time**, **Client scope**\
_Avoid_: timesheet, time log

### Interactive time
The time that the Operator spent in sessions, estimated from the times of the Operator's own messages. Each message adds the time since the previous message when that time is short, and a small fixed time after a longer gap.\
_Parent:_ **Engagement ledger**\
_Avoid_: hours, billable time, active time

### Factory health
The Foreman view of the state of the factory itself: the plugin versions against the Marketplace, the **Rule drift** of each repo, and the runs of the Unattended loop with their **Stopped items**.\
_Refs:_ **Rule drift**, **Stopped item**\
_Avoid_: health check, health page, status page

### Rule drift
How a Repo rule in a repo differs from the Rule template that it came from: current, behind the template, edited by the team, or both. The team owns its rules, so drift is information, not an error.\
_Parent:_ **Factory health**\
_Avoid_: rule conflict, rule error, out of date

### Stopped item
A build that a run left open, because the run stopped before the build reached an end state. A later run of the Unattended loop resumes it.\
_Parent:_ **Factory health**\
_Avoid_: failed build, orphan, stuck item

## Flagged ambiguities

### Usage index vs Work cache
The **Usage index** comes from local files, and a reindex restores all of it. The **Work cache** comes from the forge and the tracker. A reindex restores its open items and the newest closed items, but not the older closed items.

### Transcript archive vs Usage index
The **Transcript archive** holds the raw transcripts and is the store of record. The **Usage index** holds only counts and labels, and Foreman can delete it and build it again from the archive. A loss of the index loses nothing; a loss of the archive loses history.

### List-price estimate vs subscription charge
The **List-price estimate** applies public API prices to the usage. It is not what the subscription charges, and it is never an invoice.

### Machine gate status vs gate event
The Machine gate status is the decision that the forge holds on the head commit of a pull request: pass, fail, pending or not set. A gate event is one Control event for one review round: pass, fail, wait or blocked. The **Work view** shows the status when the forge has one for the head commit. Else it shows the newest gate event, marked "(event)".

### Path tier vs Final tier
The **Path tier** comes from the Risk map alone. The **Final tier** also includes each **Escalation**. When a person adds a higher risk label, the Final tier goes up with no Escalation, and Foreman then shows the two tiers as equal.

### Interactive time vs usage
**Interactive time** measures the Operator's own time, from message times. Tokens and Turns measure the usage, which includes the Turns of agents that worked alone. An **Engagement ledger** row can have usage and no Interactive time.
