import { Bar, BarChart as RechartsBarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import "./charts.css";

export interface BarPoint {
  /** The text of the bucket on the axis and in the table, for example "13 Nov". */
  label: string;
  value: number;
}

export interface BarChartProps {
  /** The title of the chart. It is also the caption of the table, for example "Tokens by day". */
  title: string;
  /** The name of the value column of the table, for example "Tokens". */
  valueName: string;
  /** The name of the label column of the table. The default is "Period". */
  labelName?: string;
  data: readonly BarPoint[];
  /** Writes a value for the axis, the tooltip and the table. The default is the plain number. */
  formatValue?: (value: number) => string;
  height?: number;
  /** A fixed width in pixels. The default follows the width of the container. */
  width?: number;
}

const plain = (value: number): string => String(value);

/**
 * A bar chart with a table of the same values for a screen reader. The bars are not links: no bar
 * reacts to a click. The colours are the theme tokens of `charts.css`.
 */
export function BarChart({
  title,
  valueName,
  labelName = "Period",
  data,
  formatValue = plain,
  height = 220,
  width,
}: BarChartProps) {
  const points = data.map((point) => ({ ...point }));
  return (
    <figure className="bar-chart" style={{ margin: 0 }}>
      <figcaption className="chart-title">{title}</figcaption>
      <div aria-hidden="true" data-testid="bar-chart-graphic">
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
            tickFormatter={formatValue}
            width={56}
            stroke="var(--line)"
            tick={{ fill: "var(--muted)" }}
          />
          <Tooltip
            formatter={(value) => (typeof value === "number" ? formatValue(value) : String(value))}
            separator=": "
            wrapperClassName="bar-chart-tooltip"
            contentStyle={{ background: "transparent", border: 0, padding: 0 }}
          />
          <Bar dataKey="value" name={valueName} fill="var(--accent)" isAnimationActive={false} />
        </RechartsBarChart>
      </div>
      <table className="chart-text-equivalent">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{labelName}</th>
            <th scope="col">{valueName}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point, index) => (
            <tr key={`${point.label}-${index.toString()}`}>
              <th scope="row">{point.label}</th>
              <td>{formatValue(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
