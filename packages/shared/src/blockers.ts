import { z } from "zod";
import { ClientName } from "./client.ts";

const RepoId = z.string().regex(/^[0-9a-f]{12}$/);

export const WorkBlockersQuery = z
  .object({
    client: ClientName.optional(),
    repo: RepoId.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();
export type WorkBlockersQuery = z.infer<typeof WorkBlockersQuery>;

export const WorkBlocker = z
  .object({
    repoId: RepoId,
    /** `owner/name`. */
    repo: z.string(),
    number: z.number().int(),
    title: z.string(),
    issueState: z.string(),
    labels: z.array(z.string()),
    link: z.string().nullable(),
    /** The open issues that this issue blocks directly. */
    direct: z.array(z.number().int()),
    /** The open issues that this issue cuts off, direct ones included. */
    cutsOff: z.array(z.number().int()),
  })
  .strict();
export type WorkBlocker = z.infer<typeof WorkBlocker>;

export const WorkBlockersResponse = z
  .object({
    /** The number of blockers before `limit` applies. */
    total: z.number().int(),
    items: z.array(WorkBlocker),
  })
  .strict();
export type WorkBlockersResponse = z.infer<typeof WorkBlockersResponse>;
