import { z } from "zod";
import { ClientName } from "./client.ts";

const FolderState = z.enum(["ok", "missing", "unreadable"]);

/** `GET /api/dash`. `client` is the Client scope; the route holds no data of other clients. */
export const DashQuery = z.object({ client: ClientName.optional() }).strict();
export type DashQuery = z.infer<typeof DashQuery>;

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
