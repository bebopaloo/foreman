import { describe, expect, it } from "vitest";
import { filterQuery, parseFilters, setQuery } from "./url-state.ts";

describe("parseFilters", () => {
  it("uses the repo sort and no filter when the URL has none", () => {
    expect(parseFilters("")).toEqual({ valid: true, filters: { sort: "repo" }, dashSet: null });
  });

  it("reads the filter values and ignores the client value", () => {
    const result = parseFilters("?client=acme&issue_state=BLOCKED&type=fix&sort=state");
    expect(result).toEqual({
      valid: true,
      filters: { issue_state: "BLOCKED", type: "fix", sort: "state" },
      dashSet: null,
    });
  });

  it("reports a value that is not valid", () => {
    expect(parseFilters("?issue_state=DOING")).toEqual({ valid: false });
    expect(parseFilters("?sort=title")).toEqual({ valid: false });
    expect(parseFilters("?repo=not-an-id")).toEqual({ valid: false });
  });
});

describe("parseFilters with a set", () => {
  it("has no set when the URL has none", () => {
    expect(parseFilters("?sort=state")).toMatchObject({ valid: true, dashSet: null });
  });

  it("reads a set, and a run with the sets builds and merged", () => {
    expect(parseFilters("?client=acme&set=waits")).toMatchObject({
      valid: true,
      dashSet: { set: "waits" },
    });
    expect(parseFilters("?set=builds&run=r1")).toMatchObject({
      valid: true,
      dashSet: { set: "builds", run: "r1" },
    });
  });

  it("rejects a combination that the API rejects", () => {
    for (const search of [
      "?set=stage_doing",
      "?set=builds",
      "?run=r1",
      "?set=waits&run=r1",
      "?set=waits&issue_state=BLOCKED",
      "?set=waits&sort=state",
      "?set=waits&repo=0123456789ab",
      `?set=builds&run=${"x".repeat(201)}`,
    ]) {
      expect(parseFilters(search)).toEqual({ valid: false });
    }
  });
});

describe("filterQuery", () => {
  it("sends only the set and the run with a set", () => {
    expect(setQuery({ set: "builds", run: "r1" })).toEqual({ set: "builds", run: "r1" });
    expect(setQuery({ set: "waits" })).toEqual({ set: "waits" });
  });

  it("leaves out the filters that are not set", () => {
    expect(filterQuery({ sort: "repo", priority: "high" })).toEqual({
      sort: "repo",
      priority: "high",
    });
  });
});
