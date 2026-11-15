import { z } from "zod";
import { ClientName } from "./client.ts";

const FolderState = z.enum(["ok", "missing", "unreadable"]);

/** `GET /api/dash`. `client` is the Client scope; the route holds no data of other clients. */
export const DashQuery = z.object({ client: ClientName.optional() }).strict();
export type DashQuery = z.infer<typeof DashQuery>;

export const BUILD_RESULTS = [
  "merged",
  "merge-ready",
  "blocked",
  "cancelled",
  "in review",
  "stopped at run end",
  "running",
] as const;
export const BuildResult = z.enum(BUILD_RESULTS);
export type BuildResult = z.infer<typeof BuildResult>;

const Build = z
  .object({
    /** The repo ID of a repo in the repo list. Null for a repo folder that is not in the list. */
    repoId: z.string().nullable(),
    /** `owner/name`, or the last part of the repo folder when the repo has no entry. */
    repo: z.string(),
    issue: z.number().int().positive(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    result: BuildResult,
    /** From 1. */
    lane: z.number().int().min(1),
  })
  .strict();
export type Build = z.infer<typeof Build>;

/** The newest run in scope. */
export const LastRun = z
  .object({
    runId: z.string(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    /** True while the run lock holds this run and is not stale. */
    running: z.boolean(),
    builds: z.array(Build),
    /** The count of lanes that the builds need. */
    lanes: z.number().int().min(0),
    skips: z.number().int().min(0),
    blockedAtSelection: z.number().int().min(0),
  })
  .strict();
export type LastRun = z.infer<typeof LastRun>;

export const DashResponse = z
  .object({
    run: z
      .object({
        /** `none` is no lock, a stale lock or a lock that Foreman cannot read. */
        state: z.enum(["in_progress", "none", "unreadable"]),
        /** True when a stopped run left a lock with a heartbeat more than 3 hours ago. */
        stale: z.boolean(),
        heartbeatAt: z.iso.datetime().nullable(),
        /** Whole seconds, never below 0: a heartbeat in the future counts as now. */
        heartbeatAgeSeconds: z.number().int().min(0).nullable(),
      })
      .strict(),
    /** The newest run in scope, or null with no run in the last 30 days. */
    lastRun: LastRun.nullable(),
    /** The state of the two factory folders. */
    sources: z.object({ runs: FolderState, controls: FolderState }).strict(),
    skipped: z
      .object({
        nightLogLines: z.number().int().min(0),
        controlEvents: z.number().int().min(0),
        files: z.number().int().min(0),
        lock: z.number().int().min(0).max(1),
      })
      .strict(),
  })
  .strict();
export type DashResponse = z.infer<typeof DashResponse>;
