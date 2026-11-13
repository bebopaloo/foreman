import { z } from "zod";

export const HealthResponse = z
  .object({
    status: z.enum(["ok", "unavailable"]),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponse>;
