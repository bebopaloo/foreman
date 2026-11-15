import { describe, expect, it } from "vitest";
import { assetAnswer, recordJson, recordWithGaps } from "../../test/release-record-fixtures.ts";
import {
  parseReleaseRecord,
  planRecordRead,
  releaseRecordFieldsSchema,
} from "./release-records.ts";

function parse(record: unknown, tag = "v2.2.1") {
  return parseReleaseRecord(typeof record === "string" ? record : JSON.stringify(record), tag);
}

describe("parseReleaseRecord", () => {
  it("keeps the tier, the approval, the controls, the waivers and the modules", () => {
    const result = parse(recordJson("v2.2.1"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(releaseRecordFieldsSchema.safeParse(result.fields).success).toBe(true);
    expect(result.fields).toMatchObject({
      tier: "sensitive",
      pullRequest: 330,
      baseline: null,
      pullRequests: [
        { number: 12, issue: 7, issueType: "feature", tier: "standard", hasReviewRecord: true },
      ],
      directCommits: 0,
      approval: { required: true, approvedBy: "op-login", time: "2026-02-01T10:00:00Z" },
      controlCounts: { passing: 1 },
      controls: [{ id: "CTRL-PAY-03", status: "passing" }],
      waivers: [{ id: "W-1", expires: "2026-06-01", coversKind: "check" }],
      modules: ["release_record", "release_approval"],
      gaps: { total: 0, other: 0 },
    });
  });

  it("counts the gaps by kind and keeps no gap text, title, subject or review record", () => {
    const result = parse(recordWithGaps("v2.2.1"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.gaps).toEqual({
      total: 3,
      controlsNotProven: 1,
      directCommits: 1,
      approvalMissing: 1,
      pullRequestsWithoutReview: 0,
      other: 0,
    });
    expect(JSON.stringify(result.fields)).not.toContain("SECRET");
    const full = parse(recordJson("v2.2.1"));
    expect(JSON.stringify(full)).not.toContain("SECRET");
  });

  it("counts a pull request with no review record, and puts the rest in 'other'", () => {
    const record = recordJson("v2.2.1", {
      pull_requests: [{ number: 1, issue: null, issue_type: null, tier: null, review_record: " " }],
      gaps: ["PR #1 has no factory review record", "something else"],
    });
    const result = parse(record);
    expect(result.ok && result.fields.gaps).toMatchObject({
      total: 2,
      pullRequestsWithoutReview: 1,
      other: 1,
    });
  });

  it("accepts a record with the release approval, controls and modules off", () => {
    const result = parse(
      recordJson("v2.2.1", { release_approval: null, controls: null, control_modules: null }),
    );
    expect(result.ok && result.fields).toMatchObject({
      approval: null,
      controlCounts: null,
      controls: null,
      modules: null,
    });
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["an unknown top-level key", { ...recordJson("v2.2.1"), extra: 1 }],
    [
      "a missing top-level key",
      (() => {
        return Object.fromEntries(
          Object.entries(recordJson("v2.2.1")).filter(([key]) => key !== "gaps"),
        );
      })(),
    ],
    ["a release name that is not the tag", recordJson("v9.9.9")],
    [
      "a wrong type",
      recordJson("v2.2.1", { release_approval: { required: "yes", approved_by: null } }),
    ],
  ])("fails for %s", (_name, record) => {
    expect(parse(record)).toEqual({ ok: false });
  });
});

describe("planRecordRead", () => {
  it("reads the one asset that ends in .json", () => {
    expect(planRecordRead(["record-v2.2.1.md", "record-v2.2.1.json"])).toEqual({
      kind: "read",
      name: "record-v2.2.1.json",
    });
  });

  it("makes no call for none, for two, and for a name the runner refuses", () => {
    expect(planRecordRead(["app.tgz"])).toEqual({ kind: "no_call", state: "no_record" });
    expect(planRecordRead(["a.json", "b.json"])).toEqual({
      kind: "no_call",
      state: "more_than_one_record",
    });
    expect(planRecordRead(["a b.json"])).toEqual({ kind: "no_call", state: "not_readable" });
  });
});

describe("the fixture", () => {
  it("builds an asset answer with the size of the content", () => {
    expect(assetAnswer("v1.0.0", "r.json", { a: 1 })).toEqual({
      tag: "v1.0.0",
      name: "r.json",
      size: 7,
      content: '{"a":1}',
    });
  });
});
