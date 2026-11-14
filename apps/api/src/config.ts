import os from "node:os";
import path from "node:path";
import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

function expandHome(value: string, home: string): string {
  const expanded =
    value === "~" || value.startsWith("~/") ? path.join(home, value.slice(1)) : value;
  return path.resolve(expanded);
}

/** The price table in the repo, two folders above `apps/api/src`. */
const DEFAULT_PRICE_TABLE = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "data",
  "price-table.json",
);

function folderSchema(name: string, home: string) {
  return z
    .string()
    .min(1)
    .default(name)
    .transform((value) => expandHome(value, home));
}

function createConfigSchema(home: string) {
  return z.object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(47_130),
    CORS_ORIGINS: z
      .string()
      .default("http://127.0.0.1:47173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    FOREMAN_CLAUDE_DIR: folderSchema("~/.claude-bebopaloo", home).refine(
      (folder) => folder !== path.join(home, ".claude"),
    ),
    FOREMAN_DATA_DIR: folderSchema("~/.foreman", home),
    FOREMAN_PRICE_TABLE: z
      .string()
      .min(1)
      .default(DEFAULT_PRICE_TABLE)
      .transform((value) => expandHome(value, home)),
  });
}

export type Config = z.infer<ReturnType<typeof createConfigSchema>>;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): Config {
  const result = createConfigSchema(home).safeParse(env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid configuration: ${names}`);
  }
  return result.data;
}
