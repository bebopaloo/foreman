import { SessionId, type SessionSpan, type SessionSummary } from "@foreman/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ApiStatusError, fetchSession, fetchSessions } from "../api.ts";
import { browserTimeZone, formatDay } from "../format/index.ts";
import { usePagedList } from "../list/index.ts";
import { useScope } from "../scope/index.ts";
import { UsageStatus } from "../usage-status/index.ts";
import { dayIn, isCalendarDay, shiftDay } from "./day.ts";
import { SessionList } from "./SessionList.tsx";
import { Timeline, type SessionPage } from "./Timeline.tsx";
import { useSessionsUrl } from "./url-state.ts";
import "./sessions.css";

/** The page asks again each 60 seconds while it shows today and the tab is visible. */
export const SESSIONS_REFRESH_MS = 60_000;

/** The root of the query keys. A Refresh in the header and a new usage refresh load these again. */
const KEY = ["usage", "sessions"] as const;

/** A request with a status below 500 is final: another try gives the same answer. */
function retryServerErrors(failureCount: number, error: Error): boolean {
  if (error instanceof ApiStatusError && error.status < 500) return false;
  return failureCount < 3;
}

interface Context {
  day: string;
  timeZone: string;
  client: string | null;
  refetchInterval: number | false;
}

function SessionDetail({ sessionId, context }: { sessionId: string; context: Context }) {
  const { day, timeZone, client, refetchInterval } = context;
  const query = { day, tz: timeZone, client };
  const list = usePagedList<SessionSpan, SessionPage>({
    queryKey: [...KEY, "session", sessionId, day, timeZone, client],
    fetchPage: async (cursor, signal) => {
      const response = await fetchSession(sessionId, query, cursor, signal);
      return { ...response, items: response.spans };
    },
    refetchInterval,
    retry: retryServerErrors,
  });
  const detail = list.firstPage;

  if (list.error instanceof ApiStatusError && list.error.status === 404) {
    return <NoSuchSession sessionId={sessionId} />;
  }
  if (list.isError && detail === undefined) {
    return (
      <p role="alert" className="note note-warn">
        The session cannot be read. The API may be stopped: start it with pnpm dev, then reload this
        page.
      </p>
    );
  }
  if (detail === undefined) return <p role="status">Reading the session.</p>;
  return <Timeline detail={detail} list={list} timeZone={timeZone} />;
}

function NoSuchSession({ sessionId }: { sessionId: string }) {
  return (
    <p role="status" className="note">
      No session {sessionId} on this day in this scope.
    </p>
  );
}

export function SessionsPage() {
  const { scope, clientsSettled, unknownClient } = useScope();
  const queryClient = useQueryClient();
  const url = useSessionsUrl();
  const timeZone = browserTimeZone();
  const today = dayIn(new Date(), timeZone);
  const day = url.day ?? today;
  const validDay = isCalendarDay(day);
  const isToday = validDay && day === today;
  const refetchInterval = isToday ? SESSIONS_REFRESH_MS : false;

  const list = usePagedList<SessionSummary>({
    queryKey: [...KEY, "list", day, timeZone, scope],
    fetchPage: async (cursor, signal) => {
      const response = await fetchSessions({ day, tz: timeZone, client: scope }, cursor, signal);
      return { items: response.sessions, nextCursor: response.nextCursor };
    },
    refetchInterval,
    // Nothing loads until the scope is known to be a real client.
    enabled: validDay && clientsSettled && !unknownClient,
  });

  if (unknownClient) return null;

  const requested = url.session;
  const requestedValid = requested !== null && SessionId.safeParse(requested).success;
  const selected = requested ?? list.rows[0]?.id ?? null;
  const heading = isToday ? "Sessions today" : `Sessions on ${formatDay(day)}`;

  return (
    <>
      <div className="day-choice">
        <h1>{validDay ? heading : "Sessions"}</h1>
        <div role="group" aria-label="Choose the day" className="day-controls">
          <button
            type="button"
            onClick={() => {
              url.navigate({ day: shiftDay(day, -1), session: null });
            }}
            disabled={!validDay}
          >
            Previous day
          </button>
          <label>
            <span className="sr-only">Day</span>
            <input
              type="date"
              value={validDay ? day : ""}
              max={today}
              onChange={(event) => {
                if (isCalendarDay(event.target.value)) {
                  url.navigate({ day: event.target.value, session: null });
                }
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              url.navigate({ day: shiftDay(day, 1), session: null });
            }}
            disabled={!validDay || day >= today}
          >
            Next day
          </button>
        </div>
      </div>
      <p className="muted">Times in {timeZone}</p>
      <UsageStatus
        timeZone={timeZone}
        onDataChanged={() => {
          void queryClient.invalidateQueries({ queryKey: KEY });
        }}
      />
      {!validDay ? (
        <p role="alert" className="note note-warn">
          Not a valid day.
        </p>
      ) : (
        <div className="sessions-layout">
          <section className="card sessions-list-card" aria-labelledby="session-list-heading">
            <h2 id="session-list-heading">Sessions</h2>
            {list.isError ? (
              <p role="alert" className="note note-warn">
                The sessions cannot be read. The API may be stopped: start it with pnpm dev, then
                reload this page.
              </p>
            ) : null}
            {list.isPending && !list.isError ? <p role="status">Reading the sessions.</p> : null}
            {!list.isPending && !list.isError && list.rows.length === 0 ? (
              <p>No sessions on this day in this scope.</p>
            ) : null}
            <SessionList
              list={list}
              selected={selected}
              day={day}
              scope={scope}
              timeZone={timeZone}
              onSelect={(id) => {
                url.navigate({ session: id });
              }}
            />
          </section>
          <div className="sessions-detail">
            {requested !== null && !requestedValid ? (
              <NoSuchSession sessionId={requested} />
            ) : selected === null ? null : (
              <SessionDetail
                key={`${selected}|${day}|${scope ?? ""}`}
                sessionId={selected}
                context={{ day, timeZone, client: scope, refetchInterval }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
