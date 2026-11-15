/** A synthetic Release record, in the shape that `release_record.py build --format json` writes. */
export function recordJson(
  tag: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    release: {
      name: tag,
      pull_request: 330,
      base: "a".repeat(40),
      head: "b".repeat(40),
      tier: "sensitive",
    },
    pull_requests: [
      {
        number: 12,
        title: "SECRET-TITLE add a thing",
        issue: 7,
        issue_type: "feature",
        tier: "standard",
        review_record: "SECRET-REVIEW the factory found no problem",
        commit: "c".repeat(40),
        cherry_pick_of: null,
      },
    ],
    direct_commits: [],
    release_approval: {
      required: true,
      approved_by: "op-login",
      time: "2026-02-01T10:00:00Z",
      threshold: "sensitive",
    },
    controls: {
      summary: { passing: 1 },
      controls: [{ id: "CTRL-PAY-03", title: "SECRET-CONTROL-TITLE", status: "passing" }],
    },
    waivers: [
      {
        id: "W-1",
        covers: { kind: "check", name: "x" },
        expires: "2026-06-01",
        approved_by: "op-login",
      },
    ],
    sbom_digest: "sha256:" + "d".repeat(64),
    control_modules: ["release_record", "release_approval"],
    gaps: [],
    ...over,
  };
}

/** A record with 3 gaps, as in the Spec scenario "A Release record with gaps". */
export function recordWithGaps(tag: string): Record<string, unknown> {
  return recordJson(tag, {
    pull_requests: [],
    direct_commits: [{ commit: "e".repeat(40), subject: "SECRET-SUBJECT fix it" }],
    release_approval: { required: true, approved_by: null, time: null, threshold: "sensitive" },
    controls: {
      summary: { untested: 1 },
      controls: [{ id: "CTRL-PAY-07", title: "t", status: "untested" }],
    },
    gaps: [
      "Control CTRL-PAY-07 is untested SECRET-GAP",
      "commit eeeeeee (SECRET-SUBJECT) reached the Release",
      "the Release needs a Release approval and has none",
    ],
  });
}

export function assetAnswer(tag: string, name: string, content: unknown) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return { tag, name, size: Buffer.byteLength(text), content: text };
}
