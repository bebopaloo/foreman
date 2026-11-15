import type { LedgerRepo, LedgerResponse, LedgerRow } from "@foreman/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDay, formatDuration, formatNumber, formatTokens } from "../format/index.ts";
import type { PagedList } from "../list/index.ts";

const EMPTY = "No messages and no usage in this range in this scope.";

const minutesText = (minutes: number): string => formatDuration(minutes * 60);

function TableBox({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={`${name} table`} tabIndex={0}>
      {children}
    </div>
  );
}

function Head({ names }: { names: readonly string[] }) {
  return (
    <thead>
      <tr>
        {names.map((name, index) => (
          <th key={name} scope="col" className={index === 0 ? undefined : numericIf(name)}>
            {name}
          </th>
        ))}
      </tr>
    </thead>
  );
}

const NUMERIC = new Set(["Interactive time", "Days", "Messages", "Sessions", "Tokens"]);
const numericIf = (name: string): string | undefined => (NUMERIC.has(name) ? "num" : undefined);

export function RepoTable({
  repos,
  totals,
  empty,
}: {
  repos: LedgerResponse["repos"];
  totals: LedgerResponse["totals"];
  empty: boolean;
}) {
  return (
    <section className="card ledger-section" aria-labelledby="ledger-repos-heading">
      <h2 id="ledger-repos-heading">By client repo</h2>
      {empty ? (
        <p>{EMPTY}</p>
      ) : (
        <TableBox name="By client repo">
          <table className="ledger-table">
            <caption className="sr-only">By client repo</caption>
            <Head
              names={["Client repo", "Client", "Interactive time", "Days", "Sessions", "Tokens"]}
            />
            <tbody>
              {repos.lines.map((line: LedgerRepo) => (
                <tr key={line.projectId}>
                  <th scope="row" className="mono">
                    {line.label}
                  </th>
                  <td>{line.client ?? "Unassigned"}</td>
                  <td className="num">{minutesText(line.interactiveMinutes)}</td>
                  <td className="num">{formatNumber(line.days)}</td>
                  <td className="num">{formatNumber(line.sessions)}</td>
                  <td className="num">{formatTokens(line.tokens)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td />
                <td className="num">{minutesText(totals.interactiveMinutes)}</td>
                <td />
                <td className="num">{formatNumber(totals.sessions)}</td>
                <td className="num">{formatTokens(totals.tokens)}</td>
              </tr>
            </tfoot>
          </table>
        </TableBox>
      )}
      {!empty && repos.cut > 0 ? (
        <p className="muted">{`${formatNumber(repos.cut)} more client repos are not shown.`}</p>
      ) : null}
    </section>
  );
}

/** A page of the ledger, with its rows also under `items` for the paged list. */
export type LedgerListPage = LedgerResponse & { items: LedgerRow[] };

type LedgerList = PagedList<LedgerRow, LedgerListPage>;

export function DayTable({
  list,
  totals,
  empty,
}: {
  list: LedgerList;
  totals: LedgerResponse["totals"];
  empty: boolean;
}) {
  const [announcement, setAnnouncement] = useState("");
  const [failed, setFailed] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const focusIndex = useRef<number | null>(null);
  const rowElements = useRef<Map<number, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (focusIndex.current === null) return;
    const row = rowElements.current.get(focusIndex.current);
    if (row) {
      row.focus();
      focusIndex.current = null;
    }
  }, [focusTick, list.rows.length]);

  async function onShowMore() {
    const before = list.rows.length;
    setFailed(false);
    const added = await list.showMore();
    if (added === 0) {
      setFailed(true);
      return;
    }
    setAnnouncement(`${added.toString()} more rows shown`);
    focusIndex.current = before;
    setFocusTick((tick) => tick + 1);
  }

  return (
    <section className="card ledger-section" aria-labelledby="ledger-days-heading">
      <h2 id="ledger-days-heading">By day</h2>
      {empty ? (
        <p>{EMPTY}</p>
      ) : (
        <>
          <TableBox name="By day">
            <table className="ledger-table">
              <caption className="sr-only">By day</caption>
              <Head
                names={["Day", "Client repo", "Interactive time", "Messages", "Sessions", "Tokens"]}
              />
              <tbody>
                {list.rows.map((row, index) => (
                  <tr
                    key={`${row.day}|${row.projectId}`}
                    tabIndex={-1}
                    ref={(element) => {
                      if (element) rowElements.current.set(index, element);
                      else rowElements.current.delete(index);
                    }}
                  >
                    <th scope="row">{formatDay(row.day)}</th>
                    <td className="mono">{row.label}</td>
                    <td className="num">{minutesText(row.interactiveMinutes)}</td>
                    <td className="num">{formatNumber(row.messages)}</td>
                    <td className="num">{formatNumber(row.sessions)}</td>
                    <td className="num">{formatTokens(row.tokens)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td />
                  <td className="num">{minutesText(totals.interactiveMinutes)}</td>
                  <td className="num">{formatNumber(totals.messages)}</td>
                  <td className="num">{formatNumber(totals.sessions)}</td>
                  <td className="num">{formatTokens(totals.tokens)}</td>
                </tr>
              </tfoot>
            </table>
          </TableBox>
          {list.hasMore ? (
            <button type="button" onClick={() => void onShowMore()} disabled={list.isLoadingMore}>
              Show more
            </button>
          ) : null}
          {failed ? (
            <p role="alert">The next rows did not load. Select Show more to try again.</p>
          ) : null}
          <p role="status" className="sr-only">
            {announcement}
          </p>
        </>
      )}
    </section>
  );
}
