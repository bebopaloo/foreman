import { z } from "zod";

/** The most builds that the factory runs at one time. The slot-use counts go from 0 to this. */
export const RUN_SLOT_LIMIT = 5;

export const RunReportParams = z
  .object({ runId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) })
  .strict();
export type RunReportParams = z.infer<typeof RunReportParams>;

const repo = z.string();
const issue = z.number().int();

export const RunReportResponse = z
  .object({
    runId: z.string(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    stateChanges: z.array(
      z
        .object({
          time: z.iso.datetime(),
          repo,
          issue,
          from: z.string(),
          to: z.string(),
          reason: z.string(),
        })
        .strict(),
    ),
    merges: z.array(
      z
        .object({
          time: z.iso.datetime(),
          repo,
          issue,
          pr: z.number().int().nullable(),
          /** The Risk tier of the merged event, or of the last gate event. */
          tier: z.string().nullable(),
          /** The round and the finding counts of the last gate event of the pull request. */
          round: z.number().int().nullable(),
          counts: z.record(z.string(), z.number().int()),
        })
        .strict(),
    ),
    blocked: z.array(
      z.object({ time: z.iso.datetime(), repo, issue, reason: z.string() }).strict(),
    ),
    skips: z
      .object({
        total: z.number().int(),
        byBlocker: z.array(z.object({ repo, blocker: issue, issues: z.array(issue) }).strict()),
        other: z.array(z.object({ repo, issue, reason: z.string() }).strict()),
      })
      .strict(),
    summary: z.object({ file: z.string(), text: z.string() }).strict().nullable(),
    slotUse: z
      .object({
        slotLimit: z.literal(RUN_SLOT_LIMIT),
        builds: z.number().int(),
        minutes: z.number().int(),
        /** The mean of the busy count over the minutes of the run. */
        average: z.number(),
        /** Index 0 to 5: the minutes with that many busy slots. */
        minutesAtCount: z.array(z.number().int()).length(RUN_SLOT_LIMIT + 1),
        /** The busy count of each minute, from the start of the run. */
        perMinute: z.array(z.number().int()),
      })
      .strict(),
    skippedLines: z.number().int(),
  })
  .strict();
export type RunReportResponse = z.infer<typeof RunReportResponse>;
