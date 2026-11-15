import type {
  ControlsArtefactRow,
  ControlsRegisterResponse,
  ControlsRegisterRow,
  ControlsResponse,
} from "@foreman/shared";
import { ShowMoreList, type PagedList } from "../list/index.ts";
import { Notes } from "./Notes.tsx";
import { Pill } from "./Pill.tsx";
import {
  artefactName,
  fileProblem,
  formatNumber,
  formatTime,
  plural,
  skippedText,
  type ArtefactKey,
} from "./labels.ts";

type Row = ControlsArtefactRow;

function riskMapText(summary: NonNullable<Row["riskMap"]["summary"]>): string {
  const { authority, sensitive, general, inert, boundaries } = summary;
  return `authority ${formatNumber(authority)}, sensitive ${formatNumber(sensitive)}, general ${formatNumber(general)}, inert ${formatNumber(inert)} globs; ${plural(boundaries, "boundary", "boundaries")}`;
}

function threatModelText(summary: NonNullable<Row["threatModel"]["summary"]>): string {
  const parts = [
    plural(summary.boundaries, "boundary", "boundaries"),
    plural(summary.threats, "threat", "threats"),
  ];
  if (summary.withoutControl.length > 0) {
    parts.push(
      `${formatNumber(summary.withoutControl.length)} with no Control (${summary.withoutControl.join(", ")})`,
    );
  }
  const cited = summary.citedNotInRegister ?? [];
  if (cited.length > 0) {
    parts.push(
      `${formatNumber(cited.length)} cited Control not in the register (${cited.join(", ")})`,
    );
  }
  return parts.join(", ");
}

function summaryText(row: Row, key: ArtefactKey): string | null {
  switch (key) {
    case "riskMap":
      return row.riskMap.summary === null ? null : riskMapText(row.riskMap.summary);
    case "controlRegister":
      return row.controlRegister.summary === null
        ? null
        : plural(row.controlRegister.summary.controls, "Control", "Controls");
    case "threatModel":
      return row.threatModel.summary === null ? null : threatModelText(row.threatModel.summary);
    case "waiverRegister":
      return null;
  }
}

const KEYS = ["riskMap", "controlRegister", "threatModel"] as const;

function Artefact({ row, name, branch }: { row: Row; name: ArtefactKey; branch: string }) {
  const file = row[name];
  const problem = fileProblem(name, file.state, file.ref ?? branch);
  const summary = summaryText(row, name);
  return (
    <li>
      <strong>{artefactName(name)}</strong>:{" "}
      {problem === null ? (
        (summary ?? "no data")
      ) : file.state === "module_off" ? (
        <span className="muted">module off</span>
      ) : (
        <Pill tone={file.state === "not_read" ? "plain" : "warn"}>{problem}</Pill>
      )}
      {file.sha7 === null ? null : (
        <span className="muted">
          {" "}
          · <span className="mono">{file.sha7}</span> · data as of {formatTime(file.fetchedAt)}
        </span>
      )}
      {file.skipped.length > 0 ? (
        <span className="controls-sub muted">
          {skippedText(file.skipped, name === "controlRegister" ? "Control" : "entry")}
        </span>
      ) : null}
    </li>
  );
}

function RegisterRow({ row }: { row: ControlsRegisterRow }) {
  return (
    <div className="controls-row">
      <div className="controls-split">
        <span>
          <span className="mono">{row.id}</span> <span className="muted mono">{row.repo}</span>
        </span>
        {row.status === null ? (
          <span className="muted">not in a Release record</span>
        ) : (
          <Pill
            tone={
              row.status.status === "passing"
                ? "ok"
                : row.status.status === "failing"
                  ? "danger"
                  : row.status.status === "untested"
                    ? "warn"
                    : "plain"
            }
          >
            {`${row.status.status} in ${row.status.tag}`}
          </Pill>
        )}
      </div>
      <div>{row.title}</div>
      <div className="muted">
        owner {row.owner} · {plural(row.sources, "source", "sources")} ·{" "}
        {plural(row.modules, "module", "modules")} ·{" "}
        {plural(row.manualChecks, "manual check", "manual checks")}
      </div>
    </div>
  );
}

export function ArtefactsSection({
  data,
  list,
}: {
  data: ControlsResponse;
  list: PagedList<ControlsRegisterRow, ControlsRegisterResponse>;
}) {
  const branches = new Map(
    data.modules.map((row) => [row.repoId, row.fileBranch ?? row.defaultBranch ?? "main"]),
  );
  return (
    <section className="card controls-section" aria-labelledby="controls-artefacts">
      <div className="controls-head">
        <h2 id="controls-artefacts">Security artefacts</h2>
        <span className="muted">source: forge, the files of the Control modules</span>
      </div>
      <Notes data={data} />
      {data.state === "not_connected" ? null : data.artefacts.length === 0 ? (
        <p className="muted">No repo in this scope.</p>
      ) : (
        <ul className="controls-plain" aria-label="Security artefacts by repo">
          {data.artefacts.map((row) => (
            <li key={row.repoId} className="controls-artefact">
              <h3 className="mono">{row.repo}</h3>
              <ul className="controls-plain">
                {KEYS.map((key) => (
                  <Artefact
                    key={key}
                    row={row}
                    name={key}
                    branch={branches.get(row.repoId) ?? "main"}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <h3>Control register</h3>
      {list.isError ? (
        <p role="alert" className="note note-warn">
          The Control register cannot be read. Reload this page to try again.
        </p>
      ) : list.isPending ? (
        <p role="status">Reading the Control register.</p>
      ) : list.rows.length === 0 ? (
        <p className="muted">No Control in this scope.</p>
      ) : (
        <ShowMoreList
          list={list}
          label="Control register"
          rowKey={(row) => `${row.repoId}:${row.id}`}
          renderRow={(row) => <RegisterRow row={row} />}
        />
      )}
    </section>
  );
}
