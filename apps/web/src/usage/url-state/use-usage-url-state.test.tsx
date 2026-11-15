import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUsageUrlState } from "./use-usage-url-state.ts";

describe("useUsageUrlState", () => {
  it("writes the defaults into the URL with no new history entry", () => {
    window.history.replaceState(null, "", "/usage?client=acme");
    const before = window.history.length;
    renderHook(() => useUsageUrlState());
    const params = new URLSearchParams(window.location.search);
    expect(Object.fromEntries(params)).toEqual({
      client: "acme",
      range: "14d",
      grain: "day",
      metric: "tokens",
      tab: "project",
    });
    expect(window.history.length).toBe(before);
  });

  it("adds one history entry for each change, and Back undoes it", async () => {
    window.history.replaceState(null, "", "/usage");
    const { result } = renderHook(() => useUsageUrlState());
    act(() => {
      result.current.update({ range: { kind: "relative", count: 30, unit: "d" } });
    });
    act(() => {
      result.current.update({ tab: "model" });
    });
    expect(window.location.search).toContain("tab=model");

    const back = () =>
      act(async () => {
        const popped = new Promise((resolve) => {
          window.addEventListener("popstate", resolve, { once: true });
        });
        window.history.back();
        await popped;
      });
    await back();
    expect(result.current.state.tab).toBe("project");
    expect(result.current.state.range).toEqual({ kind: "relative", count: 30, unit: "d" });
    await back();
    expect(result.current.state.range).toEqual({ kind: "relative", count: 14, unit: "d" });
    expect(window.location.search).toContain("range=14d");
  });
});
