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
