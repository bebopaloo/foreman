import { z } from "zod";

export const HealthResponse = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    version: z.string().min(1),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponse>;
