# 1. The raw Transcript archive is the store of record, and Postgres is a rebuildable index

## Status

Accepted, 2026-11-13.

## Context

Claude Code deletes old transcripts after a period. Foreman needs the full usage history, and later the Engagement ledger needs the times of the Operator's own messages. Some store must keep the history after Claude Code deletes a transcript.

There were four options:

- A factory hook copies the raw transcripts, compressed, into a **Transcript archive** folder, and Foreman builds a **Usage index** from it.
- The hook parses the transcripts and writes only the parsed facts.
- The hook writes the parsed facts into Postgres.
- The Operator raises `cleanupPeriodDays` so that Claude Code keeps transcripts for longer.

## Decision

The factory's `SessionEnd` hook copies the raw transcript files and the sub-agent files, compressed, into the **Transcript archive** in the Foreman data folder. The hook does not parse the files and needs no database. The archive is the store of record.

Foreman builds the **Usage index** in Postgres from the archive and the live transcripts. The index is disposable: `pnpm reindex` deletes it and builds it again. The factory repo refers to this ADR from its own record of the archive hook.

## Consequences

- A plain folder is more durable than a Docker volume. A lost or changed database loses nothing, because a reindex restores it.
- The parse rules exist in one place, in Foreman. A fix to a parse rule applies to all of the history after a reindex.
- The archive keeps the full raw data, so a later feature can read values that the index does not keep today.
- The archive holds sensitive transcript text for a long time. The archive folder has mode `0700` and each file mode `0600`, and Foreman mounts it read-only.
- The hook does not depend on Postgres, so a session can end when Foreman is not running.
- Raising `cleanupPeriodDays` was rejected: it keeps the history only while the setting stays, and it does not survive a reinstall or a cleanup by hand.
