import { describe, expect, it } from "vitest";
import { worktreeDatabaseName, worktreeDatabaseUrl } from "./database.ts";

describe("worktreeDatabaseName", () => {
  it("names the database after the checkout folder", () => {
    expect(worktreeDatabaseName("7-add-login")).toBe("app_test_7_add_login");
  });

  it("keeps only lower-case letters, digits and underscores", () => {
    expect(worktreeDatabaseName("8-Fix.Notes")).toBe("app_test_8_fix_notes");
  });

  it("keeps two long folder names apart within the Postgres name limit", () => {
    const first = worktreeDatabaseName(`${"a".repeat(70)}-one`);
    const second = worktreeDatabaseName(`${"a".repeat(70)}-two`);
    expect(first.length).toBeLessThanOrEqual(63);
    expect(second.length).toBeLessThanOrEqual(63);
    expect(first).not.toBe(second);
  });

  it("refuses a folder name with no letters or digits", () => {
    expect(() => worktreeDatabaseName("---")).toThrow(/TEST_DATABASE_URL/);
  });
});

describe("worktreeDatabaseUrl", () => {
  it("uses the local database port", () => {
    expect(worktreeDatabaseUrl("shop")).toBe("postgres://app@127.0.0.1:55432/app_test_shop");
  });

  it("follows DB_PORT", () => {
    expect(worktreeDatabaseUrl("shop", "56000")).toBe(
      "postgres://app@127.0.0.1:56000/app_test_shop",
    );
  });
});
