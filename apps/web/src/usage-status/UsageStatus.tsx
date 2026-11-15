import { formatDate, formatNumber, formatTime } from "../format/index.ts";
import { useUsageStatus, type UseUsageStatusOptions } from "./use-usage-status.ts";

export interface UsageStatusProps extends UseUsageStatusOptions {
  /** A time zone name for the shown times. The default is the time zone of the browser. */
  timeZone?: string;
}

/**
 * The shared status of the usage data: "Usage data as of", the refresh progress, a failed refresh
 * and "No usage data yet".
 */
export function UsageStatus({ timeZone, onDataChanged }: UsageStatusProps) {
  const status = useUsageStatus(onDataChanged === undefined ? {} : { onDataChanged });
  const { data } = status;

  if (status.isError && data === undefined) {
    return <p role="status">The usage status cannot be read.</p>;
  }
  if (data === undefined) return null;

  const when =
    data.dataAsOf === null
      ? null
      : `${formatDate(data.dataAsOf, timeZone)}, ${formatTime(data.dataAsOf, timeZone)}`;

  return (
    <div className="usage-status">
      {data.state === "running" ? (
        <p role="status">
          {data.filesRead === null || data.filesTotal === null
            ? "Reading the history"
            : `Reading the history: ${formatNumber(data.filesRead)} of ${formatNumber(data.filesTotal)} files`}
        </p>
      ) : null}
      {data.state === "failed" ? (
        <p role="status" className="note note-warn">
          {["The last usage refresh failed.", data.reason, failedTail(when)]
            .filter((part) => part !== null && part !== "")
            .join(" ")}
        </p>
      ) : null}
      {when === null ? (
        <p>No usage data yet</p>
      ) : (
        <p>
          Usage data as of <time dateTime={data.dataAsOf ?? undefined}>{when}</time>
        </p>
      )}
    </div>
  );
}

function failedTail(when: string | null): string | null {
  return when === null ? null : `The page shows the data as of ${when}.`;
}
