import { z } from "zod";
import { NextCursor, pageQueryShape } from "./paging.ts";

/** The most days that one ledger range may hold, both end days counted. */
export const MAX_LEDGER_DAYS = 366;
export const LEDGER_DEFAULT_LIMIT = 100;
export const LEDGER_MAX_LIMIT = 500;
/** The most lines of the summary by client repo. */
export const MAX_LEDGER_REPOS = 500;

const LedgerDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Not a calendar date");

const DAY_MS = 86_400_000;

/** The count of days from `from` to `to`, both counted. */
export function ledgerRangeDays(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) +
    1
  );
}

export const LedgerQuery = z
  .object({
    from: LedgerDate.optional(),
    to: LedgerDate.optional(),
    client: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
      .optional(),
    ...pageQueryShape({ defaultLimit: LEDGER_DEFAULT_LIMIT, maxLimit: LEDGER_MAX_LIMIT }),
  })
  .strict()
  .refine(
    (query) => (query.from === undefined) === (query.to === undefined),
    "from and to go together",
  )
  .refine(
    (query) => query.from === undefined || query.to === undefined || query.from <= query.to,
    "from is after to",
  )
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      ledgerRangeDays(query.from, query.to) <= MAX_LEDGER_DAYS,
    "The range is too long",
  );
export type LedgerQuery = z.infer<typeof LedgerQuery>;

const projectFields = {
  projectId: z.string().regex(/^[0-9a-f]{12}$/),
  repoId: z.string().nullable(),
  label: z.string().min(1),
  client: z.string().nullable(),
  interactiveMinutes: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
};

export const LedgerRow = z
  .object({
    day: LedgerDate,
    ...projectFields,
    messages: z.number().int().nonnegative(),
  })
  .strict();
export type LedgerRow = z.infer<typeof LedgerRow>;

export const LedgerRepo = z
  .object({ ...projectFields, days: z.number().int().nonnegative() })
  .strict();
export type LedgerRepo = z.infer<typeof LedgerRepo>;

export const LedgerResponse = z
  .object({
    rules: z
      .object({
        timeZone: z.string(),
        idleMinutes: z.number().int(),
        leadInMinutes: z.number().int(),
      })
      .strict(),
    range: z.object({ from: LedgerDate, to: LedgerDate }).strict(),
    rows: z.array(LedgerRow),
    rowCount: z.number().int().nonnegative(),
    nextCursor: NextCursor,
    repos: z.object({ lines: z.array(LedgerRepo), cut: z.number().int().nonnegative() }).strict(),
    totals: z
      .object({
        interactiveMinutes: z.number().int().nonnegative(),
        messages: z.number().int().nonnegative(),
        sessions: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type LedgerResponse = z.infer<typeof LedgerResponse>;
