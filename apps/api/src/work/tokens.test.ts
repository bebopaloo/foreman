import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedAdapter } from "./adapters.ts";
import { runAdapterCommand } from "./runner.ts";
import { NO_TOKEN_STATE, readTokens, resolveToken, TOKEN_REFUSED_STATE } from "./tokens.ts";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "adapter",
  "synthetic_adapter.py",
);

const ACME_TOKEN = "github_pat_synthetic_acme";
const OWN_TOKEN = "github_pat_synthetic_bebopaloo";
const CLASSIC_TOKEN = "ghp_synthetic_classic";
const PREFIX = "github_pat_";

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "foreman-tokens-test-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

async function tokensFile(content: string): Promise<string> {
  const file = path.join(folder, "tokens.json");
  await writeFile(file, content);
  return file;
}

describe("reading the tokens file", () => {
  it("reads one token for each host and owner, in lower case", async () => {
    const file = await tokensFile(
      JSON.stringify({ "GitHub.com/Acme": ACME_TOKEN, "github.com/bebopaloo": OWN_TOKEN }),
    );
    const tokens = await readTokens(file);
    expect(resolveToken(tokens, "github.com", "acme", { tokenPrefix: PREFIX })).toEqual({
      ok: true,
      token: ACME_TOKEN,
    });
    expect(resolveToken(tokens, "GITHUB.com", "Bebopaloo", { tokenPrefix: PREFIX })).toEqual({
      ok: true,
      token: OWN_TOKEN,
    });
  });

  it.each([
    ["a missing file", undefined],
    ["a file that is not JSON", "not json"],
    ["a file that is not an object", '["github.com/acme"]'],
    ["a token that is not a string", '{"github.com/acme": 5}'],
    ["an empty token", '{"github.com/acme": ""}'],
    ["a key that is not host/owner", '{"acme": "github_pat_x"}'],
  ])("gives no token for %s", async (_name, content) => {
    const file = content === undefined ? path.join(folder, "none.json") : await tokensFile(content);
    const tokens = await readTokens(file);
    expect(tokens.size).toBe(0);
    expect(resolveToken(tokens, "github.com", "acme", { tokenPrefix: PREFIX })).toEqual({
      ok: false,
      state: NO_TOKEN_STATE,
    });
  });

  it("takes a token store as it is", async () => {
    const store = new Map([["github.com/acme", ACME_TOKEN]]);
    const tokens = await readTokens(store);
    expect(resolveToken(tokens, "github.com", "acme", { tokenPrefix: PREFIX })).toEqual({
      ok: true,
      token: ACME_TOKEN,
    });
  });

  it("gives no token when no file is configured", async () => {
    expect((await readTokens(undefined)).size).toBe(0);
  });
});

describe("the prefix rule", () => {
  it("refuses a token with another prefix and leaks neither the token nor the prefix", async () => {
    const tokens = await readTokens(
      await tokensFile(JSON.stringify({ "github.com/acme": CLASSIC_TOKEN })),
    );
    const result = resolveToken(tokens, "github.com", "acme", { tokenPrefix: PREFIX });
    expect(result).toEqual({ ok: false, state: TOKEN_REFUSED_STATE });
    expect(TOKEN_REFUSED_STATE).toBe("token refused: not a fine-grained token");
    const text = JSON.stringify(result);
    expect(text).not.toContain(CLASSIC_TOKEN);
    expect(text).not.toContain("ghp_");
    expect(text).not.toContain(PREFIX);
  });

  it("applies the prefix of each adapter separately", async () => {
    const tokens = await readTokens(
      await tokensFile(JSON.stringify({ "github.com/acme": ACME_TOKEN })),
    );
    expect(resolveToken(tokens, "github.com", "acme", { tokenPrefix: PREFIX }).ok).toBe(true);
    expect(resolveToken(tokens, "github.com", "acme", { tokenPrefix: "other_" })).toEqual({
      ok: false,
      state: TOKEN_REFUSED_STATE,
    });
  });
});

describe("one token for each owner at the runner", () => {
  it("gives the adapter calls for a repo only the token of its owner", async () => {
    await copyFile(SCRIPT, path.join(folder, "synthetic_adapter.py"));
    const adapter: ResolvedAdapter = {
      role: "forge",
      pluginDir: folder,
      command: path.join(folder, "synthetic_adapter.py"),
      tokenEnv: "SYNTH_TOKEN",
      tokenPrefix: PREFIX,
    };
    await writeFile(path.join(folder, "control.json"), JSON.stringify({ stdout: "[]" }));
    const tokens = await readTokens(
      await tokensFile(
        JSON.stringify({ "github.com/acme": ACME_TOKEN, "github.com/bebopaloo": OWN_TOKEN }),
      ),
    );

    const seen: Record<string, string[]> = {};
    for (const repo of ["acme/app", "bebopaloo/foreman"]) {
      const [owner = ""] = repo.split("/");
      const resolved = resolveToken(tokens, "github.com", owner, adapter);
      if (!resolved.ok) throw new Error("expected a token");
      const result = await runAdapterCommand(
        {
          adapter,
          host: "github.com",
          repo,
          token: resolved.token,
          command: ["pr", "list", "--state", "open"],
        },
        { allowedHosts: ["github.com"], timeoutMs: 20_000 },
      );
      expect(result.ok).toBe(true);
      const record = JSON.parse(await readFile(path.join(folder, "record.json"), "utf8")) as {
        env: Record<string, string>;
      };
      seen[repo] = Object.values(record.env).filter((value) => value.startsWith(PREFIX));
    }
    expect(seen).toEqual({ "acme/app": [ACME_TOKEN], "bebopaloo/foreman": [OWN_TOKEN] });
  });
});
