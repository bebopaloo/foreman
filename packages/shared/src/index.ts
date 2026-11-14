import { z } from "zod";

export const HealthResponse = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    version: z.string().min(1),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponse>;

export const WorkClientsResponse = z
  .object({
    clients: z.array(z.object({ name: z.string(), repoCount: z.number().int() }).strict()),
    unassignedCount: z.number().int(),
  })
  .strict();

export type WorkClientsResponse = z.infer<typeof WorkClientsResponse>;

export const WorkReposResponse = z
  .object({
    repos: z.array(
      z
        .object({
          id: z.string(),
          fullName: z.string(),
          host: z.string(),
          client: z.string().nullable(),
          state: z.string().nullable(),
          dataAsOf: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type WorkReposResponse = z.infer<typeof WorkReposResponse>;

export const WorkStatusResponse = z
  .object({
    state: z.enum(["idle", "running", "failed"]),
    reason: z.string().nullable(),
    lastFetchAt: z.string().nullable(),
    problems: z.array(z.object({ position: z.number().int(), field: z.string() }).strict()),
  })
  .strict();

export type WorkStatusResponse = z.infer<typeof WorkStatusResponse>;

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

export const RefreshStatusResponse = z
  .object({
    state: z.enum(["idle", "running", "failed"]),
    filesRead: z.number().int().nullable(),
    filesTotal: z.number().int().nullable(),
    dataAsOf: z.iso.datetime().nullable(),
    reason: z.string().nullable(),
  })
  .strict();

export type RefreshStatusResponse = z.infer<typeof RefreshStatusResponse>;
