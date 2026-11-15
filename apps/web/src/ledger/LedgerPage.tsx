import type { LedgerResponse, LedgerRow } from "@foreman/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchLedger } from "../api.ts";
import { usePagedList } from "../list/index.ts";
import { useScope } from "../scope/index.ts";
import { UsageStatus } from "../usage-status/index.ts";
import { DayTable, RepoTable, type LedgerListPage } from "./Tables.tsx";
import { lastMonth, minutesText } from "./months.ts";
import { useLedgerUrl } from "./url-state.ts";
import "./ledger.css";

/** The root of the query keys. A new usage refresh loads these again. */
const KEY = ["usage", "ledger"] as const;

function RangeChoice({
  from,
  to,
  thisMonth,
  lastMonthChoice,
  onThisMonth,
  onLastMonth,
  onDates,
}: {
  from: string;
  to: string;
  thisMonth: boolean;
  lastMonthChoice: boolean | null;
  onThisMonth: () => void;
  onLastMonth: () => void;
  onDates: (from: string, to: string) => void;
}) {
  return (
    <div role="group" aria-label="Choose the range" className="ledger-range">
      <button type="button" aria-pressed={thisMonth} onClick={onThisMonth}>
        This month
      </button>
      <button
        type="button"
        aria-pressed={lastMonthChoice === true}
        disabled={lastMonthChoice === null}
        onClick={onLastMonth}
      >
        Last month
      </button>
      <label>
        From
        <input
          type="date"
          value={from}
          onChange={(event) => {
            if (event.target.value !== "") onDates(event.target.value, to);
          }}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={to}
          onChange={(event) => {
            if (event.target.value !== "") onDates(from, event.target.value);
          }}
        />
      </label>
    </div>
  );
}

function Rules({ rules }: { rules: LedgerResponse["rules"] }) {
  return (
    <p>
      {`Each of your messages adds the time since your previous message, when that time is ${minutesText(rules.idleMinutes)} or less. Else it adds ${minutesText(rules.leadInMinutes)}. Days are in ${rules.timeZone}.`}
    </p>
  );
}

export function LedgerPage() {
  const { scope, clientsSettled, unknownClient } = useScope();
  const queryClient = useQueryClient();
  const url = useLedgerUrl();
  const [timeZone, setTimeZone] = useState<string | null>(null);

  const list = usePagedList<LedgerRow, LedgerListPage>({
    queryKey: [...KEY, url.range?.from ?? null, url.range?.to ?? null, scope],
    fetchPage: async (cursor, signal) => {
      const response = await fetchLedger(url.range, scope, cursor, signal);
      return { ...response, items: response.rows };
    },
    // Nothing loads until the scope is known to be a real client.
    enabled: clientsSettled && !unknownClient,
  });
  const ledger = list.firstPage;
  const ledgerZone = ledger?.rules.timeZone;

  // The zone stays known while the page loads another range.
  if (ledgerZone !== undefined && ledgerZone !== timeZone) setTimeZone(ledgerZone);

  if (unknownClient) return null;

  const previous = timeZone === null ? null : lastMonth(new Date(), timeZone);
  const range = url.range ?? ledger?.range ?? { from: "", to: "" };
  const isLastMonth =
    previous === null ? null : url.range?.from === previous.from && url.range.to === previous.to;

  return (
    <div className="ledger-view">
      <h1>Engagement ledger</h1>
      <p className="muted">
        From the times of your own messages. It never counts agents that worked alone.
      </p>
      <p className="muted">
        Evidence for invoices and timesheets in a Solo build. It is an estimate from message times,
        not a record of hours worked.
      </p>
      {ledger === undefined ? null : <Rules rules={ledger.rules} />}
      <RangeChoice
        from={range.from}
        to={range.to}
        thisMonth={url.range === null}
        lastMonthChoice={isLastMonth}
        onThisMonth={() => {
          url.setRange(null);
        }}
        onLastMonth={() => {
          if (previous !== null) url.setRange(previous);
        }}
        onDates={(from, to) => {
          url.setRange({ from, to });
        }}
      />
      {url.invalid ? (
        <p role="alert" className="note note-warn">
          The link has a value that is not valid. The page shows this month.
        </p>
      ) : null}
      <UsageStatus
        onDataChanged={() => {
          void queryClient.invalidateQueries({ queryKey: KEY });
        }}
      />
      {list.isError && ledger === undefined ? (
        <p role="status" className="note note-warn">
          The ledger cannot be read. The API may be stopped: start it with pnpm dev, then reload
          this page.
        </p>
      ) : null}
      {list.isPending && !list.isError ? (
        <p role="status" className="skeleton">
          Reading the ledger.
        </p>
      ) : null}
      {ledger === undefined ? null : (
        <>
          <RepoTable repos={ledger.repos} totals={ledger.totals} empty={ledger.rowCount === 0} />
          <DayTable list={list} totals={ledger.totals} empty={ledger.rowCount === 0} />
          <p className="muted">
            {`Days are in ${ledger.rules.timeZone}, the ledger's time zone, not the browser's.`}
          </p>
        </>
      )}
    </div>
  );
}
