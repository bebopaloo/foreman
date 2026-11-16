import type { DashResponse, PipelineCounts, WorkSet } from "@foreman/shared";
import { StatButton } from "./panel-context.tsx";
import { plural } from "./last-run.ts";

interface Stage {
  key: keyof PipelineCounts;
  set: WorkSet;
  gate: string;
  label: string;
  /** The background and text colours. Each pair has a contrast of at least 4.5:1. */
  background: string;
  colour: string;
}

const STAGES: Stage[] = [
  {
    key: "spec",
    set: "stage_g1",
    gate: "G1",
    label: "Spec",
    background: "#f4f4f1",
    colour: "#161a22",
  },
  {
    key: "issues",
    set: "stage_g2",
    gate: "G2",
    label: "Issues",
    background: "#f4f4f1",
    colour: "#161a22",
  },
  {
    key: "ready",
    set: "stage_ready",
    gate: "queue",
    label: "READY",
    background: "#dce7fa",
    colour: "#173f80",
  },
  {
    key: "inProgress",
    set: "stage_in_progress",
    gate: "build",
    label: "IN PROGRESS",
    background: "#1d4f9e",
    colour: "#fff",
  },
  {
    key: "inReview",
    set: "stage_in_review",
    gate: "review",
    label: "IN REVIEW",
    background: "#e9e2fa",
    colour: "#3f2287",
  },
  {
    key: "blocked",
    set: "stage_blocked",
    gate: "waits",
    label: "BLOCKED",
    background: "#b45309",
    colour: "#fff",
  },
  {
    key: "done",
    set: "stage_done",
    gate: "merged",
    label: "DONE",
    background: "#dff0e5",
    colour: "#185c33",
  },
  {
    key: "release",
    set: "stage_g3",
    gate: "G3",
    label: "Release",
    background: "#161a22",
    colour: "#fff",
  },
];

export const NOT_CONNECTED_TEXT =
  "Not connected. Add the Foreman token to the Keychain, then run pnpm local:up.";

/** The note of a forge section when a repo in scope has no cache rows. Null when the data is complete. */
export function incompleteNote(complete: DashResponse["complete"]): string | null {
  return complete.missingRepos === 0 || complete.connectedRepos === 0
    ? null
    : `Data is not complete: ${plural(complete.missingRepos, "repo", "repos")} not connected. See Repos.`;
}

export function NotConnected() {
  return (
    <p className="muted">
      Not connected. Add the Foreman token to the Keychain, then run{" "}
      <span className="mono">pnpm local:up</span>.
    </p>
  );
}

export function PipelineStrip({ dash }: { dash: DashResponse }) {
  const { pipeline, complete } = dash;
  const note = incompleteNote(complete);
  return (
    <section className="card" aria-labelledby="dash-pipeline">
      <h2 id="dash-pipeline">The pipeline now</h2>
      {pipeline === null ? (
        <NotConnected />
      ) : (
        <>
          <ul className="pipeline" aria-label="Pipeline stages">
            {STAGES.map((stage) => (
              <li
                key={stage.key}
                className="stage"
                style={{ background: stage.background, color: stage.colour }}
              >
                <StatButton set={stage.set} enabled={pipeline[stage.key] >= 1}>
                  <span className="stage-gate">{stage.gate}</span>
                  <span className="stage-label">{stage.label}</span>
                  <strong className="stage-count">{pipeline[stage.key]}</strong>
                </StatButton>
              </li>
            ))}
          </ul>
          {note === null ? null : <p className="note note-warn">{note}</p>}
        </>
      )}
      <p className="muted">source: tracker (cache) · gates G1, G2 and G3 need the Operator</p>
    </section>
  );
}
