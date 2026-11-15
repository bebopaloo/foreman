import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  LIMIT_COLORS,
  LIMIT_HIGH,
  LIMIT_WARN,
  LIMIT_WORDS,
  limitBand,
  limitWord,
} from "../thresholds/index.ts";
import "./charts.css";

export interface LimitPoint {
  /** The text of the bar on the axis, for example "13 Nov". */
  label: string;
  /** The text of the bar in the table, for example "Thu 12 Nov, 09:00". */
  description: string;
  /** The peak used percentage. For the window in progress, the peak so far. */
  value: number;
  inProgress: boolean;
}

export interface LimitChartProps {
  /** The title of the chart and the caption of its table, for example "5-hour windows". */
  title: string;
  data: readonly LimitPoint[];
  height?: number;
  /** A fixed width in pixels. The default follows the width of the container. */
  width?: number;
}

const percent = (value: number): string => `${String(Math.round(value))}%`;

/**
 * One bar for each Limit window, with lines at 70% and 90%. Each bar has a colour and a state word:
 * the legend names the words, and the table of the same values gives the word of each bar.
 */
export function LimitChart({ title, data, height = 220, width }: LimitChartProps) {
  const points = data.map((point) => ({ ...point }));
  return (
    <figure className="bar-chart limit-chart" style={{ margin: 0 }}>
      <figcaption className="chart-title">{title}</figcaption>
      <div aria-hidden="true" data-testid="limit-chart-graphic">
        <RechartsBarChart
          data={points}
          width={width ?? "100%"}
          height={height}
          responsive={width === undefined}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="label"
            interval="preserveStartEnd"
            stroke="var(--line)"
            tick={{ fill: "var(--muted)" }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 50, LIMIT_WARN, LIMIT_HIGH, 100]}
            tickFormatter={percent}
            width={48}
            stroke="var(--line)"
            tick={{ fill: "var(--muted)" }}
          />
          <ReferenceLine y={LIMIT_WARN} stroke="var(--warn)" strokeDasharray="4 3" />
          <ReferenceLine y={LIMIT_HIGH} stroke="var(--danger)" strokeDasharray="4 3" />
          <Tooltip
            formatter={(value) =>
              typeof value === "number" ? `${percent(value)}, ${limitWord(value)}` : String(value)
            }
            separator=": "
            wrapperClassName="bar-chart-tooltip"
            contentStyle={{ background: "transparent", border: 0, padding: 0 }}
          />
          <Bar dataKey="value" name="Peak used" isAnimationActive={false}>
            {points.map((point, index) => (
              <Cell
                key={`${point.label}-${index.toString()}`}
                fill={LIMIT_COLORS[limitBand(point.value)]}
              />
            ))}
          </Bar>
        </RechartsBarChart>
      </div>
      <ul className="limit-legend" aria-hidden="true">
        {(["under", "warn", "high"] as const).map((band) => (
          <li key={band}>
            <span className="limit-swatch" style={{ background: LIMIT_COLORS[band] }} />
            {LIMIT_WORDS[band]}
          </li>
        ))}
      </ul>
      <table className="chart-text-equivalent">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Window</th>
            <th scope="col">Peak used</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point, index) => (
            <tr key={`${point.description}-${index.toString()}`}>
              <th scope="row">
                {point.inProgress ? `${point.description}, in progress` : point.description}
              </th>
              <td>{percent(point.value)}</td>
              <td>{limitWord(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
