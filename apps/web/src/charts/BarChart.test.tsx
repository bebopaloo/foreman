import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatTokens } from "../format/index.ts";
import { BarChart, type BarPoint } from "./BarChart.tsx";

const fourteenDays: BarPoint[] = Array.from({ length: 14 }, (_, index) => {
  const day = index + 1;
  return { label: `${day.toString()} Nov`, value: day === 4 || day === 8 ? 0 : day * 1000 };
});

describe("BarChart", () => {
  it("has a table with a caption, header cells with scope and one row for each bar", () => {
    render(<BarChart title="Tokens by day" valueName="Tokens" data={fourteenDays} width={700} />);
    const table = screen.getByRole("table", { name: "Tokens by day" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(15);
    const zeroDay = within(table).getByRole("row", { name: /^4 Nov/ });
    expect(within(zeroDay).getByRole("rowheader")).toHaveAttribute("scope", "row");
    expect(within(zeroDay).getByRole("cell")).toHaveTextContent("0");
  });

  it("names the label column of the table with labelName", () => {
    render(
      <BarChart
        title="Pull requests by final tier"
        valueName="Pull requests"
        labelName="Tier"
        data={[{ label: "authority", value: 2 }]}
        width={700}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Tier" })).toBeInTheDocument();
  });

  it("writes the table values with the format function", () => {
    render(
      <BarChart
        title="Tokens by day"
        valueName="Tokens"
        data={[{ label: "5 Nov", value: 5300 }]}
        formatValue={formatTokens}
        width={700}
      />,
    );
    expect(screen.getByRole("cell")).toHaveTextContent("5.3K");
  });

  it("draws a bar for each value above zero and hides the graphic from a screen reader", () => {
    const { container } = render(
      <BarChart title="Tokens by day" valueName="Tokens" data={fourteenDays} width={700} />,
    );
    expect(screen.getByTestId("bar-chart-graphic")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(12);
  });

  it("does not make a bar a link or a button", () => {
    const { container } = render(
      <BarChart title="Tokens by day" valueName="Tokens" data={fourteenDays} width={700} />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
  });

  it("takes its colours from the theme tokens and sets no colour itself", () => {
    const { container } = render(
      <BarChart title="Tokens by day" valueName="Tokens" data={fourteenDays} width={700} />,
    );
    const colours = [...container.querySelectorAll("[fill], [stroke]")].flatMap((element) => [
      element.getAttribute("fill"),
      element.getAttribute("stroke"),
    ]);
    for (const colour of colours) {
      if (colour === null) continue;
      expect(colour).not.toMatch(/^#|^rgb/i);
    }
  });

  it("adds no style element and no script", () => {
    const { container } = render(
      <BarChart title="Tokens by day" valueName="Tokens" data={fourteenDays} width={700} />,
    );
    expect(container.querySelector("style, script")).toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("shows a table with no rows for no data", () => {
    render(<BarChart title="Tokens by day" valueName="Tokens" data={[]} width={700} />);
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});
