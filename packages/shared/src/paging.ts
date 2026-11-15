import { z } from "zod";

export interface PageLimits {
  defaultLimit: number;
  maxLimit: number;
}

/**
 * The `limit` and `cursor` query values of a list route. Spread the shape into
 * the route's own `z.object({...}).strict()` query schema.
 */
export function pageQueryShape({ defaultLimit, maxLimit }: PageLimits) {
  if (!Number.isInteger(defaultLimit) || !Number.isInteger(maxLimit)) {
    throw new RangeError("The page limits must be integers");
  }
  if (defaultLimit < 1 || defaultLimit > maxLimit) {
    throw new RangeError("The default limit must be from 1 to the maximum limit");
  }
  return {
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().min(1).max(2048).optional(),
  };
}

/** The cursor of the next page, or null on the last page. */
export const NextCursor = z.string().min(1).nullable();

export type NextCursor = z.infer<typeof NextCursor>;

export function pageResponseSchema<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), nextCursor: NextCursor }).strict();
}
