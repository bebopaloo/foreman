import { describe, expect, it } from "vitest";
import { contractSchemas } from "./contract.ts";

const pull = {
  number: 3,
  url: "https://github.com/acme/app/pull/3",
  title: "A title",
  state: "open",
  draft: false,
  head: "a",
  base: "b",
  author: "someone",
  checks: "success",
  labels: [],
};

describe("the pull request shape", () => {
  it("accepts a pull request with no head_sha", () => {
    expect(contractSchemas.prList.safeParse([pull]).success).toBe(true);
  });

  it("accepts a head_sha of 40 lower case hex characters", () => {
    const head_sha = "0123456789abcdef0123456789abcdef01234567";
    expect(contractSchemas.prList.safeParse([{ ...pull, head_sha }]).success).toBe(true);
  });

  it.each(["abc123", "0123456789ABCDEF0123456789ABCDEF01234567", ""])(
    "rejects the head_sha %j",
    (head_sha) => {
      expect(contractSchemas.prList.safeParse([{ ...pull, head_sha }]).success).toBe(false);
    },
  );

  it("still rejects any other unknown key", () => {
    expect(contractSchemas.prList.safeParse([{ ...pull, extra: 1 }]).success).toBe(false);
  });
});

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

describe("the head_sha of a whole list", () => {
  it("accepts a list in which every pull request has a head_sha", () => {
    const list = [
      { ...pull, head_sha: shaA },
      { ...pull, number: 4, head_sha: shaB },
    ];
    expect(contractSchemas.prList.safeParse(list).success).toBe(true);
  });

  it("accepts a list in which no pull request has a head_sha", () => {
    expect(contractSchemas.prList.safeParse([pull, { ...pull, number: 4 }]).success).toBe(true);
  });

  it("rejects a list in which only some pull requests have a head_sha", () => {
    expect(contractSchemas.prList.safeParse([{ ...pull, head_sha: shaA }, pull]).success).toBe(
      false,
    );
  });

  it("rejects a list with a head_sha of abc", () => {
    const list = [{ ...pull, head_sha: shaA }, { ...pull, number: 4, head_sha: "abc" }, pull];
    expect(contractSchemas.prList.safeParse(list).success).toBe(false);
  });
});

describe("the commit status shape", () => {
  const status = {
    sha: shaA,
    context: "factory/machine-gate",
    state: "pass",
    description: "",
  };

  it.each(["pass", "fail", "pending", "none"])("accepts the state %s", (state) => {
    expect(contractSchemas.commitStatus.safeParse({ ...status, state }).success).toBe(true);
  });

  it.each([
    ["the state green", { state: "green" }],
    ["an unknown key", { extra: 1 }],
    ["a short sha", { sha: "abc123" }],
    ["another context", { context: "factory/other" }],
  ])("rejects %s", (_name, over) => {
    expect(contractSchemas.commitStatus.safeParse({ ...status, ...over }).success).toBe(false);
  });
});
