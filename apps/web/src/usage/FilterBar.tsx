import { UsageGrain } from "@foreman/shared";
import { UsageStatus } from "../usage-status/index.ts";
import { METRIC_NAMES } from "./metric.ts";
import {
  METRICS,
  parseRelativeRange,
  relativeRangeValue,
  type Day,
  type Metric,
  type ResolvedRange,
  type UsageUrlState,
} from "./url-state/index.ts";
import { isDay } from "./url-state/index.ts";

const PRESETS = ["7d", "14d", "30d", "90d", "12w", "3m", "12m"];
const UNIT_NAMES = { d: "day", w: "week", m: "month" } as const;

export function rangeName(value: string): string {
  const range = parseRelativeRange(value);
  if (range === null) return value;
  const unit = UNIT_NAMES[range.unit];
  return `last ${String(range.count)} ${unit}${range.count === 1 ? "" : "s"}`;
}

const capital = (text: string): string => `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;

export interface FilterBarProps {
  state: UsageUrlState;
  resolved: ResolvedRange;
  onChange: (patch: Partial<UsageUrlState>) => void;
  onDataChanged: () => void;
}

export function FilterBar({ state, resolved, onChange, onDataChanged }: FilterBarProps) {
  const { range } = state;
  const current = range.kind === "relative" ? relativeRangeValue(range) : "dates";
  const options =
    PRESETS.includes(current) || current === "dates" ? PRESETS : [...PRESETS, current];

  const setDate = (side: "from" | "to", value: Day) => {
    if (!isDay(value)) return;
    // A date that would end the range before it starts moves the other date too.
    const next =
      side === "from" ? { from: value, to: resolved.to } : { from: resolved.from, to: value };
    if (next.from > next.to) next[side === "from" ? "to" : "from"] = value;
    onChange({ range: { kind: "absolute", ...next } });
  };

  return (
    <section className="filter-bar" aria-label="Filters">
      <div className="field">
        <label htmlFor="usage-range">Range</label>
        <select
          id="usage-range"
          value={current}
          onChange={(event) => {
            const next = parseRelativeRange(event.target.value);
            if (next !== null) onChange({ range: next });
          }}
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {capital(rangeName(value))}
            </option>
          ))}
          {current === "dates" ? <option value="dates">Chosen dates</option> : null}
        </select>
      </div>
      <div className="field">
        <label htmlFor="usage-from">From</label>
        <input
          id="usage-from"
          type="date"
          value={resolved.from}
          onChange={(event) => {
            setDate("from", event.target.value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="usage-to">To</label>
        <input
          id="usage-to"
          type="date"
          value={resolved.to}
          onChange={(event) => {
            setDate("to", event.target.value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="usage-grain">Grain</label>
        <select
          id="usage-grain"
          value={state.grain}
          onChange={(event) => {
            const grain = UsageGrain.safeParse(event.target.value);
            if (grain.success) onChange({ grain: grain.data });
          }}
        >
          {UsageGrain.options.map((grain) => (
            <option key={grain} value={grain}>
              {capital(grain)}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="field metric-field">
        <legend>Metric</legend>
        {METRICS.map((metric: Metric) => (
          <label key={metric} className="radio">
            <input
              type="radio"
              name="usage-metric"
              checked={state.metric === metric}
              onChange={() => {
                onChange({ metric });
              }}
            />
            {METRIC_NAMES[metric]}
          </label>
        ))}
      </fieldset>
      <UsageStatus onDataChanged={onDataChanged} />
    </section>
  );
}
