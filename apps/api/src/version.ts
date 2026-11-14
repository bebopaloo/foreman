import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const ROOT_PACKAGE = path.resolve(import.meta.dirname, "..", "..", "..", "package.json");

/** The `version` field of the root `package.json`: the Foreman version. */
export const FOREMAN_VERSION = z
  .object({ version: z.string().min(1) })
  .parse(JSON.parse(readFileSync(ROOT_PACKAGE, "utf8"))).version;
