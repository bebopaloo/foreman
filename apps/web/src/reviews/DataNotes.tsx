import type { ReviewsResponse } from "@foreman/shared";
import { ScopedLink } from "../scope/index.ts";

/**
 * The note above a list that comes from the Work cache: "Not connected" with no token, else "Data is
 * not complete" when some repos have no cache rows. The numbers of the page come from local files, so
 * they show in both cases.
 */
export function DataNotes({ state, complete }: Pick<ReviewsResponse, "state" | "complete">) {
  if (state === "not_connected") {
    return (
      <p className="note">
        Not connected. Add the Foreman token to the Keychain, then run <code>pnpm local:up</code>.
      </p>
    );
  }
  if (complete === 0) return null;
  return (
    <p className="note note-warn">
      Data is not complete: {complete.toString()} {complete === 1 ? "repo" : "repos"} not connected.
      See <ScopedLink to="/#dash-repos">Repos</ScopedLink>.
    </p>
  );
}
