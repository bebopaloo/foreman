import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialScope,
  readStoredScope,
  readUrlScope,
  withScope,
  writeStoredScope,
} from "./scope.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readUrlScope", () => {
  it("reads the client value", () => {
    expect(readUrlScope("?client=acme")).toBe("acme");
  });

  it("treats a missing or empty value as All", () => {
    expect(readUrlScope("")).toBeNull();
    expect(readUrlScope("?client=")).toBeNull();
  });
});

describe("the stored scope", () => {
  it("returns what the last visit stored", () => {
    writeStoredScope("acme");
    expect(readStoredScope()).toBe("acme");
  });

  it("returns All when nothing is stored", () => {
    expect(readStoredScope()).toBeNull();
  });

  it("returns All when the stored value is not a client name", () => {
    window.localStorage.setItem("foreman.scope", "a b<script>");
    expect(readStoredScope()).toBeNull();
  });

  it("returns All when the storage cannot be read, and does not throw on a write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredScope()).toBeNull();
    expect(() => {
      writeStoredScope("acme");
    }).not.toThrow();
  });

  it("forgets the scope when All is chosen", () => {
    writeStoredScope("acme");
    writeStoredScope(null);
    expect(readStoredScope()).toBeNull();
  });
});

describe("initialScope", () => {
  it("prefers the URL value to the stored scope", () => {
    writeStoredScope("bebopaloo");
    expect(initialScope("?client=acme")).toBe("acme");
  });

  it("falls back to the stored scope", () => {
    writeStoredScope("bebopaloo");
    expect(initialScope("")).toBe("bebopaloo");
  });
});

describe("withScope", () => {
  it("adds the client value and keeps the other values", () => {
    expect(withScope("/work?state=open#top", "acme")).toBe("/work?state=open&client=acme#top");
  });

  it("replaces an earlier client value", () => {
    expect(withScope("/?client=globex", "acme")).toBe("/?client=acme");
  });

  it("removes the client value for All", () => {
    expect(withScope("/?client=acme", null)).toBe("/");
  });

  it("encodes a value that is not a client name", () => {
    expect(withScope("/", "a&b=c")).toBe("/?client=a%26b%3Dc");
  });
});
