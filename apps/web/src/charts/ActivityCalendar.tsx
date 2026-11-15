import "./charts.css";

export interface CalendarDay {
  /** The day as `YYYY-MM-DD`. */
  day: string;
  /** The text of the day for a screen reader, for example "13 Nov 2026: 1.2M tokens". */
  name: string;
  value: number;
}

export interface ActivityCalendarProps {
  /** The days in order, from a Monday to today. */
  days: readonly CalendarDay[];
  /** The caption of the grid, for example "Tokens by day, last 26 weeks". */
  title: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const LEVEL_NAMES = ["no usage", "up to 25%", "up to 50%", "up to 75%", "more"] as const;

/** The level of a day: 0 for no usage, else 1 to 4 by the share of the largest day. */
export function activityLevel(value: number, largest: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || largest <= 0) return 0;
  const share = value / largest;
  if (share <= 0.25) return 1;
  if (share <= 0.5) return 2;
  if (share <= 0.75) return 3;
  return 4;
}

/** The month label over a week that holds the first days of a month: "Nov". */
function monthLabel(weekStart: string): string | null {
  const dayOfMonth = Number(weekStart.slice(8, 10));
  if (dayOfMonth > 7) return null;
  return MONTHS[Number(weekStart.slice(5, 7)) - 1] ?? null;
}

/**
 * A grid of days: one column for each week, from Monday to Sunday. Each cell has a level of colour
 * and an accessible name with its date and value. The grid has a legend with the levels.
 */
export function ActivityCalendar({ days, title }: ActivityCalendarProps) {
  const largest = days.reduce((max, entry) => Math.max(max, entry.value), 0);
  const weeks: (CalendarDay | undefined)[][] = [];
  days.forEach((entry, index) => {
    const week = Math.floor(index / 7);
    (weeks[week] ??= [])[index % 7] = entry;
  });
  return (
    <div className="activity-calendar">
      <table>
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            <td />
            {weeks.map((week) => {
              const start = week[0]?.day ?? "";
              const month = monthLabel(start);
              return (
                <th key={start} scope="col" className="calendar-week">
                  <span className="sr-only">{`Week of ${start}`}</span>
                  {month === null ? null : <span aria-hidden="true">{month}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((weekday, row) => (
            <tr key={weekday}>
              <th scope="row" className="calendar-weekday">
                <span className={row % 2 === 0 ? undefined : "sr-only"}>{weekday}</span>
              </th>
              {weeks.map((week, column) => {
                const entry = week[row];
                return (
                  <td key={column}>
                    {entry === undefined ? null : (
                      <span
                        role="img"
                        aria-label={entry.name}
                        className={`calendar-cell level-${String(activityLevel(entry.value, largest))}`}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="calendar-legend">
        {LEVEL_NAMES.map((name, level) => (
          <li key={name}>
            <span className={`calendar-cell level-${String(level)}`} aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
