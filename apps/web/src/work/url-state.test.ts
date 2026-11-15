import { describe, expect, it } from "vitest";
import { filterQuery, parseFilters } from "./url-state.ts";

describe("parseFilters", () => {
  it("uses the repo sort and no filter when the URL has none", () => {
    expect(parseFilters("")).toEqual({ valid: true, filters: { sort: "repo" } });
  });

  it("reads the filter values and ignores the client value", () => {
    const result = parseFilters("?client=acme&issue_state=BLOCKED&type=fix&sort=state");
    expect(result).toEqual({
      valid: true,
      filters: { issue_state: "BLOCKED", type: "fix", sort: "state" },
    });
  });

  it("reports a value that is not valid", () => {
    expect(parseFilters("?issue_state=DOING")).toEqual({ valid: false });
    expect(parseFilters("?sort=title")).toEqual({ valid: false });
    expect(parseFilters("?repo=not-an-id")).toEqual({ valid: false });
  });
});

describe("filterQuery", () => {
  it("leaves out the filters that are not set", () => {
    expect(filterQuery({ sort: "repo", priority: "high" })).toEqual({
      sort: "repo",
      priority: "high",
    });
  });
});
