import type {
  ControlsArtefactRow,
  ControlsModuleRow,
  ControlsReleaseRecord,
  ControlsReleaseRow,
  ControlsWaiverRow,
} from "@foreman/shared";
import { MISSING, formatDay, formatNumber, formatTime } from "../format/index.ts";
import type { Tone } from "../work/labels.ts";

export { gateTone, safeLink, tierTone } from "../work/labels.ts";
export type { Tone } from "../work/labels.ts";

export const plural = (count: number, one: string, many: string): string =>
  `${formatNumber(count)} ${count === 1 ? one : many}`;

export const CONTROL_EVENTS_NOTE = "Full review data from Control events";
export const FORGE_ONLY_NOTE =
  "Forge data only: the Machine gate status, Factory identity reviews and merges";

const FILE_NAMES = {
  riskMap: { name: "Risk map", module: "risk_tiers" },
  controlRegister: { name: "Control register", module: "control_register" },
  threatModel: { name: "Threat model", module: "threat_model" },
  waiverRegister: { name: "Waiver register", module: "waivers" },
} as const;

export type ArtefactKey = keyof typeof FILE_NAMES;

export const artefactName = (key: ArtefactKey): string => FILE_NAMES[key].name;

/** What the Control modules table shows when the repo has no valid repo config. Null: the config is read. */
export function configProblem(row: ControlsModuleRow): string | null {
  if (row.repoState === "no_default_branch") return "no default branch";
  if (row.repoState === "failed") return "the forge repo call failed";
  switch (row.configState) {
    case "ok":
      break;
    case "missing_file":
      return `no .claude/factory.json at ${row.fileBranch ?? row.defaultBranch ?? "the default branch"}`;
    case "missing_ref":
      return `no branch ${row.fileBranch ?? row.defaultBranch ?? "the default branch"}`;
    case "not_readable":
      return ".claude/factory.json is not readable";
    case "failed":
      return ".claude/factory.json: adapter error";
    case "module_off":
    case "not_read":
      return "not read yet";
  }
  if (row.controlsKey === "not_valid") {
    return "controls key not valid: the factory stops the control steps";
  }
  return null;
}

export function branchNote(row: ControlsModuleRow): string | null {
  if (row.mainBranch === null || row.mainBranch === row.defaultBranch) return null;
  return `the main branch in the factory config is ${row.mainBranch}, the default branch is ${row.defaultBranch ?? MISSING}`;
}

/** The state of a Waiver as a text, with its tone. A colour never stands alone. */
export function expiryLabel(row: ControlsWaiverRow): { text: string; tone: Tone } {
  switch (row.expiry) {
    case "expired":
      return { text: "expired", tone: "danger" };
    case "expiring":
      return {
        text: `expires in ${plural(row.days ?? 0, "day", "days")}`,
        tone: "warn",
      };
    case "current":
      return { text: `current, ${plural(row.days ?? 0, "day", "days")}`, tone: "ok" };
    case "not_in_register":
      return {
        text: `not in the register at ${row.registerBranch ?? "the file branch"}`,
        tone: "danger",
      };
    case "register_not_read":
      return { text: "register not read", tone: "plain" };
  }
}

export function coversText(covers: ControlsWaiverRow["covers"]): string {
  if (covers === null) return MISSING;
  switch (covers.kind) {
    case "finding":
      return `finding: ${[covers.file, covers.category, ...(covers.ref === null ? [] : [covers.ref])].join(" · ")}`;
    case "check":
      return `check: ${covers.name}`;
    case "control":
      return `control: ${covers.id}`;
  }
}

type Approval = Extract<ControlsReleaseRecord, { kind: "ok" }>["approval"];

export function approvalLabel(approval: Approval): { text: string; tone: Tone } {
  switch (approval.kind) {
    case "approved":
      return {
        text: `approved by ${approval.by}${approval.time === null ? "" : `, ${formatTime(approval.time)}`}`,
        tone: "ok",
      };
    case "not_needed":
      return {
        text: approval.threshold === null ? "not needed" : `not needed below ${approval.threshold}`,
        tone: "plain",
      };
    case "missing":
      return { text: "missing", tone: "danger" };
    case "not_recorded":
      return { text: "not recorded", tone: "warn" };
  }
}

type Gaps = Extract<ControlsReleaseRecord, { kind: "ok" }>["gaps"];

/** "no gaps", or "3 gaps: 1 Control not proven (CTRL-PAY-07), 1 commit with no pull request, ...". */
export function gapsText(gaps: Gaps): string {
  if (gaps.total === 0) return "no gaps";
  const parts: string[] = [];
  const proven = gaps.controlsNotProven;
  if (proven.length > 0) {
    parts.push(`${plural(proven.length, "Control", "Controls")} not proven (${proven.join(", ")})`);
  }
  if (gaps.directCommits > 0) {
    parts.push(`${plural(gaps.directCommits, "commit", "commits")} with no pull request`);
  }
  if (gaps.approvalMissing) parts.push("Release approval missing");
  if (gaps.pullRequestsWithoutReview > 0) {
    parts.push(
      `${plural(gaps.pullRequestsWithoutReview, "pull request", "pull requests")} with no review record`,
    );
  }
  if (gaps.other > 0) parts.push(`${formatNumber(gaps.other)} other`);
  return `${plural(gaps.total, "gap", "gaps")}${parts.length === 0 ? "" : `: ${parts.join(", ")}`}`;
}

const NO_RECORD: Record<Extract<ControlsReleaseRecord, { kind: "none" }>["reason"], string> = {
  before_release: "no Release record before the release",
  module_off: "Release record module off",
  no_forge_release: "no forge release",
  no_record: "no Release record",
  more_than_one_record: "more than one Release record",
  not_readable: "Release record not readable",
  missing: "Release record missing",
  failed: "Release record adapter error",
  not_fetched: "Release record not read yet",
};

export const noRecordText = (reason: keyof typeof NO_RECORD): string => NO_RECORD[reason];

export const releaseKey = (row: ControlsReleaseRow): string => `${row.repoId}:${row.name}`;

const STATE_TEXT = {
  ok: "",
  module_off: "module off",
  missing_file: "missing",
  missing_ref: "branch not found",
  not_readable: "not readable",
  failed: "adapter error",
  not_read: "not read yet",
} as const;

export const stateText = (state: ControlsArtefactRow["riskMap"]["state"]): string =>
  STATE_TEXT[state];

export const fileProblem = (
  key: ArtefactKey,
  state: ControlsArtefactRow["riskMap"]["state"],
  branch: string,
): string | null => {
  const { name, module } = FILE_NAMES[key];
  if (state === "ok") return null;
  if (state === "missing_file") return `${module} is on, but the ${name} is missing at ${branch}`;
  if (state === "missing_ref") return `${module} is on, but the branch ${branch} is not found`;
  if (state === "not_readable") return `${name} not readable`;
  return `${name}: ${stateText(state)}`;
};

export const skippedText = (skipped: { position: number; field: string }[], noun: string) =>
  `${plural(skipped.length, noun, `${noun}s`)} not readable: ${skipped
    .map((entry) => `position ${entry.position.toString()}, field ${entry.field}`)
    .join("; ")}`;

export { formatDay, formatTime, formatNumber, MISSING };
