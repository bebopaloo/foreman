import { createDatabase, schema } from "@foreman/db";
import { repoId } from "@foreman/api/repo-list";

export interface SeedRepo {
  /** `owner/name` on github.com. */
  fullName: string;
  /** The Client of the repo list entry. Null: no client. */
  client: string | null;
  /** The state of the forge and the tracker role. The default is `ok`, the state of a clean fetch. */
  state?: string;
}

export interface SeedIssue {
  repo: string;
  number: number;
  title: string;
  issueState: string;
  state?: "open" | "closed";
  priority?: string;
  labels?: string[];
  author?: string;
  children?: number[];
  /** The cached link. Null: the link failed the check. The default is the issue address on github.com. */
  link?: string | null;
  /** True: the last listing of the repo did not include the issue. */
  stale?: boolean;
}

export interface SeedPullRequest {
  repo: string;
  number: number;
  title: string;
  base?: string;
  head?: string;
  author?: string;
  state?: "open" | "closed" | "merged";
  labels?: string[];
  headSha?: string;
  linkedIssue?: number;
  draft?: boolean;
}

/** A cached status of the head commit of a pull request. */
export interface SeedStatus {
  repo: string;
  pullRequest: number;
  context: string;
  sha: string;
  state: string;
}

export interface SeedReview {
  repo: string;
  pullRequest: number;
  author: string;
}

/** A cached repo config of a repo: the parsed fields only. */
export interface SeedRepoConfig {
  repo: string;
  /** The Control modules that the repo turns on. With none, the repo has no `controls` key. */
  modules: readonly string[];
  /** The Control profile. The default is `synthetic`. */
  profile?: string;
  /** The `releases` key of the repo config. */
  releases?: { productionBranch: string; switchedOver: string };
}

/** A cached Forge file of a Control module: its parsed fields only. */
export interface SeedForgeFile {
  repo: string;
  path: string;
  fields: unknown;
  /** The skipped entries of the parser. */
  skipped?: { position: number; field: string }[];
}

/** A tracker Release with its forge release and its Release record. */
export interface SeedRelease {
  repo: string;
  name: string;
  state: "open" | "released";
  issueNumbers: number[];
  /** The asset names of the forge release. With none given, the Release has no forge release row. */
  assetNames?: string[];
  /** The parsed fields of the Release record, as the API keeps them. */
  record?: unknown;
}

/** The synthetic Work cache of one fixture set. */
export interface WorkSeed {
  repos: SeedRepo[];
  issues?: SeedIssue[];
  pullRequests?: SeedPullRequest[];
  reviews?: SeedReview[];
  statuses?: SeedStatus[];
  repoConfigs?: SeedRepoConfig[];
  forgeFiles?: SeedForgeFile[];
  releases?: SeedRelease[];
}

export function idOf(fullName: string): string {
  const [owner = "", name = ""] = fullName.split("/");
  return repoId("github.com", owner, name);
}

/** Replaces the whole Work cache of the e2e database with the seed. */
export async function seedWorkCache(
  databaseUrl: string,
  seed: WorkSeed | undefined,
  now: Date,
): Promise<void> {
  const database = createDatabase(databaseUrl);
  try {
    await database.db.transaction(async (tx) => {
      await tx.delete(schema.workForgeFiles);
      await tx.delete(schema.workReleaseRecords);
      await tx.delete(schema.workCommitStatuses);
      await tx.delete(schema.workReviews);
      await tx.delete(schema.workPullRequests);
      await tx.delete(schema.workIssues);
      await tx.delete(schema.workReleases);
      await tx.delete(schema.workForgeReleases);
      await tx.delete(schema.workRepos);
      if (seed === undefined) return;
      for (const repo of seed.repos) {
        const [owner = "", name = ""] = repo.fullName.split("/");
        const state = repo.state ?? "ok";
        await tx.insert(schema.workRepos).values({
          id: idOf(repo.fullName),
          host: "github.com",
          owner,
          name,
          client: repo.client,
          forgePlugin: "factory-github",
          trackerPlugin: "factory-github",
          forgeState: state,
          trackerState: state,
          lastGoodFetchAt: state === "ok" || state === "partial" ? now : null,
          ...(state === "ok" || state === "partial"
            ? { defaultBranch: "main", fileBranch: "main", repoState: "ok" }
            : {}),
        });
      }
      for (const issue of seed.issues ?? []) {
        await tx.insert(schema.workIssues).values({
          repoId: idOf(issue.repo),
          number: issue.number,
          title: issue.title,
          state: issue.state ?? "open",
          issueState: issue.issueState,
          priority: issue.priority ?? "medium",
          labels: issue.labels ?? [],
          author: issue.author ?? "synthetic-author",
          link:
            issue.link === undefined
              ? `https://github.com/${issue.repo}/issues/${issue.number.toString()}`
              : issue.link,
          children: issue.children ?? [],
          lastListedAt: issue.stale === true ? new Date(now.getTime() - 3_600_000) : now,
        });
      }
      for (const pull of seed.pullRequests ?? []) {
        await tx.insert(schema.workPullRequests).values({
          repoId: idOf(pull.repo),
          number: pull.number,
          title: pull.title,
          state: pull.state ?? "open",
          draft: pull.draft ?? false,
          labels: pull.labels ?? [],
          headSha: pull.headSha ?? null,
          linkedIssue: pull.linkedIssue ?? null,
          headBranch: pull.head ?? `${pull.number.toString()}-change`,
          baseBranch: pull.base ?? "main",
          author: pull.author ?? "synthetic-author",
          checks: "success",
          link: `https://github.com/${pull.repo}/pull/${pull.number.toString()}`,
          lastListedAt: now,
        });
      }
      for (const status of seed.statuses ?? []) {
        await tx.insert(schema.workCommitStatuses).values({
          repoId: idOf(status.repo),
          pullRequestNumber: status.pullRequest,
          context: status.context,
          sha: status.sha,
          state: status.state,
          fetchedAt: now,
        });
      }
      for (const config of seed.repoConfigs ?? []) {
        await tx.insert(schema.workForgeFiles).values({
          repoId: idOf(config.repo),
          path: ".claude/factory.json",
          ref: "main",
          sha: "c".repeat(40),
          fetchedAt: now,
          state: "ok",
          fields: {
            mainBranch: null,
            rules: { state: "ok", value: [] },
            compliance: { state: "ok", value: [] },
            stackPack: { state: "ok", value: null },
            factoryCoreVersion: { state: "ok", value: null },
            controls:
              config.modules.length === 0
                ? { state: "none" }
                : { state: "ok", profile: config.profile ?? "synthetic", modules: config.modules },
            releases: config.releases ?? null,
          },
        });
      }
      for (const file of seed.forgeFiles ?? []) {
        await tx.insert(schema.workForgeFiles).values({
          repoId: idOf(file.repo),
          path: file.path,
          ref: "main",
          sha: "abcdef0123456789abcdef0123456789abcdef01",
          size: 100,
          fetchedAt: now,
          state: "ok",
          skipped: file.skipped ?? [],
          fields: file.fields,
        });
      }
      for (const release of seed.releases ?? []) {
        const repo = idOf(release.repo);
        await tx.insert(schema.workReleases).values({
          repoId: repo,
          name: release.name,
          state: release.state,
          link: `https://github.com/${release.repo}/milestone/${release.name.replace(/\D/g, "")}`,
          issueNumbers: release.issueNumbers,
        });
        if (release.assetNames !== undefined) {
          await tx.insert(schema.workForgeReleases).values({
            repoId: repo,
            tag: release.name,
            assetNames: release.assetNames,
            link: `https://github.com/${release.repo}/releases/tag/${release.name}`,
          });
        }
        if (release.record !== undefined) {
          await tx.insert(schema.workReleaseRecords).values({
            repoId: repo,
            tag: release.name,
            assetName: `record-${release.name}.json`,
            size: 100,
            fetchedAt: now,
            state: "ok",
            fields: release.record,
          });
        }
      }
      for (const [position, review] of (seed.reviews ?? []).entries()) {
        await tx.insert(schema.workReviews).values({
          repoId: idOf(review.repo),
          pullRequestNumber: review.pullRequest,
          position,
          author: review.author,
          state: "COMMENTED",
          commit: "0000000",
          time: now,
        });
      }
    });
  } finally {
    await database.close();
  }
}
