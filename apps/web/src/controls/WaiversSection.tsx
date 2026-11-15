import type { ControlsResponse, ControlsWaiverRow, ControlsWaiversResponse } from "@foreman/shared";
import { ShowMoreList, type PagedList } from "../list/index.ts";
import { ExternalLink } from "./ExternalLink.tsx";
import { Notes } from "./Notes.tsx";
import { Pill } from "./Pill.tsx";
import {
  MISSING,
  coversText,
  expiryLabel,
  formatDay,
  formatNumber,
  skippedText,
} from "./labels.ts";

function RegisterProblems({ data }: { data: ControlsResponse }) {
  const lines: string[] = [];
  for (const row of data.artefacts) {
    const register = row.waiverRegister;
    if (register.state === "not_readable") lines.push(`${row.repo}: Waiver register not readable`);
    else if (register.state === "failed") lines.push(`${row.repo}: Waiver register adapter error`);
    else if (register.skipped.length > 0) {
      lines.push(`${row.repo}: ${skippedText(register.skipped, "Waiver")}`);
    }
  }
  if (lines.length === 0) return null;
  return (
    <ul className="controls-plain" aria-label="Waiver registers with a problem">
      {lines.map((line) => (
        <li key={line} className="note note-warn">
          {line}
        </li>
      ))}
    </ul>
  );
}

function WaiverRow({ row }: { row: ControlsWaiverRow }) {
  const expiry = expiryLabel(row);
  return (
    <div className="controls-row">
      <div className="controls-split">
        <span>
          <span className="mono">{row.id}</span> <span className="muted mono">{row.repo}</span>
        </span>
        <Pill tone={expiry.tone}>{expiry.text}</Pill>
      </div>
      <div>{coversText(row.covers)}</div>
      <div className="muted">
        owner {row.owner ?? MISSING}
        {row.approvedBy === null ? "" : ` · approved by ${row.approvedBy}`}
        {row.expires === null ? "" : ` · expires ${formatDay(row.expires)}`}
      </div>
      <div className="muted">
        used {formatNumber(row.uses)} {row.uses === 1 ? "time" : "times"} in 30 days
        {row.newestPull === null ? null : (
          <>
            {" · latest "}
            <ExternalLink
              href={row.newestPull.link}
              shown={`#${row.newestPull.number.toString()}`}
              name={`Pull request ${row.newestPull.number.toString()} of ${row.repo} in the forge`}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function WaiversSection({
  data,
  list,
}: {
  data: ControlsResponse;
  list: PagedList<ControlsWaiverRow, ControlsWaiversResponse>;
}) {
  return (
    <section className="card controls-section" aria-labelledby="controls-waivers">
      <div className="controls-head">
        <h2 id="controls-waivers">Waivers</h2>
        <span className="muted">source: forge, waivers.toml, and waiver_used events</span>
      </div>
      <Notes data={data} />
      <RegisterProblems data={data} />
      {list.isError ? (
        <p role="alert" className="note note-warn">
          The Waivers cannot be read. Reload this page to try again.
        </p>
      ) : list.isPending ? (
        <p role="status">Reading the Waivers.</p>
      ) : list.rows.length === 0 ? (
        <p className="muted">No Waivers in this scope.</p>
      ) : (
        <ShowMoreList
          list={list}
          label="Waivers"
          rowKey={(row) => `${row.repoId}:${row.id}`}
          renderRow={(row) => <WaiverRow row={row} />}
        />
      )}
    </section>
  );
}
