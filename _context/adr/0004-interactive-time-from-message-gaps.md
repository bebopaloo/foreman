# 4. The Engagement ledger estimates Interactive time from the gaps between the Operator's own messages, on one timeline

## Status

Accepted, 2026-11-15.

## Context

Factory ADR 0007 asks for the Operator's interactive time for each client repo and day, as evidence for invoices and timesheets. It must never count the time that agents worked alone. The Usage index keeps only the time of each real user message, with no text (ADR 0001). There were four options: the span from the first to the last message of each session; the span of the Turns of each session; the gaps between messages in each session; or the gaps between messages on one timeline across all sessions.

## Decision

Foreman puts all real user messages on one timeline, across all Projects and scopes. Each message adds the time since the previous message when that time is at most the idle cut-off, and else a fixed lead-in. The time belongs to the Project of the message and to its day in one configured time zone. Each row is rounded to whole minutes. The idle cut-off, the lead-in and the time zone are configuration variables, with the defaults 15 minutes, 2 minutes and `Europe/London`. Foreman calculates the ledger when it reads it and never stores it.

## Consequences

- No minute counts twice when the Operator works in two repos at one time, and the Client scope never changes a row.
- Time after the last message, agent runs longer than the cut-off, and reading for longer than the cut-off with no message never count.
- A change to a variable changes the ledger of past months, also of months that the Operator invoiced. The page shows the rule in force.
- The session spans were rejected because they count agent runs. The per-session gaps were rejected because parallel sessions count the same minutes twice.
