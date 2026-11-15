import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY, initTheme } from "./index.ts";
import { ThemeButton } from "./ThemeButton.tsx";

function browserIs(scheme: "dark" | "light") {
  const listeners = new Set<() => void>();
  const query = {
    matches: scheme === "dark",
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    change(next: "dark" | "light") {
      query.matches = next === "dark";
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

const page = () => document.documentElement.dataset.theme;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

describe("the theme button", () => {
  it("cycles light, dark and auto, and names each state", async () => {
    browserIs("dark");
    render(<ThemeButton />);
    expect(screen.getByRole("button", { name: "Theme: auto (dark)" })).toBeInTheDocument();
    expect(page()).toBe("dark");

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Theme: light" })).toBeInTheDocument();
    expect(page()).toBe("light");

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Theme: dark" })).toBeInTheDocument();
    expect(page()).toBe("dark");

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Theme: auto (dark)" })).toBeInTheDocument();
    expect(page()).toBe("dark");
  });

  it("names a light browser in auto", () => {
    browserIs("light");
    render(<ThemeButton />);
    expect(screen.getByRole("button", { name: "Theme: auto (light)" })).toBeInTheDocument();
    expect(page()).toBe("light");
  });

  it("follows a change of the browser while the theme is auto", () => {
    const browser = browserIs("light");
    render(<ThemeButton />);
    browser.change("dark");
    expect(screen.getByRole("button", { name: "Theme: auto (dark)" })).toBeInTheDocument();
    expect(page()).toBe("dark");
  });

  it("keeps a chosen theme when the browser changes", async () => {
    const browser = browserIs("light");
    render(<ThemeButton />);
    await userEvent.click(screen.getByRole("button"));
    browser.change("dark");
    expect(screen.getByRole("button", { name: "Theme: light" })).toBeInTheDocument();
    expect(page()).toBe("light");
  });

  it("stores the choice and opens in it", async () => {
    browserIs("light");
    const first = render(<ThemeButton />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
    first.unmount();

    initTheme();
    expect(page()).toBe("dark");
    render(<ThemeButton />);
    expect(screen.getByRole("button", { name: "Theme: dark" })).toBeInTheDocument();
  });

  it("opens in auto when the browser storage cannot be read", () => {
    browserIs("dark");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeButton />);
    expect(screen.getByRole("button", { name: "Theme: auto (dark)" })).toBeInTheDocument();
  });

  it("opens in auto when the stored value is not a theme", () => {
    browserIs("light");
    window.localStorage.setItem(THEME_KEY, "purple");
    render(<ThemeButton />);
    expect(screen.getByRole("button", { name: "Theme: auto (light)" })).toBeInTheDocument();
  });

  it("still cycles when the browser storage cannot be written", async () => {
    browserIs("light");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    render(<ThemeButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Theme: light" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Theme: dark" })).toBeInTheDocument();
  });

  it("works in a browser with no matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<ThemeButton />);
    expect(screen.getByRole("button", { name: "Theme: auto (light)" })).toBeInTheDocument();
  });
});
