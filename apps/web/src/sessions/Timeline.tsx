import type { SessionResponse, SessionSpan } from "@foreman/shared";
import { formatNumber, formatTime, formatTokens } from "../format/index.ts";
import { ShowMoreList, type PagedList } from "../list/index.ts";
import { ScopedLink } from "../scope/index.ts";
import { buildAxis, percentOf, type Axis } from "./axis.ts";
import {
  agentClass,
  kindLabel,
  messagesFromYou,
  modelsText,
  reposNotConnected,
  safeHref,
  spanLabel,
  workItemRef,
  workItemText,
} from "./labels.ts";

export type SessionPage = SessionResponse & { items: SessionSpan[] };

export interface TimelineProps {
  detail: SessionResponse;
  list: PagedList<SessionSpan, SessionPage>;
  timeZone: string;
}

function barStyle(axis: Axis, span: SessionSpan) {
  const left = percentOf(axis, Date.parse(span.start));
  const right = percentOf(axis, Date.parse(span.end));
  return { left: `${left.toString()}%`, width: `${Math.max(right - left, 0).toString()}%` };
}

function WorkItem({ item }: { item: SessionSpan["workItem"] }) {
  if (item.kind === "none") return null;
  if (item.kind === "several") {
    return <span className="span-item">{item.count.toString()} work items</span>;
  }
  const href = safeHref(item.link);
  return (
    <span className="span-item">
      {href === null ? (
        <span className="mono">{workItemRef(item)}</span>
      ) : (
        <a className="mono" href={href} target="_blank" rel="noreferrer noopener">
          {workItemRef(item)}
        </a>
      )}
      {item.title === null ? null : <span className="muted"> {item.title}</span>}
    </span>
  );
}

function SpanRow({ span, axis, timeZone }: { span: SessionSpan; axis: Axis; timeZone: string }) {
  const tip = `${spanLabel(span)}, ${formatTime(span.start, timeZone)} to ${formatTime(span.end, timeZone)}`;
  return (
    <>
      <div className="span-label">
        <span>
          <strong>{spanLabel(span)}</strong>
          <span className="muted"> · {modelsText(span.models)}</span>
        </span>
        <WorkItem item={span.workItem} />
      </div>
      <div className="span-lane" aria-hidden="true">
        <span
          className={`span-bar ${agentClass(span.agentType)}`}
          style={barStyle(axis, span)}
          title={tip}
        />
      </div>
      <span className="mono span-tokens">{formatTokens(span.tokens)}</span>
    </>
  );
}

function skillText(span: SessionSpan): string {
  if (span.skill === null) return "None";
  return span.skillBasis === "estimate" ? `${span.skill} (estimate)` : span.skill;
}

function CompleteNote({ complete }: { complete: SessionResponse["complete"] }) {
  if (complete.notConnected) {
    return (
      <p role="status" className="note note-warn">
        Not connected. Add the Foreman token to FOREMAN_TOKENS_JSON in the .env file, then restart
        pnpm dev.
      </p>
    );
  }
  if (complete.incompleteRepos > 0) {
    return (
      <p role="status" className="note note-warn">
        Data is not complete: {reposNotConnected(complete.incompleteRepos)}. See{" "}
        <ScopedLink to="/#dash-repos">Repos</ScopedLink>.
      </p>
    );
  }
  return null;
}

/** The Session timeline: HTML and CSS on a time axis, with a table for screen readers. */
export function Timeline({ detail, list, timeZone }: TimelineProps) {
  const { session } = detail;
  const axis = buildAxis(detail.window.start, detail.window.end, timeZone);
  const agentTypes = [...new Set(list.rows.map((span) => span.agentType))];

  return (
    <section className="card" aria-labelledby="timeline-heading">
      <div className="timeline-head">
        <h2 id="timeline-heading">
          {session.name ?? "No skill"} · {formatTime(session.start, timeZone)} to{" "}
          {formatTime(session.end, timeZone)}
        </h2>
        <span className="muted">{kindLabel(session.kind)}</span>
      </div>
      <p className="note">
        Metadata only. Foreman shows no prompt, reply, tool input or tool output. Skill attribution
        for main-conversation turns is an estimate.
      </p>
      <CompleteNote complete={detail.complete} />
      <div className="span-timeline">
        <div className="span-row span-head" aria-hidden="true">
          <span className="muted">Agent · model · work item</span>
          <div className="span-axis">
            {axis.ticks.map((tick) => (
              <span key={tick} style={{ left: `${percentOf(axis, tick).toString()}%` }}>
                {formatTime(new Date(tick).toISOString(), timeZone)}
              </span>
            ))}
          </div>
          <span className="muted span-tokens">Tokens</span>
        </div>
        <div className="span-row">
          <div className="span-label">
            <strong>You</strong>
            <span className="muted">{messagesFromYou(detail.userMessageTotal)}</span>
          </div>
          <div className="span-lane" aria-hidden="true">
            {detail.userMessages.map((time, index) => (
              <span
                // The times can repeat, so the index is part of the key.
                key={`${time}-${index.toString()}`}
                className="you-mark"
                style={{ left: `${percentOf(axis, Date.parse(time)).toString()}%` }}
              />
            ))}
          </div>
          <span />
        </div>
        <div className="span-rows">
          <ShowMoreList
            list={list}
            label="Spans of the session"
            rowKey={(span) => span.key}
            moreLabel="Show more spans"
            renderRow={(span) => <SpanRow span={span} axis={axis} timeZone={timeZone} />}
          />
        </div>
      </div>
      <ul className="legend" aria-label="Agent types">
        {agentTypes.map((agentType) => (
          <li key={agentType}>
            <span className={`swatch ${agentClass(agentType)}`} aria-hidden="true" />
            {agentType}
          </li>
        ))}
      </ul>
      <div className="sr-only">
        <table>
          <caption>
            Spans of the session, {formatNumber(list.rows.length)} of{" "}
            {formatNumber(detail.spanTotal)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Agent type</th>
              <th scope="col">Skill</th>
              <th scope="col">Start</th>
              <th scope="col">End</th>
              <th scope="col">Models</th>
              <th scope="col">Work item</th>
              <th scope="col">Turns</th>
              <th scope="col">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((span) => (
              <tr key={span.key}>
                <th scope="row">{span.agentType}</th>
                <td>{skillText(span)}</td>
                <td>{formatTime(span.start, timeZone)}</td>
                <td>{formatTime(span.end, timeZone)}</td>
                <td>{modelsText(span.models)}</td>
                <td>{workItemText(span.workItem)}</td>
                <td>{formatNumber(span.turns)}</td>
                <td>{formatNumber(span.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
