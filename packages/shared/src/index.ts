import { z } from "zod";

export const HealthResponse = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    version: z.string().min(1),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponse>;

export const ProjectsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(1000).default(500),
  })
  .strict();

export type ProjectsQuery = z.infer<typeof ProjectsQuery>;

export const UsageProject = z
  .object({
    id: z.string().regex(/^[0-9a-f]{12}$/),
    label: z.string().min(1),
    noRepo: z.boolean(),
    firstTurnAt: z.iso.datetime(),
    lastTurnAt: z.iso.datetime(),
  })
  .strict();

export type UsageProject = z.infer<typeof UsageProject>;

export const ProjectsResponse = z.object({ projects: z.array(UsageProject) }).strict();

export type ProjectsResponse = z.infer<typeof ProjectsResponse>;
