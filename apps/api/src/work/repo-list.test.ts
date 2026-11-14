import { describe, expect, it } from "vitest";
import { entry, entryWithoutRepo, makeClaudeDir } from "../../test/repo-list-fixtures.ts";
import { readRepoList } from "./repo-list.ts";

describe("readRepoList", () => {
  it("reports a missing file", async () => {
    expect(await readRepoList(await makeClaudeDir())).toEqual({ status: "missing" });
  });

  it("reports text that is not JSON as unreadable", async () => {
    expect(await readRepoList(await makeClaudeDir('{"repos": ['))).toEqual({
      status: "unreadable",
    });
  });

  it("reports a repos value that is not a list as unreadable", async () => {
    const dir = await makeClaudeDir({ repos: { a: 1 } });
    expect(await readRepoList(dir)).toEqual({ status: "unreadable" });
  });

  it("reads valid entries with a repo ID from the lower-case host, owner and name", async () => {
    const dir = await makeClaudeDir({ repos: [entry("Acme/App", "acme")] });
    const result = await readRepoList(dir);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.problems).toEqual([]);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({
      position: 0,
      host: "github.com",
      owner: "Acme",
      name: "App",
      client: "acme",
    });
    // sha256("github.com/acme/app").slice(0, 12)
    expect(result.repos[0]?.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("skips an entry whose client has a space and names its position and field only", async () => {
    const dir = await makeClaudeDir({
      repos: [entry("acme/app", "acme"), entry("acme/bad", "bad client")],
    });
    const result = await readRepoList(dir);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.repos.map((repo) => repo.name)).toEqual(["app"]);
    expect(result.problems).toEqual([{ position: 1, field: "client" }]);
    expect(JSON.stringify(result)).not.toContain("bad client");
  });

  it("names an unknown key as the failed field", async () => {
    const dir = await makeClaudeDir({ repos: [entry("acme/app", "acme", { surprise: 1 })] });
    const result = await readRepoList(dir);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.problems).toEqual([{ position: 0, field: "surprise" }]);
  });

  it("uses the first of two entries for the same repo with the same client", async () => {
    const dir = await makeClaudeDir({
      repos: [entry("Acme/App", "acme"), entry("acme/app", "acme")],
    });
    const result = await readRepoList(dir);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.repos.map((repo) => repo.position)).toEqual([0]);
    expect(result.problems).toEqual([]);
  });

  it("skips all entries for the same repo when their clients differ", async () => {
    const dir = await makeClaudeDir({
      repos: [entry("Acme/App", "acme"), entry("other/x", "acme"), entry("acme/app", "globex")],
    });
    const result = await readRepoList(dir);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.repos.map((repo) => repo.position)).toEqual([1]);
    expect(result.problems).toEqual([
      { position: 0, field: "client" },
      { position: 2, field: "client" },
    ]);
  });

  it("keeps the repo IDs of skipped entries as named", async () => {
    const dir = await makeClaudeDir({
      repos: [entry("acme/app", "acme"), entry("acme/app", "globex"), entry("acme/bad", "x y")],
    });
    const result = await readRepoList(dir);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.namedIds.size).toBe(2);
    expect(result.identityUnknown).toBe(false);
  });

  it("marks the list as having an unknown identity when a bad entry has no usable repo", async () => {
    const dir = await makeClaudeDir({ repos: [entry("not a repo", "acme")] });
    const result = await readRepoList(dir);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.problems).toEqual([{ position: 0, field: "repo" }]);
    expect(result.identityUnknown).toBe(true);
  });

  it("keeps a valid entry with no repo field and reports no problem", async () => {
    const result = await readRepoList(await makeClaudeDir({ repos: [entryWithoutRepo("acme")] }));
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.problems).toEqual([]);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({ owner: null, name: null, client: "acme" });
  });
});
