import { ClientName } from "@foreman/shared";

/** The query parameter that holds the Client scope. Every Foreman URL keeps it. */
export const SCOPE_PARAM = "client";
const STORAGE_KEY = "foreman.scope";

/** A client name, or null for "All". */
export type Scope = string | null;

export function readUrlScope(search: string): Scope {
  const value = new URLSearchParams(search).get(SCOPE_PARAM);
  return value === null || value === "" ? null : value;
}

/** The last chosen scope. A storage that cannot be read, or a value that is not a client name, gives "All". */
export function readStoredScope(): Scope {
  try {
    const parsed = ClientName.safeParse(window.localStorage.getItem(STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeStoredScope(scope: Scope): void {
  try {
    if (scope === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, scope);
  } catch {
    // The scope still works for this page: the storage only remembers it for the next visit.
  }
}

/** The path or URL with the `client` value of the scope, replacing any other value. */
export function withScope(href: string, scope: Scope): string {
  const url = new URL(href, window.location.origin);
  if (scope === null) url.searchParams.delete(SCOPE_PARAM);
  else url.searchParams.set(SCOPE_PARAM, scope);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The scope of a page load: the URL value, else the stored scope, else "All". */
export function initialScope(search: string): Scope {
  return readUrlScope(search) ?? readStoredScope();
}
