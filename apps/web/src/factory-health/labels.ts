import {
  BUILD_RESULTS,
  type FactoryRunRow,
  type MarketplaceRow,
  type PluginRow,
  type RuleDriftRepo,
  type RuleDriftRule,
  type RuleDriftState,
} from "@foreman/shared";
import { MISSING } from "../format/index.ts";
import type { Tone } from "../work/labels.ts";

export { safeLink } from "../work/labels.ts";

export interface Label {
  text: string;
  tone: Tone;
}

export const plural = (count: number, one: string, many: string): string =>
  `${count.toString()} ${count === 1 ? one : many}`;

/** The state of a plugin row. The text is always shown, so colour is never the only signal. */
export function pluginLabel(row: PluginRow, marketplace: MarketplaceRow | undefined): Label {
  switch (row.state) {
    case "current":
      return { text: "current", tone: "ok" };
    case "update_available":
      return { text: `${row.marketplaceVersion ?? MISSING} available`, tone: "warn" };
    case "newer_than_marketplace":
      return { text: "newer than the Marketplace copy", tone: "info" };
    case "differs_from_marketplace":
      return { text: "differs from the Marketplace copy", tone: "warn" };
    case "not_in_marketplace":
      return { text: "not in the Marketplace", tone: "plain" };
    case "marketplace_not_known":
      return { text: "Marketplace not known", tone: "plain" };
    case "marketplace_not_readable":
      return {
        text:
          marketplace?.sourceKind === "directory"
            ? "Marketplace not readable by Foreman: set FOREMAN_MARKETPLACE_DIR"
            : "Marketplace not readable by Foreman",
        tone: "plain",
      };
    case "version_not_in_marketplace_copy":
      return { text: "version not in the local Marketplace copy", tone: "plain" };
    case "version_not_readable":
      return { text: "version not readable", tone: "plain" };
    case "no_user_install":
      return { text: "no user-scope install", tone: "plain" };
  }
}

/** The Marketplace version shows beside a state that does not already name it. */
export const showsMarketplaceVersion = (row: PluginRow): boolean =>
  row.marketplaceVersion !== null &&
  (row.state === "newer_than_marketplace" || row.state === "differs_from_marketplace");

export function ruleLabel(rule: RuleDriftRule, repo: RuleDriftRepo): Label {
  switch (rule.state) {
    case "current":
      if (rule.stampVersion === null) return { text: "current, no stamp", tone: "ok" };
      return {
        text:
          rule.stampVersion === rule.sourceVersion
            ? "current"
            : `current, stamp ${rule.stampVersion}`,
        tone: "ok",
      };
    case "behind":
      return {
        text: `behind: the template changed after ${rule.stampVersion ?? MISSING}`,
        tone: "warn",
      };
    case "edited_by_team":
      return { text: "edited by the team", tone: "info" };
    case "differs":
      return { text: "differs from the template", tone: "warn" };
    case "missing_file":
      return { text: `missing at ${rule.ref ?? repo.fileBranch ?? MISSING}`, tone: "danger" };
    case "missing_ref":
      return { text: "branch not found", tone: "danger" };
    case "no_template":
      return { text: "no template in the installed plugins", tone: "plain" };
    case "not_unique":
      return { text: "template name not unique", tone: "danger" };
    case "not_readable":
      return { text: "not readable", tone: "danger" };
    case "failed":
      return { text: rule.errorState ?? "adapter error", tone: "danger" };
    case "not_read":
      return { text: "not read yet", tone: "plain" };
  }
}

export const DIFFERS_NOTE = "Foreman cannot tell a team edit from a template change.";

/** The words of a state in the summary line of a repo. */
const SUMMARY_WORDS: Record<Exclude<RuleDriftState, "current" | "behind">, string> = {
  edited_by_team: "edited by the team",
  differs: "differing from the template",
  missing_file: "missing",
  missing_ref: "on a branch that is not found",
  no_template: "with no template in the installed plugins",
  not_unique: "with a template name that is not unique",
  not_readable: "not readable",
  failed: "not read: adapter error",
  not_read: "not read yet",
};

const SUMMARY_ORDER: RuleDriftState[] = [
  "behind",
  "edited_by_team",
  "differs",
  "missing_file",
  "missing_ref",
  "no_template",
  "not_unique",
  "not_readable",
  "failed",
  "not_read",
];

/** "3 Repo rules match the templates", or the counts of the other states. */
export function ruleSummary(repo: RuleDriftRepo): string | null {
  if (repo.configState !== "ok" || repo.rules.length === 0) return null;
  const others = SUMMARY_ORDER.flatMap((state) => {
    const count = repo.summary[state];
    if (count === 0) return [];
    const noun = plural(count, "Repo rule", "Repo rules");
    if (state === "behind") {
      const source = repo.rules.find((rule) => rule.state === "behind");
      const where =
        source?.sourcePlugin != null && source.sourceVersion != null
          ? ` ${source.sourcePlugin} ${source.sourceVersion}`
          : "";
      return [`${noun} behind${where}`];
    }
    return [`${noun} ${SUMMARY_WORDS[state as keyof typeof SUMMARY_WORDS]}`];
  });
  if (others.length > 0) return others.join(", ");
  return `${plural(repo.summary.current, "Repo rule", "Repo rules")} match the templates`;
}

/** The text of a factory config state, or null when the config is read. */
export function configText(repo: RuleDriftRepo): string | null {
  switch (repo.configState) {
    case "ok":
      return null;
    case "not_read":
      return "factory config not read yet";
    case "not_set_up":
      return `not set up: no .claude/factory.json at ${repo.fileBranch ?? repo.defaultBranch ?? MISSING}`;
    case "branch_not_found":
      return "branch not found";
    case "not_readable":
      return "factory config not readable";
    case "failed":
      return "factory config not read: adapter error";
    case "no_default_branch":
      return "no default branch";
  }
}

/** The calendar day of a time in the time zone of the browser, as `YYYY-MM-DD`. */
export function nightOf(time: string, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(time))) parts[part.type] = part.value;
  return `${parts.year ?? ""}-${parts.month ?? ""}-${parts.day ?? ""}`;
}

/** "8 builds: 6 merged, 1 blocked, 1 in review". Each result is a text label. */
export function buildsText(run: FactoryRunRow): string {
  const noun = plural(run.builds, "build", "builds");
  const results = BUILD_RESULTS.flatMap((result) => {
    const count = run.results[result];
    return count === 0 ? [] : [`${count.toString()} ${result}`];
  });
  return results.length === 0 ? noun : `${noun}: ${results.join(", ")}`;
}

export const peakText = (run: FactoryRunRow): string =>
  run.slotLimit === null
    ? `peak ${run.peak.toString()} at one time`
    : `peak ${run.peak.toString()} of ${run.slotLimit.toString()}`;
