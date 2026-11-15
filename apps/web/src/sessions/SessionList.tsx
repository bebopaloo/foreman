import type { SessionSummary } from "@foreman/shared";
import { formatTime, formatTokens } from "../format/index.ts";
import { ShowMoreList, type PagedList } from "../list/index.ts";
import { withScope, type Scope } from "../scope/index.ts";
import { kindLabel, messagesFromYou } from "./labels.ts";

export interface SessionListProps {
  list: PagedList<SessionSummary>;
  /** The selected session ID, or null. */
  selected: string | null;
  day: string;
  scope: Scope;
  timeZone: string;
  onSelect: (sessionId: string) => void;
}

/** Every link inside the view keeps the day, the session and the Client scope. */
function sessionHref(day: string, id: string, scope: Scope): string {
  return withScope(`/sessions?${new URLSearchParams({ day, session: id }).toString()}`, scope);
}

function moreProjects(session: SessionSummary): string {
  const more = session.projectCount - Math.min(session.projects.length, 1);
  return more > 0 ? ` +${more.toString()}` : "";
}

export function SessionList({ list, selected, day, scope, timeZone, onSelect }: SessionListProps) {
  return (
    <div className="session-list">
      <ShowMoreList
        list={list}
        label="Sessions of the day"
        rowKey={(session) => session.id}
        moreLabel="Show more sessions"
        renderRow={(session) => (
          <a
            href={sessionHref(day, session.id, scope)}
            aria-current={session.id === selected ? "true" : undefined}
            onClick={(event) => {
              if (event.defaultPrevented || event.button !== 0) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onSelect(session.id);
            }}
          >
            <strong>
              {session.name ?? "No skill"}{" "}
              <span className="mono muted">{session.id.slice(0, 8)}</span>
            </strong>
            <span>
              {kindLabel(session.kind)} · {formatTime(session.start, timeZone)} to{" "}
              {formatTime(session.end, timeZone)}
            </span>
            <span className="mono">
              {session.projects[0]?.label ?? "No project"}
              {moreProjects(session)} · {formatTokens(session.tokens)} tokens
            </span>
            <span>{messagesFromYou(session.userMessages)}</span>
            {session.continuesBefore ? (
              <span className="muted">continues from the day before</span>
            ) : null}
            {session.continuesAfter ? (
              <span className="muted">continues on the next day</span>
            ) : null}
          </a>
        )}
      />
    </div>
  );
}
