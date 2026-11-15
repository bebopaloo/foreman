import type { ControlsResponse } from "@foreman/shared";
import { Notes } from "./Notes.tsx";
import { Pill } from "./Pill.tsx";
import {
  CONTROL_EVENTS_NOTE,
  FORGE_ONLY_NOTE,
  branchNote,
  configProblem,
  formatDay,
  plural,
} from "./labels.ts";

type Row = ControlsResponse["modules"][number];

function ModulesCell({ row }: { row: Row }) {
  if (row.modules.length === 0) return <>none</>;
  return (
    <>
      {plural(row.modules.length, "module", "modules")}
      <span className="muted mono controls-names"> {row.modules.join(", ")}</span>
    </>
  );
}

function ModuleRow({ row }: { row: Row }) {
  const problem = configProblem(row);
  const branch = branchNote(row);
  return (
    <tr>
      <th scope="row" className="mono">
        {row.repo}
      </th>
      {problem === null ? (
        <>
          <td>{row.profile}</td>
          <td>
            <ModulesCell row={row} />
          </td>
          <td>
            <Pill tone={row.controlEvents ? "ok" : "plain"}>
              {row.controlEvents ? "Control events on" : "Control events off"}
            </Pill>
          </td>
          <td className="muted">
            {row.controlEvents ? CONTROL_EVENTS_NOTE : FORGE_ONLY_NOTE}
            {branch === null ? null : <span className="controls-sub">{branch}</span>}
            {row.switchedOver === null ? null : (
              <span className="controls-sub">
                Releases since {formatDay(row.switchedOver)}
                {row.productionBranch === null ? "" : `, production branch ${row.productionBranch}`}
              </span>
            )}
          </td>
        </>
      ) : (
        <td colSpan={4}>
          <Pill tone="warn">{problem}</Pill>
        </td>
      )}
    </tr>
  );
}

export function ModulesSection({ data }: { data: ControlsResponse }) {
  return (
    <section className="card controls-section" aria-labelledby="controls-modules">
      <div className="controls-head">
        <h2 id="controls-modules">Control modules by repo</h2>
        <span className="muted">source: forge, .claude/factory.json at the main branch</span>
      </div>
      <Notes data={data} />
      {data.state === "not_connected" ? null : data.modules.length === 0 ? (
        <p className="muted">No repo in this scope.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Control modules table" tabIndex={0}>
          <table className="controls-table">
            <caption className="sr-only">Control modules by repo</caption>
            <thead>
              <tr>
                <th scope="col">Repo</th>
                <th scope="col">Control profile</th>
                <th scope="col">Modules on</th>
                <th scope="col">Control events</th>
                <th scope="col">Review data in Foreman</th>
              </tr>
            </thead>
            <tbody>
              {data.modules.map((row) => (
                <ModuleRow key={row.repoId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
