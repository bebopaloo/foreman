import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

/** The files whose UTC date is in the last 31 days, and the lines of the last 30 days. */
export const FILE_WINDOW_DAYS = 31;
export const LINE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A larger file is skipped and counted. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const FILE_NAME = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export type FolderState = "ok" | "missing" | "unreadable";

export interface SkippedFile {
  /** The file name, with no folder. It never holds line content. */
  file: string;
  lines: number;
}

export interface WindowRead<T> {
  folder: FolderState;
  /** The valid lines whose time is in the window, oldest file first. */
  items: T[];
  skippedLines: number;
  skippedFiles: number;
  /** The files with a skipped line or a skipped file, for the log. */
  reports: SkippedFile[];
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

/** A line time `YYYY-MM-DDTHH:MM:SSZ` as a Date, or null when it is not a real time. */
export function parseLineTime(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Reads the `<YYYY-MM-DD>.jsonl` files of one folder for the window, validates each line with the
 * schema, and counts what it skips. A last line with no line end is ignored and not counted,
 * because the writer can be in the middle of a write.
 *
 * `timeOf` gives the time of a valid line. A time in the future counts as now.
 */
export async function readJsonlWindow<S extends z.ZodType>(
  folder: string,
  schema: S,
  timeOf: (item: z.output<S>) => Date | null,
  now: Date,
): Promise<WindowRead<{ item: z.output<S>; time: Date }>> {
  const result: WindowRead<{ item: z.output<S>; time: Date }> = {
    folder: "ok",
    items: [],
    skippedLines: 0,
    skippedFiles: 0,
    reports: [],
  };
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (error) {
    result.folder = errorCode(error) === "ENOENT" ? "missing" : "unreadable";
    return result;
  }

  const earliestFile = utcDate(now.getTime() - FILE_WINDOW_DAYS * DAY_MS);
  const latestFile = utcDate(now.getTime());
  const earliestLine = now.getTime() - LINE_WINDOW_DAYS * DAY_MS;
  const files = names
    .flatMap((name) => {
      const date = FILE_NAME.exec(name)?.[1];
      return date !== undefined && date >= earliestFile && date <= latestFile ? [name] : [];
    })
    .sort();

  for (const name of files) {
    let text: string;
    try {
      const size = (await stat(path.join(folder, name))).size;
      if (size > MAX_FILE_BYTES) {
        result.skippedFiles += 1;
        result.reports.push({ file: name, lines: 0 });
        continue;
      }
      text = await readFile(path.join(folder, name), "utf8");
    } catch {
      result.skippedFiles += 1;
      result.reports.push({ file: name, lines: 0 });
      continue;
    }
    const lines = text.split("\n");
    // The last element has no line end: it is empty, or a line that is still being written.
    lines.pop();
    let skipped = 0;
    for (const line of lines) {
      if (line.trim() === "") continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        skipped += 1;
        continue;
      }
      const parsed = schema.safeParse(json);
      const time = parsed.success ? timeOf(parsed.data) : null;
      if (!parsed.success || time === null) {
        skipped += 1;
        continue;
      }
      if (time.getTime() < earliestLine) continue;
      result.items.push({ item: parsed.data, time: time.getTime() > now.getTime() ? now : time });
    }
    result.skippedLines += skipped;
    if (skipped > 0) result.reports.push({ file: name, lines: skipped });
  }
  return result;
}
