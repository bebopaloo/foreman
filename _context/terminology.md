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

## Flagged ambiguities

### Transcript archive vs Usage index
The **Transcript archive** holds the raw transcripts and is the store of record. The **Usage index** holds only counts and labels, and Foreman can delete it and build it again from the archive. A loss of the index loses nothing; a loss of the archive loses history.

### List-price estimate vs subscription charge
The **List-price estimate** applies public API prices to the usage. It is not what the subscription charges, and it is never an invoice.
