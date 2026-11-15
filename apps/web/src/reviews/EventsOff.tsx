import type { ReviewsResponse } from "@foreman/shared";
import { plural } from "./labels.ts";

type Entry = ReviewsResponse["eventsOff"][number];

function identityText(entry: Entry, factoryLoginSet: boolean): string | null {
  if (!factoryLoginSet) return "Factory identity login not set";
  if (entry.reviewed === null || entry.unreviewed === null) return null;
  return `${plural(entry.reviewed, "factory pull request", "factory pull requests")} reviewed by the Factory identity, ${plural(entry.unreviewed, "factory pull request", "factory pull requests")} with no Factory identity review`;
}

/** The repos with Control events off or with no Control event in 30 days. */
export function EventsOff({
  entries,
  factoryLoginSet,
}: {
  entries: Entry[];
  factoryLoginSet: boolean;
}) {
  if (entries.length === 0) return null;
  return (
    <ul className="plain-list events-off" aria-label="Repos with no Control events">
      {entries.map((entry) => {
        const identity = identityText(entry, factoryLoginSet);
        return (
          <li key={entry.repoId} className="note">
            {entry.reason === "module_off" ? (
              <>
                Control events are off in <span className="mono">{entry.repo}</span>. Its pull
                requests show only in Review time against build time, from the night log and the
                Usage index.
              </>
            ) : (
              <>
                <span className="mono">{entry.repo}</span>: no Control events in 30 days
              </>
            )}
            {identity === null ? null : <>. {identity}</>}
          </li>
        );
      })}
    </ul>
  );
}
