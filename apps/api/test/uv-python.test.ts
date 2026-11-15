import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const run = promisify(execFile);
const ScriptOutput = z
  .object({ echo: z.string(), python: z.tuple([z.number(), z.number(), z.number()]) })
  .strict();
const SCRIPT = path.resolve(import.meta.dirname, "fixtures", "synthetic-adapter.py");

describe("uv and Python in the test environment", () => {
  it("runs a synthetic Python script with uv run on Python 3.12 or later", async () => {
    const { stdout } = await run("uv", ["run", "--no-project", "--offline", SCRIPT, "ping"], {
      timeout: 60_000,
    });
    const result = ScriptOutput.parse(JSON.parse(stdout));
    expect(result.echo).toBe("ping");
    const [major, minor] = result.python;
    expect(major > 3 || (major === 3 && minor >= 12)).toBe(true);
  });
});
