import { z } from "zod";

/** The shape of a client name in the repo list. */
export const ClientName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
