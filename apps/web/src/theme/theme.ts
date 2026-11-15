import { useSyncExternalStore } from "react";
import { z } from "zod";

export const THEME_KEY = "foreman.theme";

const choiceSchema = z.enum(["auto", "light", "dark"]);
export type ThemeChoice = z.infer<typeof choiceSchema>;
export type ResolvedTheme = "light" | "dark";

export interface ThemeState {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
}

const CYCLE: Record<ThemeChoice, ThemeChoice> = { auto: "light", light: "dark", dark: "auto" };

export function nextChoice(choice: ThemeChoice): ThemeChoice {
  return CYCLE[choice];
}

/** The accessible name of the theme button: "Theme: light", "Theme: auto (dark)". */
export function themeLabel({ choice, resolved }: ThemeState): string {
  return choice === "auto" ? `Theme: auto (${resolved})` : `Theme: ${choice}`;
}

function readChoice(): ThemeChoice {
  try {
    const parsed = choiceSchema.safeParse(window.localStorage.getItem(THEME_KEY));
    return parsed.success ? parsed.data : "auto";
  } catch {
    return "auto";
  }
}

function writeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The choice stays in memory for this page. The next page opens in "auto".
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
}

function resolve(choice: ThemeChoice): ResolvedTheme {
  if (choice !== "auto") return choice;
  return systemQuery()?.matches === true ? "dark" : "light";
}

const listeners = new Set<() => void>();
let state: ThemeState = { choice: "auto", resolved: "light" };

function setState(choice: ThemeChoice): void {
  const resolved = resolve(choice);
  if (state.choice !== choice || state.resolved !== resolved) state = { choice, resolved };
}

function commit(): void {
  document.documentElement.dataset.theme = state.resolved;
}

function notify(): void {
  commit();
  for (const listener of listeners) listener();
}

/** Applies the stored choice to the page. `main.tsx` calls it before the first render. */
export function initTheme(): void {
  setState(readChoice());
  commit();
}

function cycleTheme(): void {
  const choice = nextChoice(state.choice);
  writeChoice(choice);
  setState(choice);
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) setState(readChoice());
  listeners.add(listener);
  const query = systemQuery();
  const onSystemChange = () => {
    setState(state.choice);
    notify();
  };
  query?.addEventListener("change", onSystemChange);
  commit();
  return () => {
    listeners.delete(listener);
    query?.removeEventListener("change", onSystemChange);
  };
}

function getSnapshot(): ThemeState {
  // With no subscriber, nothing keeps the state fresh: read it again.
  if (listeners.size === 0) setState(readChoice());
  return state;
}

/** The theme choice and the theme that shows now, for a component that needs the theme in code. */
export function useTheme(): ThemeState & { cycle: () => void } {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  return { ...current, cycle: cycleTheme };
}
