import type {
  ControlsReleaseRow,
  ControlsReleasesResponse,
  ControlsResponse,
} from "@foreman/shared";
import { ShowMoreList, type PagedList } from "../list/index.ts";
import { ExternalLink } from "./ExternalLink.tsx";
import { Notes } from "./Notes.tsx";
import { Pill } from "./Pill.tsx";
import {
  approvalLabel,
  gapsText,
  gateTone,
  noRecordText,
  plural,
  releaseKey,
  tierTone,
} from "./labels.ts";

function ReleasePull({ row }: { row: ControlsReleaseRow }) {
  const pull = row.releasePull;
  if (pull === null) {
    return row.state === "open" ? <div className="muted">no release pull request</div> : null;
  }
  return (
    <div className="muted">
      release pull request{" "}
      <ExternalLink
        href={pull.link}
        shown={`#${pull.number.toString()}`}
        name={`Release pull request ${pull.number.toString()} of ${row.repo} in the forge`}
      />
      {` · checks ${pull.checks} · release review `}
      {pull.review === null ? "none" : <Pill tone={gateTone(pull.review)}>{pull.review}</Pill>}
    </div>
  );
}

function Record({ row }: { row: ControlsReleaseRow }) {
  const { record } = row;
  if (record.kind === "none") return <div className="muted">{noRecordText(record.reason)}</div>;
  const approval = approvalLabel(record.approval);
  return (
    <div className="controls-record">
      <span>
        tier{" "}
        {record.tier === null ? "none" : <Pill tone={tierTone(record.tier)}>{record.tier}</Pill>}
      </span>
      <span>
        Release approval <Pill tone={approval.tone}>{approval.text}</Pill>
      </span>
      <span className={record.gaps.total === 0 ? "muted" : undefined}>{gapsText(record.gaps)}</span>
    </div>
  );
}

function ReleaseRow({ row }: { row: ControlsReleaseRow }) {
  return (
    <div className="controls-row">
      <div className="controls-split">
        <span>
          <span className="mono">{row.name}</span> <span className="muted mono">{row.repo}</span>
        </span>
        <Pill tone={row.state === "released" ? "ok" : "info"}>{row.state}</Pill>
      </div>
      <div className="muted">
        {plural(row.issueCount, "issue", "issues")}
        {row.link === null && row.forgeReleaseLink === null ? null : " · "}
        <ExternalLink
          href={row.link}
          shown="tracker Release ↗"
          name={`Release ${row.name} of ${row.repo} in the tracker`}
        />
        {row.link !== null && row.forgeReleaseLink !== null ? " · " : null}
        <ExternalLink
          href={row.forgeReleaseLink}
          shown="forge release ↗"
          name={`Release ${row.name} of ${row.repo} in the forge`}
        />
      </div>
      <ReleasePull row={row} />
      <Record row={row} />
    </div>
  );
}

export function ReleasesSection({
  data,
  list,
}: {
  data: ControlsResponse;
  list: PagedList<ControlsReleaseRow, ControlsReleasesResponse>;
}) {
  return (
    <section className="card controls-section" aria-labelledby="controls-releases">
      <div className="controls-head">
        <h2 id="controls-releases">Releases</h2>
        <span className="muted">source: tracker Releases and the Release record on the forge</span>
      </div>
      <Notes data={data} />
      {list.isError ? (
        <p role="alert" className="note note-warn">
          The Releases cannot be read. Reload this page to try again.
        </p>
      ) : list.isPending ? (
        <p role="status">Reading the Releases.</p>
      ) : list.rows.length === 0 ? (
        data.state === "not_connected" ? null : (
          <p className="muted">No Release in this scope.</p>
        )
      ) : (
        <ShowMoreList
          list={list}
          label="Releases"
          rowKey={releaseKey}
          renderRow={(row) => <ReleaseRow row={row} />}
        />
      )}
    </section>
  );
}
