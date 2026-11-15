import type { RuleDriftRepo, RuleDriftResponse } from "@foreman/shared";
import { MISSING, formatDate, formatTime } from "../format/index.ts";
import type { PagedList } from "../list/index.ts";
import { ScopedLink } from "../scope/index.ts";
import { ShowMore } from "./ShowMore.tsx";
import { DIFFERS_NOTE, configText, plural, ruleLabel, ruleSummary } from "./labels.ts";

type DriftList = PagedList<RuleDriftRepo, RuleDriftResponse>;

function RepoBlock({ repo }: { repo: RuleDriftRepo }) {
  const summary = ruleSummary(repo);
  const config = configText(repo);
  return (
    <li className="drift-repo">
      <div className="split-line">
        <span className="mono">{repo.repo}</span>
        <span className="muted">
          {repo.defaultBranch === null ? null : `default branch ${repo.defaultBranch} · `}
          {repo.factoryCoreVersion === null ? null : `factory-core ${repo.factoryCoreVersion} · `}
          {repo.stackPack === null ? null : `${repo.stackPack.name} ${repo.stackPack.version} · `}
          {repo.dataAsOf === null
            ? "no data yet"
            : `data as of ${formatDate(repo.dataAsOf)} ${formatTime(repo.dataAsOf)}`}
        </span>
      </div>
      {repo.connection === "connected" ? null : <p className="muted">{repo.connection}</p>}
      {config === null ? null : <p className="muted">{config}</p>}
      {summary === null ? null : <p>{summary}</p>}
      {repo.stackPackInstalled === false && repo.stackPack !== null ? (
        <p className="muted">
          Stack pack <code>{repo.stackPack.name}</code> is not installed
        </p>
      ) : null}
      {repo.mainBranch !== null && repo.mainBranch !== repo.defaultBranch ? (
        <p className="muted">
          the main branch in the factory config is <code>{repo.mainBranch}</code>, the default
          branch is <code>{repo.defaultBranch ?? MISSING}</code>
        </p>
      ) : null}
      {repo.configState === "ok" && repo.rules.length > 0 ? (
        <ul className="plain-list" aria-label={`Repo rules of ${repo.repo}`}>
          {repo.rules.map((rule) => {
            const label = ruleLabel(rule, repo);
            return (
              <li key={`${rule.kind}:${rule.name}`} className="split-line">
                <span>
                  <span className="mono">{rule.name}</span>
                  {rule.kind === "compliance" ? <span className="marker">compliance</span> : null}
                </span>
                <span>
                  <span className={`pill pill-${label.tone}`}>{label.text}</span>
                  {rule.state === "differs" ? <span className="marker">{DIFFERS_NOTE}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function RuleDrift({ list }: { list: DriftList }) {
  const first = list.firstPage;
  return (
    <section className="card health-section" aria-labelledby="health-drift">
      <div className="section-head">
        <h2 id="health-drift">Rule drift</h2>
        <span className="muted">source: forge · .claude/rules/ at main</span>
      </div>
      {list.isError ? (
        <p role="alert" className="note note-warn">
          The rule drift cannot be read. The API may be stopped: start it with pnpm dev, then reload
          this page.
        </p>
      ) : null}
      {list.isPending && !list.isError ? <p role="status">Reading the Repo rules.</p> : null}
      {first?.state === "not_connected" ? (
        <p className="note">
          Not connected. Add the Foreman token to the Keychain, then run <code>pnpm local:up</code>.
        </p>
      ) : null}
      {first?.state === "ok" && first.complete.incompleteRepos > 0 ? (
        <p className="note note-warn">
          Data is not complete: {plural(first.complete.incompleteRepos, "repo", "repos")} not
          connected. See <ScopedLink to="/#dash-repos">Repos</ScopedLink>.
        </p>
      ) : null}
      {first !== undefined && first.skipped.templates > 0 ? (
        <p className="muted">
          {plural(first.skipped.templates, "template file", "template files")} skipped: too large.
        </p>
      ) : null}
      {first?.state === "ok" && list.rows.length === 0 ? (
        <p className="muted">No repo in this scope.</p>
      ) : null}
      {list.rows.length === 0 ? null : (
        <ul className="plain-list drift-list" aria-label="Repos">
          {list.rows.map((repo) => (
            <RepoBlock key={repo.repoId} repo={repo} />
          ))}
        </ul>
      )}
      <ShowMore list={list} name="repos" />
    </section>
  );
}
