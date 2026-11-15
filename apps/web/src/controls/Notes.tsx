import type { ControlsResponse } from "@foreman/shared";
import { DataNotes } from "../reviews/DataNotes.tsx";

/** "Not connected" with no token, else "Data is not complete" when some repos have no cache rows. */
export function Notes({ data }: { data: Pick<ControlsResponse, "state" | "complete"> }) {
  return <DataNotes state={data.state} complete={data.complete.incompleteRepos} />;
}
