import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { labelProjects, projectId, resolveProjects } from "./projects.ts";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], {
    cwd,
    stdio: "ignore",
  });
}

async function makeRepo() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "foreman-projects-")));
  const main = path.join(root, "app");
  await mkdir(path.join(main, "src"), { recursive: true });
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "start");
  const worktree = path.join(root, "app.worktrees", "1-x");
  git(main, "worktree", "add", "-q", "--detach", worktree);
  return { root, main, worktree, sub: path.join(main, "src") };
}

describe("resolveProjects", () => {
  it("gives the main checkout, a worktree and a subfolder the same Project", async () => {
    const repo = await makeRepo();
    const result = await resolveProjects([repo.worktree, repo.sub, repo.main]);
    for (const cwd of [repo.main, repo.worktree, repo.sub]) {
      expect(result.get(cwd)).toEqual({ key: repo.main, noRepo: false });
    }
  });

  it("maps a missing folder with a worktree part to the path before that part", async () => {
    const result = await resolveProjects([
      "/synthetic/a/app/.claude/worktrees/x",
      "/synthetic/b/app/.worktrees/y/src",
    ]);
    expect(result.get("/synthetic/a/app/.claude/worktrees/x")?.key).toBe("/synthetic/a/app");
    expect(result.get("/synthetic/b/app/.worktrees/y/src")?.key).toBe("/synthetic/b/app");
  });

  it("maps a missing folder below a known key to the longest known key, in any order", async () => {
    const cwds = ["/synthetic/a/app/pkg/x", "/synthetic/a/app", "/synthetic/a/app/pkg"];
    for (const order of [cwds, [...cwds].reverse()]) {
      const result = await resolveProjects(order);
      for (const cwd of cwds) expect(result.get(cwd)?.key).toBe("/synthetic/a/app");
    }
    const withKnown = await resolveProjects(["/synthetic/a/app/pkg/x"], ["/synthetic/a/app"]);
    expect(withKnown.get("/synthetic/a/app/pkg/x")?.key).toBe("/synthetic/a/app");
  });

  it("uses the folder path for a folder outside a repo and flags it", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "foreman-norepo-")));
    const result = await resolveProjects([root]);
    expect(result.get(root)).toEqual({ key: root, noRepo: true });
  });
});

describe("labelProjects", () => {
  it("uses the folder name, and adds the parent folder for equal names", () => {
    const labels = labelProjects([
      { key: "/synthetic/a/app", noRepo: false },
      { key: "/synthetic/b/app", noRepo: false },
      { key: "/synthetic/c/other", noRepo: false },
      { key: "/synthetic/c/loose", noRepo: true },
    ]);
    expect(labels.get("/synthetic/a/app")).toBe("app (a)");
    expect(labels.get("/synthetic/b/app")).toBe("app (b)");
    expect(labels.get("/synthetic/c/other")).toBe("other");
    expect(labels.get("/synthetic/c/loose")).toBe("loose (no repo)");
  });
});

describe("projectId", () => {
  it("is the first 12 hex characters of the SHA-256 of the key", () => {
    expect(projectId("/synthetic/a/app")).toMatch(/^[0-9a-f]{12}$/);
    expect(projectId("/synthetic/a/app")).not.toBe(projectId("/synthetic/b/app"));
  });
});
